import json
import math
import time
import os
import sys
import urllib.request
import ssl
import re

sys.stdout.reconfigure(encoding='utf-8')

SITE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(SITE_ROOT, 'bubble-monitor', 'bubble_data.json')
NDX_FILE = os.path.join(os.path.dirname(__file__), 'ndx_full_history.csv')

PROXY = os.environ.get('BUBBLE_MONITOR_PROXY', '').strip()


def setup_proxy():
    proxy_handler = urllib.request.ProxyHandler(
        {'http': PROXY, 'https': PROXY} if PROXY else {}
    )
    opener = urllib.request.build_opener(proxy_handler)
    urllib.request.install_opener(opener)
    return ssl.create_default_context()


def fetch_json(url, ctx, timeout=30):
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
    return json.loads(resp.read().decode('utf-8'))


def fetch_ndx_history(ctx):
    end = int(time.time()) + 86400
    url = (
        'https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX'
        f'?period1=473385600&period2={end}&interval=1d&events=history'
    )
    payload = fetch_json(url, ctx, timeout=45)
    result = payload.get('chart', {}).get('result', [None])[0]
    if not result:
        raise RuntimeError('Yahoo ^NDX payload missing result')
    closes = result.get('indicators', {}).get('quote', [{}])[0].get('close', [])
    rows = ['Date,Close']
    for timestamp, close in zip(result.get('timestamp', []), closes):
        if close is None:
            continue
        date = time.strftime('%Y-%m-%d', time.gmtime(timestamp))
        rows.append(f'{date},{close}')
    if len(rows) < 201:
        raise RuntimeError('Yahoo ^NDX history is unexpectedly short')
    with open(NDX_FILE, 'w', encoding='utf-8', newline='') as handle:
        handle.write('\n'.join(rows) + '\n')
    return len(rows) - 1


def calc_ndx_trend():
    dates, closes = [], []
    with open(NDX_FILE, 'r') as f:
        f.readline()
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 2 and parts[1]:
                try:
                    dates.append(parts[0][:10])
                    closes.append(float(parts[1]))
                except:
                    pass
    n = len(closes)
    if n < 200:
        return None

    log_p = [math.log(c) for c in closes]
    x = list(range(n))
    xm, ym = sum(x) / n, sum(log_p) / n
    ssxy = sum((x[i] - xm) * (log_p[i] - ym) for i in range(n))
    ssxx = sum((x[i] - xm) ** 2 for i in range(n))
    slope = ssxy / ssxx
    intercept = ym - slope * xm
    residuals = [log_p[i] - (slope * x[i] + intercept) for i in range(n)]
    std_resid = math.sqrt(sum(r ** 2 for r in residuals) / n)
    annual_growth = (math.exp(slope * 252) - 1) * 100

    def point(idx):
        ma200 = sum(closes[idx - 199:idx + 1]) / 200 if idx >= 199 else None
        pred_log = slope * idx + intercept
        pred = math.exp(pred_log)
        sigma = (math.log(closes[idx]) - pred_log) / std_resid
        dev_lr = (closes[idx] - pred) / pred * 100
        dev_ma200 = (closes[idx] - ma200) / ma200 * 100 if ma200 else None
        return {
            'date': dates[idx], 'ndx': round(closes[idx], 2),
            'ma200': round(ma200, 2) if ma200 else None,
            'dev_ma200': round(dev_ma200, 2) if dev_ma200 is not None else None,
            'predicted': round(pred, 2), 'dev_lr': round(dev_lr, 2),
            'sigma': round(sigma, 2),
        }

    current = point(n - 1)

    events_spec = [
        ('1985-10', 'first', 'NDX\u6210\u7acb'),
        ('1990-10', 'min', '1990\u5e74\u8870\u9000\u5e95\u90e8'),
        ('1998-10', 'min', 'LTCM\u5371\u673a\u5e95\u90e8'),
        ('1999-12', 'max', 'dot-com\u6ce1\u6cab\u524d\u591c'),
        ('2000-03', 'max', 'dot-com\u6ce1\u6cab\u9876\u5cf0'),
        ('2000-05', 'min', 'dot-com\u521d\u6b21\u66b4\u8dcc'),
        ('2001-09', 'min', '9/11\u5e95\u90e8'),
        ('2002-10', 'min', '\u4e92\u8054\u7f51\u6ce1\u6cab\u5e95\u90e8'),
        ('2007-10', 'max', '\u6b21\u8d37\u6ce1\u6cab\u9876\u5cf0'),
        ('2009-03', 'min', '\u91d1\u878d\u5371\u673a\u5e95\u90e8'),
        ('2010-05', 'min', 'Flash Crash\u5e95\u90e8'),
        ('2011-10', 'min', '\u7f8e\u503a\u5371\u673a\u5e95\u90e8'),
        ('2015-08', 'min', 'A\u80a1\u4f20\u5bfc\u5e95\u90e8'),
        ('2018-12', 'min', '2018\u5e7412\u6708\u5e95\u90e8'),
        ('2020-03', 'min', 'COVID\u5e95\u90e8'),
        ('2021-11', 'max', '\u75ab\u540e\u725b\u5e02\u5cf0\u503c'),
        ('2022-12', 'min', '2022\u718a\u5e02\u5e95\u90e8'),
        ('2026-03', 'min', '\u4f0a\u6717\u51b2\u7a81\u5e95\u90e8'),
    ]

    historical = []
    for prefix, mode, label in events_spec:
        matching = [(i, closes[i]) for i in range(len(dates)) if dates[i].startswith(prefix)]
        if not matching:
            continue
        if mode == 'max':
            idx = max(matching, key=lambda t: t[1])[0]
        elif mode == 'min':
            idx = min(matching, key=lambda t: t[1])[0]
        else:
            idx = matching[0][0]
        p = point(idx)
        p['label'] = label
        historical.append(p)

    peak_comparisons = []
    for p in historical:
        if p['label'] in ['dot-com\u6ce1\u6cab\u9876\u5cf0', '\u6b21\u8d37\u6ce1\u6cab\u9876\u5cf0', '\u75ab\u540e\u725b\u5e02\u5cf0\u503c']:
            peak_comparisons.append(p)

    return {
        'annual_growth': round(annual_growth, 2),
        'data_points': n,
        'current': current,
        'historical': historical,
        'peak_comparisons': peak_comparisons,
    }


def fetch_vix(ctx):
    d = fetch_json('https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=.VIX&output=json', ctx)
    q = d['QuickQuoteResult']['QuickQuote'][0]
    return {'value': float(q['last']), 'change_pct': float(q.get('change_pct', 0))}


def fetch_ndx_price(ctx):
    d = fetch_json('https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=.NDX&output=json', ctx)
    q = d['QuickQuoteResult']['QuickQuote'][0]
    hi = q.get('FundamentalData', {})
    return {
        'last': float(q['last']),
        'change_pct': float(q.get('change_pct', 0)),
        'high_52w': float(hi.get('yrhiprice', 0)),
        'low_52w': float(hi.get('yrloprice', 0)),
        'prev_close': float(q.get('previous_day_closing', 0)),
    }


def fetch_fear_greed(ctx):
    req = urllib.request.Request('https://production.dataviz.cnn.io/index/fearandgreed/graphdata')
    req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')
    req.add_header('Accept', 'application/json')
    req.add_header('Referer', 'https://edition.cnn.com/')
    req.add_header('Origin', 'https://edition.cnn.com')
    resp = urllib.request.urlopen(req, timeout=15, context=ctx)
    d = json.loads(resp.read().decode('utf-8'))
    fg = d.get('fear_and_greed', {})
    return {
        'value': float(fg.get('score', 0)),
        'rating': fg.get('rating', ''),
        'previous_1_week': float(d.get('previous_1_week', {}).get('score', 0) or 0),
        'previous_1_month': float(d.get('previous_1_month', {}).get('score', 0) or 0),
    }


def fetch_put_call(ctx):
    req = urllib.request.Request('https://www.cboe.com/us/options/market_statistics/daily/')
    req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')
    resp = urllib.request.urlopen(req, timeout=15, context=ctx)
    data = resp.read().decode('utf-8')
    total_m = re.search(r'TOTAL PUT/CALL RATIO[^"]*"[^"]*"value":"([\d.]+)"', data)
    equity_m = re.search(r'EQUITY PUT/CALL RATIO[^"]*"[^"]*"value":"([\d.]+)"', data)
    if not total_m:
        total_m = re.search(r'TOTAL PUT/CALL RATIO.*?([\d.]+)', data)
    if not equity_m:
        equity_m = re.search(r'EQUITY PUT/CALL RATIO.*?([\d.]+)', data)
    return {
        'total': float(total_m.group(1)) if total_m else None,
        'equity': float(equity_m.group(1)) if equity_m else None,
    }


def fetch_sp500_pe(ctx):
    req = urllib.request.Request('https://www.multpl.com/s-p-500-pe-ratio')
    req.add_header('User-Agent', 'Mozilla/5.0')
    resp = urllib.request.urlopen(req, timeout=15, context=ctx)
    text = resp.read().decode('utf-8')
    m = re.search(r'S&amp;P 500 PE Ratio is ([\d.]+)', text)
    if not m:
        m = re.search(r'PE Ratio is ([\d.]+)', text)
    if not m:
        m = re.search(r'content=".*?([\d]+\.[\d]+).*?"', text[:5000])
    return {'value': float(m.group(1)) if m else None}


def fetch_shiller_cape(ctx):
    try:
        req = urllib.request.Request('https://www.multpl.com/shiller-pe')
        req.add_header('User-Agent', 'Mozilla/5.0')
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        text = resp.read().decode('utf-8')
        m = re.search(r'Shiller PE Ratio is ([\d.]+)', text)
        if not m:
            m = re.search(r'content=".*?([\d]+\.[\d]+).*?"', text[:5000])
        return {'value': float(m.group(1)) if m else None}
    except:
        return {'value': None}


def fetch_qqq_pe(ctx):
    d = fetch_json('https://api.stockanalysis.com/api/symbol/e/qqq/overview', ctx)
    data = d.get('data', {})
    return {
        'pe': float(data.get('peRatio', 0)),
        'top10_pct': float(data.get('holdingsTable', {}).get('top10', 0)),
        'holdings_count': int(data.get('holdingsTable', {}).get('count', 0)),
        'beta': float(data.get('beta', 0)),
        'aum': data.get('aum', ''),
    }


def fetch_ndx_concentration():
    try:
        req = urllib.request.Request('https://www.slickcharts.com/nasdaq100')
        req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')
        ctx = setup_proxy()
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        html = resp.read().decode('utf-8')
        rows = re.findall(r'<tr>\s*<td>(\d+)</td>\s*<td[^>]*>.*?</td>\s*<td>([^<]+)</td>\s*<td>(\d+\.\d+)%</td>', html, re.DOTALL)
        if not rows:
            rows = re.findall(r'(\d+)\.\s*<a[^>]*class="symbol"[^>]*>([^<]+)</a>.*?(\d+\.\d+)%', html, re.DOTALL)
        if rows:
            names = [r[1].strip() for r in rows]
            weights = [float(r[2]) for r in rows]
        else:
            tds = re.findall(r'class="symbol"[^>]*>([^<]+)<.*?<td>(\d+\.\d+)%</td>', html, re.DOTALL)
            names = [t[0].strip() for t in tds]
            weights = [float(t[1]) for t in tds]
        if not names:
            raise Exception('parse failed')
        return {
            'top5': round(sum(weights[:5]), 2),
            'top10': round(sum(weights[:10]), 2),
            'top1_name': names[0] if names else '',
            'top1_weight': weights[0] if weights else 0,
            'all_weights': weights[:20],
            'all_names': names[:20],
        }
    except:
        qqq = fetch_qqq_pe(setup_proxy())
        return {
            'top5': 45.99, 'top10': 67.79,
            'top1_name': 'NVDA', 'top1_weight': 13.32,
            'all_weights': [13.32,10.97,7.85,7.47,6.38,5.93,5.18,4.10,3.94,2.65,2.14,1.89,1.60,1.56,1.14,0.97,0.94,0.94,0.88,0.84],
            'all_names': ['NVDA','AAPL','MSFT','AMZN','GOOGL','GOOG','AVGO','TSLA','META','WMT','MU','AMD','INTC','ASML','COST','CSCO','NFLX','LRCX','AMAT','PLTR'],
        }


def fetch_margin_debt(ctx):
    return {
        'total_b': 1214,
        'yoy_change_b': 299,
        'pct_of_market': 0.41,
        'sigma': 1.08,
        'source': 'FINRA (Nov 2025)',
    }


def fetch_buffett_indicator(ctx):
    return {
        'value': 230,
        'sigma': 2.4,
        'market_cap_t': 72.14,
        'gdp_t': 31.33,
        'source': 'CMV (Dec 2025)',
    }


def fetch_hy_spread(ctx):
    return {
        'value': 2.81,
        'mean': 5.23,
        'sigma': -1.0,
        'source': 'ICE BofA US HY OAS (Dec 2025)',
    }


def fetch_ipo_stats(ctx):
    req = urllib.request.Request('https://stockanalysis.com/ipos/statistics/')
    req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    resp = urllib.request.urlopen(req, timeout=15, context=ctx)
    text = resp.read().decode('utf-8')
    m2025 = re.search(r'There were (\d+) IPOs in 2025', text)
    return {
        'y2025': int(m2025.group(1)) if m2025 else 347,
        'y2021': 1035,
        'y1999': 400,
    }


def safe_fetch(label, fn, *args, default=None):
    try:
        r = fn(*args)
        print(f'  [{label}] OK')
        return r
    except Exception as e:
        print(f'  [{label}] FAILED: {e}')
        return default


def load_cached():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def update_all():
    ctx = setup_proxy()
    cached = load_cached()

    print('[1/12] Fetching NDX history...')
    try:
        fetch_ndx_history(ctx)
    except Exception as e:
        print(f'  NDX history failed: {e}, using cached data')

    print('[2/12] Calculating NDX trend...')
    ndx_trend = calc_ndx_trend()

    print('[3/12] Fetching VIX...')
    vix = safe_fetch('VIX', fetch_vix, ctx, default=cached.get('vix'))

    print('[4/12] Fetching Fear & Greed...')
    fear_greed = safe_fetch('F&G', fetch_fear_greed, ctx, default=cached.get('fear_greed'))

    print('[5/12] Fetching Put/Call...')
    pcr = safe_fetch('P/C', fetch_put_call, ctx, default=cached.get('put_call'))

    print('[6/12] Fetching S&P 500 PE...')
    sp500_pe = safe_fetch('SP500 PE', fetch_sp500_pe, ctx, default=cached.get('sp500_pe'))

    print('[7/12] Fetching Shiller CAPE...')
    cape = safe_fetch('CAPE', fetch_shiller_cape, ctx, default=cached.get('shiller_cape'))

    print('[8/12] Fetching QQQ PE...')
    qqq = safe_fetch('QQQ', fetch_qqq_pe, ctx, default=cached.get('qqq'))

    print('[9/12] Fetching NDX concentration...')
    ndx_conc = safe_fetch('Concentration', fetch_ndx_concentration, default=cached.get('ndx_concentration'))

    print('[10/12] Fetching macro indicators...')
    margin = safe_fetch('Margin', fetch_margin_debt, ctx, default=cached.get('margin_debt'))
    buffett = safe_fetch('Buffett', fetch_buffett_indicator, ctx, default=cached.get('buffett_indicator'))
    hy_spread = safe_fetch('HY Spread', fetch_hy_spread, ctx, default=cached.get('hy_spread'))

    print('[11/12] Fetching IPO stats...')
    ipo = safe_fetch('IPO', fetch_ipo_stats, ctx, default=cached.get('ipo'))

    print('[12/12] Fetching NDX price...')
    ndx_price = safe_fetch('NDX Price', fetch_ndx_price, ctx, default=cached.get('ndx_price'))

    result = {
        'updated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'ndx_trend': ndx_trend,
        'ndx_price': ndx_price,
        'vix': vix,
        'fear_greed': fear_greed,
        'put_call': pcr,
        'sp500_pe': sp500_pe,
        'shiller_cape': cape,
        'qqq': qqq,
        'ndx_concentration': ndx_conc,
        'margin_debt': margin,
        'buffett_indicator': buffett,
        'hy_spread': hy_spread,
        'ipo': ipo,
    }

    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f'Done. Updated at {result["updated_at"]}')
    return result


if __name__ == '__main__':
    update_all()
