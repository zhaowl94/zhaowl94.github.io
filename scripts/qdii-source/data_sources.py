"""多源 QDII 基金数据采集, 带文件缓存。

数据源 (按优先级):
  1. eastmoney_akshare  - akshare 封装的天天基金接口 (列表/持仓/净值/限购, 主源)
  2. eastmoney_html     - 直接抓 fundf10.eastmoney.com 详情页 (跟踪标的/基准, 校验源)
  3. fundgz             - fundgz.1234567.com.cn 实时估值 (实时净值校验源)
  4. sina               - 新浪财经基金接口 (净值交叉校验源)

所有函数: 成功返回数据/字典, 失败返回 None。绝不抛异常给上层。
"""
import os
import re
import json
import time
import threading
from datetime import datetime

import requests
from bs4 import BeautifulSoup

CACHE_DIR = os.environ.get(
    'QDII_CACHE_DIR',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '_cache'),
)
os.makedirs(CACHE_DIR, exist_ok=True)
_cache_lock = threading.Lock()

# akshare 内部使用 py_mini_racer (JS引擎) 解析响应, 该引擎非线程安全,
# 多线程并发调用会导致 segfault。此锁序列化所有 akshare 调用。
_akshare_lock = threading.Lock()

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')


# ---------------- 缓存 ----------------

def _cache_path(key):
    safe = ''.join(c if c.isalnum() or c in '-_.' else '_' for c in str(key))
    return os.path.join(CACHE_DIR, f'{safe}.json')


def cache_get(key, ttl_seconds):
    p = _cache_path(key)
    with _cache_lock:
        if not os.path.exists(p):
            return None
        try:
            with open(p, 'r', encoding='utf-8') as f:
                d = json.load(f)
            if ttl_seconds is not None and (time.time() - d.get('_ts', 0)) > ttl_seconds:
                return None
            return d.get('data')
        except Exception:
            return None


def cache_set(key, value):
    if value is None:
        return
    p = _cache_path(key)
    with _cache_lock:
        try:
            with open(p, 'w', encoding='utf-8') as f:
                json.dump({'_ts': time.time(), 'data': value}, f, ensure_ascii=False)
        except Exception:
            pass


def _safe_float(v):
    try:
        if v is None or v == '' or (isinstance(v, float) and (v != v)):
            return None
        return float(v)
    except (ValueError, TypeError):
        return None


# ---------------- 源1: akshare / eastmoney ----------------

def fetch_qdii_list_em():
    """拉取全部 QDII 基金列表 + 每日限购额度 + 申赎状态。返回 list[dict]。

    QDII 覆盖两类基金类型:
      - 'QDII-*' 系列 (QDII-普通股票/QDII-混合/QDII-纯债/QDII-商品/QDII-FOF 等, 主动管理)
      - '指数型-海外股票' (QDII 指数基金/ETF联接/LOF, 被动跟踪海外指数, 如纳指/标普/恒生联接)
    """
    import akshare as ak
    with _akshare_lock:
        df = ak.fund_purchase_em()
    qdii = df[df['基金类型'].astype(str).str.contains('QDII|海外', na=False, regex=True)].copy()
    funds = []
    for _, r in qdii.iterrows():
        code = str(r.get('基金代码') or '').zfill(6)
        if not code or code == '000000' or len(code) != 6:
            continue
        funds.append({
            'code': code,
            'name': str(r.get('基金简称') or '').strip(),
            'type': str(r.get('基金类型') or '').strip(),
            'nav': _safe_float(r.get('最新净值/万份收益')),
            'nav_date': str(r.get('最新净值/万份收益-报告时间') or '').strip(),
            'purchase_status': str(r.get('申购状态') or '').strip(),
            'redeem_status': str(r.get('赎回状态') or '').strip(),
            'daily_quota': _safe_float(r.get('日累计限定金额')) or 0.0,
            'min_purchase': _safe_float(r.get('购买起点')),
            'fee_rate': _safe_float(r.get('手续费')),
        })
    return funds


def _latest_quarter_filter(df):
    """从 fund_portfolio_hold_em 返回的 df 中取最新季度。返回 (sub_df, quarter_label)。"""
    qcols = [c for c in df.columns if '季度' in str(c)]
    if not qcols:
        return None, None
    col = qcols[0]

    def qkey(q):
        m = re.search(r'(\d{4})\s*年.*?(\d)\s*季度', str(q))
        return int(m.group(1)) * 10 + int(m.group(2)) if m else 0

    quarters = [q for q in df[col].unique() if qkey(q) > 0]
    if not quarters:
        return None, None
    latest = max(quarters, key=qkey)
    return df[df[col] == latest].copy(), str(latest)


# 3 只参考基准基金的 ETF 联接映射 (联接基金本身无股票持仓, 取对应 ETF)
# key = 联接基金代码, value = 对应 ETF 代码
REFERENCE_ETF_MAP = {
    '270042': '159941',  # 广发纳斯达克100ETF联接A -> 广发纳指ETF
    '017091': '159509',  # 景顺长城纳指科技联接A -> 景顺纳指科技ETF
    '161128': '161128',  # 易方达标普信息科技 LOF (本身就有持仓)
}

# 主流基金公司简称 (用于从基金名提取公司)
_FUND_COMPANIES = [
    '广发', '嘉实', '易方达', '华安', '博时', '华夏', '南方', '汇添富', '富国',
    '招商', '华泰柏瑞', '国泰', '景顺长城', '大成', '工银瑞信', '鹏华', '银华',
    '平安', '华宝', '万家', '天弘', '建信', '长城', '永赢', '前海开源',
    '国联安', '国联', '东财', '东方', '华泰', '申万', '兴业', '中银', '上投',
    '华泰证券', '中信', '中信保诚', '安信', '诺安', '长信', '国寿', '人保',
    # 场内 ETF 短名里的公司简称
    '景顺', '工银',
]

# 公司名归一化: 场内ETF短名用简称, 联接基金用全称, 统一映射
_COMPANY_CANON = {
    '景顺': '景顺长城',
    '工银': '工银瑞信',
}

# 指数主题归一化: 不同写法 -> 规范key
_INDEX_ALIASES = {
    '纳斯达克100': 'NDX100', '纳斯达克': 'NDX100', '纳指100': 'NDX100', '纳指': 'NDX100',
    '纳斯达克科技': 'NDX_TECH', '纳指科技': 'NDX_TECH',
    '标普500': 'SP500', '标普': 'SP500', 'S&P500': 'SP500',
    '标普信息科技': 'SP_TECH', '标普科技': 'SP_TECH',
    '标普消费品': 'SP_CONS',
    '恒生科技': 'HS_TECH', '恒生互联网': 'HS_NET',
    '恒生生物科技': 'HS_BIO', '恒生医药': 'HS_MED',
    '日经': 'N225', '德国': 'DAX', '法国': 'CAC',
    '中概互联': 'CN_NET', '中概互联网': 'CN_NET',
    '越南': 'VN', '印度': 'IN',
    '石油': 'OIL', '油气': 'OIL', '原油': 'OIL',
    '黄金': 'GOLD', '半导体': 'SEMI', '芯片': 'CHIP',
    '生物科技': 'BIO', '生物医药': 'BIO',
}


def _extract_signature(name):
    """从基金名提取 (公司规范名, 指数主题集合) 签名, 用于联接↔ETF 模糊匹配。

    最长优先匹配: 公司名长>短, 指数别名长>短且非重叠 (避免"纳斯达克科技"被
    同时识别为 NDX100 + NDX_TECH)。
    """
    s = str(name)
    # 公司: 最长优先
    company = None
    for c in sorted(_FUND_COMPANIES, key=len, reverse=True):
        if c in s:
            company = _COMPANY_CANON.get(c, c)
            break
    # 指数: 最长优先, 命中后从工作串移除 (非重叠)
    indices = set()
    work = s
    for alias in sorted(_INDEX_ALIASES.keys(), key=len, reverse=True):
        if alias in work:
            indices.add(_INDEX_ALIASES[alias])
            work = work.replace(alias, ' ' * len(alias))
    return company, indices


def _parse_holdings_df(df):
    """从 fund_portfolio_hold_em 返回的 df 中提取最新季度的重仓股列表。"""
    sub, label = _latest_quarter_filter(df)
    if sub is None or len(sub) == 0:
        return None
    out = []
    for _, r in sub.iterrows():
        ticker = str(r.iloc[1]).strip() if len(r) > 1 else ''
        name = str(r.iloc[2]).strip() if len(r) > 2 else ''
        weight = _safe_float(r.iloc[3]) if len(r) > 3 else None
        if not ticker or ticker == 'nan':
            continue
        out.append({'ticker': ticker, 'name': name, 'weight': weight or 0.0})
    if not out:
        return None
    return {'quarter': label, 'holdings': out}


def fetch_holdings_em(code):
    """拉取基金最新季度的前十大重仓股。返回 {'quarter': str, 'holdings': [...]} 或 None。

    联接基金(持有ETF而非股票)此处返回 None, 由上层 resolve_holdings 做 ETF 映射。
    """
    import akshare as ak
    this_year = datetime.now().year
    for yr in (str(this_year), str(this_year - 1)):
        try:
            with _akshare_lock:
                df = ak.fund_portfolio_hold_em(symbol=code, date=yr)
            if df is not None and len(df) > 0:
                return _parse_holdings_df(df)
        except Exception:
            continue
    return None


def build_etf_lookup(funds):
    """构建联接基金→ETF 的查找索引。返回 dict 含两种匹配方式:
      - 'by_name': {规范化名称 -> ETF代码}  (精确名匹配)
      - 'by_sig':  {(公司, frozenset(指数)) -> ETF代码}  (公司+指数主题匹配, 覆盖短名ETF)
    """
    import akshare as ak
    # 收集所有场内 ETF (代码 159xxx / 5xxxxx, 名含 ETF, 不含联接)
    etf_items = []  # [(code, name)]
    for f in funds:
        name = f.get('name', '')
        code = f.get('code', '')
        if ('ETF' in name and '联接' not in name and
                (code.startswith('15') or code.startswith('5')) and len(code) == 6):
            etf_items.append((code, name))
    # 补 fund_name_em 全量场内 ETF
    try:
        import akshare as ak
        with _akshare_lock:
            df_all = ak.fund_name_em()
        code_col = df_all.columns[0]
        name_col = df_all.columns[2]
        for _, r in df_all.iterrows():
            code = str(r[code_col]).zfill(6)
            name = str(r[name_col])
            if ('ETF' in name and '联接' not in name and
                    (code.startswith('15') or code.startswith('5')) and len(code) == 6):
                if not any(c == code for c, _ in etf_items):
                    etf_items.append((code, name))
    except Exception as e:
        import logging
        logging.getLogger('qdii').warning(f'build_etf_lookup fund_name_em failed: {e}')

    by_name = {}
    by_sig = {}
    for code, name in etf_items:
        key = _normalize_fund_name(name)
        if key:
            by_name.setdefault(key, code)
        company, indices = _extract_signature(name)
        if company and indices:
            by_sig.setdefault((company, frozenset(indices)), code)
    return {'by_name': by_name, 'by_sig': by_sig, '_count': len(etf_items)}


def get_etf_lookup(funds, ttl=7 * 24 * 3600):
    """获取 ETF 映射表 (带磁盘缓存)。"""
    cached = cache_get('_etf_lookup', ttl)
    if cached and isinstance(cached, dict) and cached.get('by_name') and len(cached.get('by_name', {})) > 100:
        return cached
    lk = build_etf_lookup(funds)
    if len(lk.get('by_name', {})) > 100:
        cache_set('_etf_lookup', lk)
    return lk


def _normalize_fund_name(name):
    """规范化基金名称, 用于联接基金→ETF 名称匹配。

    顺序很重要: 先去括号内容, 再去关键词, 最后去尾部份额类后缀。
    确保联接基金 "广发纳斯达克100ETF联接人民币(QDII)A" 与
    场内ETF "广发纳斯达克100ETF" 规范化后一致 -> "广发纳斯达克100"。
    """
    if not name:
        return ''
    s = str(name)
    # 1) 去括号及内容: (QDII)(人民币)(美元现汇) 等
    s = re.sub(r'[（(][^）)]*[）)]', '', s)
    # 2) 去显式关键词 (注意: ETF/LOF 先于单字母)
    for kw in ['人民币', '美元现汇', '美元现钞', '美元', '联接', '发起式', 'ETF', 'LOF', 'QDII']:
        s = s.replace(kw, '')
    # 3) 去尾部份额类后缀: A/C/D/E/F/H/I/R 等 (仅在末尾, 避免误伤)
    s = re.sub(r'[A-Za-z]+$', '', s)
    # 4) 清理空格
    s = re.sub(r'\s+', '', s)
    return s.strip()


def resolve_holdings(code, name, etf_lookup):
    """解析基金持仓: 先取基金本身, 联接基金则取对应 ETF。
    返回 {'quarter', 'holdings', 'source': 'direct'|'etf:XXXXXX'} 或 None。

    etf_lookup 支持 dict {name->code} (旧格式) 或 {'by_name':{}, 'by_sig':{}} (新格式)。
    """
    # 兼容新旧格式
    if isinstance(etf_lookup, dict) and 'by_name' in etf_lookup:
        by_name = etf_lookup.get('by_name', {})
        by_sig = etf_lookup.get('by_sig', {})
    else:
        by_name = etf_lookup or {}
        by_sig = {}

    def _try_etf(etf_code):
        h = fetch_holdings_em(etf_code)
        if h:
            return {'quarter': h['quarter'], 'holdings': h['holdings'], 'source': f'etf:{etf_code}'}
        return None

    # 1) 基准联接基金的硬编码映射 (优先级最高)
    if code in REFERENCE_ETF_MAP and REFERENCE_ETF_MAP[code] != code:
        r = _try_etf(REFERENCE_ETF_MAP[code])
        if r:
            return r

    # 2) 基金本身持仓
    h = fetch_holdings_em(code)
    if h:
        return {'quarter': h['quarter'], 'holdings': h['holdings'], 'source': 'direct'}

    # 3) 联接基金: 按名称精确匹配 ETF
    if '联接' in str(name) and by_name:
        key = _normalize_fund_name(name)
        if key and key in by_name:
            r = _try_etf(by_name[key])
            if r:
                return r

    # 4) 联接基金: 按公司+指数主题模糊匹配 ETF (覆盖短名ETF如"纳指广发")
    if '联接' in str(name) and by_sig:
        company, indices = _extract_signature(name)
        if company and indices:
            etf_code = by_sig.get((company, frozenset(indices)))
            if etf_code:
                r = _try_etf(etf_code)
                if r:
                    return r

    return None


def fetch_nav_em(code):
    """拉取基金单位净值历史序列。返回 [{'date','nav'}] 或 None。"""
    import akshare as ak
    try:
        with _akshare_lock:
            df = ak.fund_open_fund_info_em(symbol=code, indicator='单位净值走势')
    except Exception:
        return None
    if df is None or len(df) == 0:
        return None
    rows = []
    for _, r in df.iterrows():
        d = str(r.iloc[0]).strip()
        v = _safe_float(r.iloc[1])
        if v is not None:
            rows.append({'date': d[:10], 'nav': v})
    return rows if rows else None


# ---------------- 源2: eastmoney 详情页 HTML ----------------

def fetch_basic_em(code):
    """解析 fundf10.eastmoney.com/jbgk_{code}.html 详情页。

    返回 {'跟踪标的','业绩比较基准','投资目标','基金类型','成立日期','风险等级', ...} 或 None。
    """
    url = f'https://fundf10.eastmoney.com/jbgk_{code}.html'
    try:
        r = requests.get(url, headers={'User-Agent': UA, 'Referer': 'https://fundf10.eastmoney.com/'},
                         timeout=12)
        if r.status_code != 200:
            return None
        r.encoding = 'utf-8'
    except Exception:
        return None

    try:
        soup = BeautifulSoup(r.text, 'html.parser')
    except Exception:
        return None

    info = {}
    for tbl in soup.find_all('table'):
        for row in tbl.find_all('tr'):
            cells = row.find_all(['th', 'td'])
            for i in range(0, len(cells) - 1, 2):
                label = cells[i].get_text(strip=True).rstrip('：:')
                val = cells[i + 1].get_text(strip=True)
                if label and val and label not in info:
                    info[label] = val
    # 只保留关键字段
    keep = ['基金类型', '成立日期', '风险等级', '跟踪标的', '业绩比较基准',
            '投资目标', '基金管理人', '基金托管人', '资产规模']
    return {k: v for k, v in info.items() if k in keep} or None


# ---------------- 源3: fundgz 实时估值 ----------------

def fetch_fundgz(code):
    """实时估值 + 最新净值。返回 {name, dwjz, gsz, gszzl, gztime, jzrq} 或 None。"""
    url = f'https://fundgz.1234567.com.cn/js/{code}.js?rt={int(time.time() * 1000)}'
    try:
        r = requests.get(url, headers={'User-Agent': UA, 'Referer': 'https://fund.eastmoney.com/'},
                         timeout=8)
        if r.status_code != 200:
            return None
        text = r.text.strip()
        m = re.search(r'jsonpgz\((.*)\);?$', text)
        if not m:
            return None
        d = json.loads(m.group(1))
        return {
            'name': d.get('name'),
            'dwjz': _safe_float(d.get('dwjz')),
            'gsz': _safe_float(d.get('gsz')),
            'gszzl': _safe_float(d.get('gszzl')),
            'gztime': d.get('gztime'),
            'jzrq': d.get('jzrq'),
        }
    except Exception:
        return None


# ---------------- 源4: 新浪财经 ----------------

def fetch_nav_sina(code):
    """新浪基金接口, 用于净值交叉校验。返回 {nav, nav_date, name} 或 None。"""
    urls = [
        f'https://finance.sina.com.cn/fund/api/openapi.php/CatonService.getFundInfo?callback=&fundcode={code}',
        f'https://hq.sinajs.cn/list=fu_{code}',
    ]
    try:
        r = requests.get(urls[0], headers={'User-Agent': UA, 'Referer': 'https://finance.sina.com.cn/'},
                         timeout=8)
        if r.status_code != 200:
            return None
        text = r.text.strip()
        # 可能是 jsonpgz(...) 或直接 json
        if text.startswith('('):
            text = text[1:]
        if text.endswith(')'):
            text = text[:-1]
        if text.endswith(';'):
            text = text[:-1]
        m = re.search(r'\{.*\}', text, re.S)
        if not m:
            return None
        d = json.loads(m.group(0))
        data = d.get('data') if isinstance(d, dict) else d
        if not isinstance(data, dict):
            return None
        return {
            'name': data.get('name') or data.get('fundname'),
            'nav': _safe_float(data.get('net') or data.get('dwjz') or data.get('unit_nav')),
            'nav_date': str(data.get('date') or data.get('jzrq') or ''),
        }
    except Exception:
        return None


# ---------------- 缓存键 ----------------

KEY_LIST = 'qdii_list'
KEY_HOLD = lambda c: f'hold_{c}'  # noqa: E731
KEY_NAV = lambda c: f'nav_{c}'    # noqa: E731
KEY_BASIC = lambda c: f'basic_{c}'  # noqa: E731

TTL_LIST = 6 * 3600       # 列表 6 小时
TTL_HOLD = 7 * 24 * 3600  # 持仓 7 天 (季度数据)
TTL_NAV = 12 * 3600       # 净值序列 12 小时
TTL_BASIC = 30 * 24 * 3600  # 基本信息 30 天
