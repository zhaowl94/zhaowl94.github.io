"""QDII基金相似度计算: 重仓股重合度 + 收益相关性 + 跟踪指数 三者加权综合。

权重默认: 持仓重合 50% / 收益相关 30% / 指数匹配 20%
当某项数据缺失时, 自动按可用项的权重重新归一化。
所有子分数统一映射到 0..1, composite 输出 0..100。
"""
import re
import numpy as np
import pandas as pd


# 3只参考基准基金
REFERENCES = {
    '270042': {
        'name': '广发纳斯达克100ETF联接A',
        'short': '广发纳指',
        'keywords': ['纳斯达克', '纳指', '100', 'NDX', 'NASDAQ'],
        'index_patterns': [r'纳斯达克\s*100', r'纳指', r'NASDAQ\s*100', r'^NDX'],
    },
    '161128': {
        'name': '易方达标普信息科技指数(QDII-LOF)',
        'short': '易方达标普科技',
        'keywords': ['标普', '信息科技', '科技', 'S&P', 'INFORMATION', 'TECH'],
        'index_patterns': [r'标普.*信息科技', r'S&P.*INFORMATION', r'标普\s*500\s*信息科技'],
    },
    '017091': {
        'name': '景顺长城纳斯达克科技市值加权ETF联接A',
        'short': '景顺纳指科技',
        'keywords': ['纳斯达克', '科技', '纳指', 'TECH', 'NDX', 'NASDAQ'],
        'index_patterns': [r'纳斯达克\s*科技', r'NASDAQ\s*100\s*TECH', r'纳指\s*科技'],
    },
}

W_HOLDINGS = 0.50
W_CORR = 0.30
W_INDEX = 0.20


def _norm_ticker(t):
    if not t:
        return ''
    return re.sub(r'[\s\.\-_]', '', str(t)).upper()


def holdings_overlap(h1, h2):
    """两只基金前十大重仓股的加权重合度。

    使用 sum(min(w_i)) / 平均总权重, 衡量两个组合的实际重合比例。
    返回 0..1, 数据缺失返回 None。
    """
    if not h1 or not h2:
        return None
    d1 = {}
    for x in h1:
        k = _norm_ticker(x.get('ticker'))
        if k:
            d1[k] = d1.get(k, 0) + (x.get('weight') or 0)
    d2 = {}
    for x in h2:
        k = _norm_ticker(x.get('ticker'))
        if k:
            d2[k] = d2.get(k, 0) + (x.get('weight') or 0)
    if not d1 or not d2:
        return None
    shared = set(d1) & set(d2)
    if not shared:
        return 0.0
    sum_min = sum(min(d1[k], d2[k]) for k in shared)
    total = (sum(d1.values()) + sum(d2.values())) / 2
    if total <= 0:
        return 0.0
    return float(min(1.0, sum_min / total))


def return_correlation(nav1, nav2, window=90, min_overlap=30):
    """近 window 天日收益率 Pearson 相关性, 映射 (corr+1)/2 到 0..1。

    数据不足返回 None。
    """
    if not nav1 or not nav2:
        return None
    try:
        s1 = pd.DataFrame(nav1)
        s2 = pd.DataFrame(nav2)
        if 'date' not in s1.columns or 'date' not in s2.columns:
            return None
        s1 = s1[['date', 'nav']].dropna()
        s2 = s2[['date', 'nav']].dropna()
        s1['date'] = s1['date'].astype(str)
        s2['date'] = s2['date'].astype(str)
        s1 = s1.drop_duplicates('date').set_index('date').sort_index()['nav'].astype(float)
        s2 = s2.drop_duplicates('date').set_index('date').sort_index()['nav'].astype(float)
        r1 = s1.pct_change().dropna()
        r2 = s2.pct_change().dropna()
        df = pd.DataFrame({'a': r1, 'b': r2}).dropna().tail(window)
        if len(df) < min_overlap:
            return None
        c = df['a'].corr(df['b'])
        if c is None or np.isnan(c):
            return None
        return float((c + 1) / 2)
    except Exception:
        return None


def index_similarity(fund_name, fund_info, ref_meta):
    """基于基金名称 + 基本信息 + 跟踪标的 的指数相似度启发式评分。

    强匹配: 名称中包含参考指数特征词组 (返回 0.7..1.0)
    中匹配: 包含参考的部分关键词 (返回 0.3..0.6)
    弱匹配: 仅地域相同 (返回 0..0.2)
    """
    text_parts = [str(fund_name or '')]
    if isinstance(fund_info, dict):
        for k in ('跟踪标的', '业绩比较基准', '投资目标', '基金类型'):
            if fund_info.get(k):
                text_parts.append(str(fund_info[k]))
    text = ' '.join(text_parts)
    text_u = text.upper()

    # 1) 强模式匹配
    for pat in ref_meta.get('index_patterns', []):
        if re.search(pat, text, flags=re.IGNORECASE):
            return 1.0

    # 2) 关键词计分
    kws = ref_meta.get('keywords', [])
    hits = sum(1 for kw in kws if kw.upper() in text_u)
    kw_score = min(1.0, hits / max(2.0, len(kws) * 0.5))

    # 3) 同地域 (美股) 弱加分
    region_score = 0.0
    us_kw = ['美国', '美股', '纳斯达克', '标普', 'S&P', '道琼斯']
    if any(k in text for k in us_kw):
        region_score = 0.15

    return float(max(kw_score * 0.7, region_score))


def composite(h_sim, c_sim, i_sim):
    """三者加权综合, 数据缺失时按可用项归一化, 输出 0..100。"""
    parts = []
    weights = []
    if h_sim is not None:
        parts.append(W_HOLDINGS * h_sim)
        weights.append(W_HOLDINGS)
    if c_sim is not None:
        parts.append(W_CORR * c_sim)
        weights.append(W_CORR)
    if i_sim is not None:
        parts.append(W_INDEX * i_sim)
        weights.append(W_INDEX)
    if not weights:
        return None
    total_w = sum(weights)
    return round(sum(parts) / total_w * 100, 2)


def compute_for_fund(fund, refs_data):
    """对一只基金, 计算与所有参考基金的相似度。

    fund: dict, 至少包含 'code','name'; 可选 'holdings'(list), 'nav'(list), 'basic'(dict)
    refs_data: {ref_code: {'meta':..., 'holdings':..., 'nav':..., 'basic':...}}
    返回: {ref_code: {'score', 'holdings', 'correlation', 'index'}}
    """
    out = {}
    f_holdings = fund.get('holdings') or []
    f_nav = fund.get('nav')
    f_basic = fund.get('basic')
    f_name = fund.get('name', '')

    for ref_code, ref in refs_data.items():
        meta = ref.get('meta') or REFERENCES.get(ref_code, {})
        ref_holdings = (ref.get('holdings') or {}).get('holdings') if isinstance(ref.get('holdings'), dict) else ref.get('holdings')
        ref_nav = ref.get('nav')

        h = holdings_overlap(f_holdings, ref_holdings)
        c = return_correlation(f_nav, ref_nav)
        i = index_similarity(f_name, f_basic, meta)
        out[ref_code] = {
            'score': composite(h, c, i),
            'holdings': round(h * 100, 2) if h is not None else None,
            'correlation': round(c * 100, 2) if c is not None else None,
            'index': round(i * 100, 2) if i is not None else None,
        }
    return out
