#!/usr/bin/env python3
"""Build the public, deterministic Market Pulse snapshot.

The GitHub Pages edition intentionally has no model client, API key, SSE server,
or local database. It publishes a compact derived snapshot from delayed public
quotes and official constituent files. A previously valid snapshot is retained
when upstream coverage is too small.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import time as time_module
import zipfile
from datetime import date, datetime, time, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

import requests


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "market-pulse" / "data" / "state.json"
DEFAULT_CACHE = ROOT / "scripts" / "market-pulse-cache"
SPY_URL = (
    "https://www.ssga.com/us/en/intermediary/etfs/library-content/products/"
    "fund-data/etfs/us/holdings-daily-us-en-spy.xlsx"
)
NDX_URL = "https://api.nasdaq.com/api/quote/list-type/nasdaq100?assetclass=stocks"
SPARK_URL = "https://query1.finance.yahoo.com/v7/finance/spark"
USER_AGENT = "Mozilla/5.0 MarketPulseStatic/1.0 (+https://zhaowl94.github.io/market-pulse/)"
UTC = timezone.utc
ET_ZONE = ZoneInfo("America/New_York")

CHINESE_NAMES = {
    "AAPL": "苹果",
    "ABBV": "艾伯维",
    "ABNB": "爱彼迎",
    "ABT": "雅培",
    "ACN": "埃森哲",
    "ADBE": "奥多比",
    "ADI": "亚德诺",
    "ADP": "自动数据处理",
    "AMAT": "应用材料",
    "AMD": "AMD超威半导体",
    "AMGN": "安进",
    "AMZN": "亚马逊",
    "APP": "AppLovin",
    "ASML": "阿斯麦",
    "AVGO": "博通",
    "AXP": "美国运通",
    "BA": "波音",
    "BAC": "美国银行",
    "BKNG": "缤客控股",
    "BRK.B": "伯克希尔-哈撒韦B",
    "CAT": "卡特彼勒",
    "CEG": "星座能源",
    "CMCSA": "康卡斯特",
    "COST": "好市多",
    "CRM": "赛富时",
    "CRWD": "CrowdStrike",
    "CSCO": "思科",
    "CVX": "雪佛龙",
    "DASH": "DoorDash",
    "DIS": "迪士尼",
    "GE": "通用电气",
    "GILD": "吉利德科学",
    "GOOG": "谷歌C",
    "GOOGL": "谷歌A",
    "GS": "高盛",
    "HD": "家得宝",
    "HON": "霍尼韦尔",
    "IBM": "IBM",
    "INTC": "英特尔",
    "INTU": "财捷",
    "ISRG": "直觉外科",
    "JNJ": "强生",
    "JPM": "摩根大通",
    "KO": "可口可乐",
    "LIN": "林德",
    "LLY": "礼来",
    "LRCX": "泛林集团",
    "MA": "万事达卡",
    "MCD": "麦当劳",
    "META": "Meta",
    "MELI": "MercadoLibre",
    "MRK": "默沙东",
    "MRVL": "迈威尔科技",
    "MSFT": "微软",
    "MU": "美光科技",
    "NFLX": "奈飞",
    "NOW": "ServiceNow",
    "NVDA": "英伟达",
    "ORCL": "甲骨文",
    "PANW": "Palo Alto Networks",
    "PEP": "百事公司",
    "PFE": "辉瑞",
    "PG": "宝洁",
    "PLTR": "Palantir",
    "QCOM": "高通",
    "SBUX": "星巴克",
    "SHOP": "Shopify",
    "T": "美国电话电报",
    "TMUS": "T-Mobile美国",
    "TSLA": "特斯拉",
    "TXN": "德州仪器",
    "UBER": "优步",
    "UNH": "联合健康",
    "V": "Visa",
    "VRTX": "福泰制药",
    "WMT": "沃尔玛",
    "XOM": "埃克森美孚",
}


def iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z") if value else None


def normalize_symbol(value: str) -> str:
    symbol = (value or "").strip().upper().replace("/", ".")
    if symbol in {"BRK-B", "BRKB"}:
        return "BRK.B"
    if symbol in {"BF-B", "BFB"}:
        return "BF.B"
    return symbol


def yahoo_symbol(value: str) -> str:
    symbol = normalize_symbol(value)
    return symbol if symbol.startswith("^") else symbol.replace(".", "-")


def chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def percentile(values: dict[str, float]) -> dict[str, float]:
    ordered = sorted(values.items(), key=lambda item: (item[1], item[0]))
    denominator = max(1, len(ordered) - 1)
    return {symbol: rank / denominator for rank, (symbol, _) in enumerate(ordered)}


def nth_weekday(year: int, month: int, weekday: int, occurrence: int) -> date:
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + (occurrence - 1) * 7)


def last_weekday(year: int, month: int, weekday: int) -> date:
    end = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    return end - timedelta(days=(end.weekday() - weekday) % 7)


def easter_sunday(year: int) -> date:
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    ell = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ell) // 451
    month = (h + ell - 7 * m + 114) // 31
    day = (h + ell - 7 * m + 114) % 31 + 1
    return date(year, month, day)


def observed(day: date) -> date:
    if day.weekday() == 5:
        return day - timedelta(days=1)
    if day.weekday() == 6:
        return day + timedelta(days=1)
    return day


def market_holidays(year: int) -> set[date]:
    days = {
        nth_weekday(year, 1, 0, 3),
        nth_weekday(year, 2, 0, 3),
        easter_sunday(year) - timedelta(days=2),
        last_weekday(year, 5, 0),
        observed(date(year, 7, 4)),
        nth_weekday(year, 9, 0, 1),
        nth_weekday(year, 11, 3, 4),
        observed(date(year, 12, 25)),
    }
    new_year = date(year, 1, 1)
    if new_year.weekday() < 5:
        days.add(new_year)
    elif new_year.weekday() == 6:
        days.add(new_year + timedelta(days=1))
    if year >= 2022:
        days.add(observed(date(year, 6, 19)))
    return days


def is_session_day(day: date) -> bool:
    return day.weekday() < 5 and day not in market_holidays(day.year)


def session_bounds(day: date) -> tuple[datetime, datetime]:
    thanksgiving = nth_weekday(day.year, 11, 3, 4)
    early = (
        day == thanksgiving + timedelta(days=1)
        or (day.month == 12 and day.day == 24)
        or (day.month == 7 and day.day == 3)
    )
    return (
        datetime.combine(day, time(9, 30), tzinfo=ET_ZONE),
        datetime.combine(day, time(13 if early else 16, 0), tzinfo=ET_ZONE),
    )


def next_session_day(start: date) -> date:
    cursor = start
    for _ in range(370):
        if is_session_day(cursor):
            return cursor
        cursor += timedelta(days=1)
    raise RuntimeError("Could not resolve next US market session")


def market_clock(now: datetime) -> dict[str, Any]:
    local = now.astimezone(ET_ZONE)
    today = local.date()
    if is_session_day(today):
        open_at, close_at = session_bounds(today)
        if local < open_at:
            return {
                "status": "preopen",
                "label": "等待常规交易时段",
                "next_open": open_at,
                "next_close": close_at,
                "countdown": int((open_at - local).total_seconds()),
            }
        if local < close_at:
            return {
                "status": "open",
                "label": "常规交易时段 · 规则快照",
                "next_open": None,
                "next_close": close_at,
                "countdown": int((close_at - local).total_seconds()),
            }
    next_day = next_session_day(today + timedelta(days=1))
    next_open, next_close = session_bounds(next_day)
    return {
        "status": "closed",
        "label": "已收盘 · 展示最近有效快照",
        "next_open": next_open,
        "next_close": next_close,
        "countdown": int((next_open - local).total_seconds()),
    }


def cell_text(cell: ET.Element, shared: list[str], ns: dict[str, str]) -> str:
    if cell.attrib.get("t") == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//main:t", ns))
    value = cell.find("main:v", ns)
    if value is None or value.text is None:
        return ""
    if cell.attrib.get("t") == "s":
        try:
            return shared[int(value.text)]
        except (ValueError, IndexError):
            return ""
    return value.text


def read_xlsx_rows(content: bytes) -> list[list[str]]:
    with zipfile.ZipFile(BytesIO(content)) as archive:
        ns = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("main:si", ns):
                shared.append("".join(node.text or "" for node in item.findall(".//main:t", ns)))
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        rows: list[list[str]] = []
        for row in sheet.findall(".//main:sheetData/main:row", ns):
            values: dict[int, str] = {}
            for cell in row.findall("main:c", ns):
                letters = re.match(r"[A-Z]+", cell.attrib.get("r", "A1"))
                column = 0
                for char in letters.group(0) if letters else "A":
                    column = column * 26 + ord(char) - 64
                values[column - 1] = cell_text(cell, shared, ns).strip()
            if values:
                rows.append([values.get(index, "") for index in range(max(values) + 1)])
        return rows


def parse_spy(content: bytes) -> list[dict[str, Any]]:
    rows = read_xlsx_rows(content)
    header = ticker_col = name_col = weight_col = -1
    for index, row in enumerate(rows[:40]):
        lowered = [value.lower().strip() for value in row]
        for column, value in enumerate(lowered):
            if value in {"ticker", "ticker symbol"}:
                ticker_col = column
            if value in {"name", "security name", "company"}:
                name_col = column
            if "weight" in value:
                weight_col = column
        if ticker_col >= 0 and weight_col >= 0:
            header = index
            break
    if header < 0:
        raise ValueError("SPY header not found")
    result = []
    for row in rows[header + 1 :]:
        if max(ticker_col, weight_col) >= len(row):
            continue
        symbol = normalize_symbol(row[ticker_col])
        if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", symbol):
            continue
        try:
            weight = float(row[weight_col].replace("%", "").replace(",", ""))
        except ValueError:
            continue
        name = row[name_col].strip() if 0 <= name_col < len(row) else symbol
        result.append({"fund": "SPY", "symbol": symbol, "name": name or symbol, "weight": weight})
    if len(result) < 400:
        raise ValueError(f"SPY holdings incomplete: {len(result)}")
    if sum(item["weight"] for item in result) <= 2:
        for item in result:
            item["weight"] *= 100
    return result


def parse_ndx(payload: dict[str, Any]) -> list[dict[str, Any]]:
    root = payload.get("data") or {}
    nested = root.get("data") or {}
    rows = nested.get("rows") or []
    parsed = []
    for row in rows:
        symbol = normalize_symbol(str(row.get("symbol") or ""))
        try:
            market_cap = float(str(row.get("marketCap") or "").replace(",", "").replace("$", ""))
        except ValueError:
            continue
        if re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", symbol) and market_cap > 0:
            parsed.append((symbol, str(row.get("companyName") or symbol).strip(), market_cap))
    if len(parsed) < 90:
        raise ValueError(f"NDX components incomplete: {len(parsed)}")
    total = sum(item[2] for item in parsed)
    return [
        {"fund": "QQQ", "symbol": symbol, "name": name, "weight": cap / total * 100}
        for symbol, name, cap in parsed
    ]


def derive_qqq_proxy(spy_holdings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build an explicit large-cap proxy when Nasdaq's component API is unavailable.

    This is intentionally labelled as a proxy in the public snapshot. It keeps a
    first-run workflow useful without silently pretending that SPY constituents are
    the Nasdaq-100.
    """

    ranked = sorted(spy_holdings, key=lambda item: float(item.get("weight") or 0), reverse=True)[:100]
    total = sum(float(item.get("weight") or 0) for item in ranked)
    if len(ranked) < 90 or total <= 0:
        raise ValueError("SPY large-cap proxy universe is incomplete")
    return [
        {
            "fund": "QQQ",
            "symbol": item["symbol"],
            "name": item.get("name") or item["symbol"],
            "weight": float(item.get("weight") or 0) / total * 100,
        }
        for item in ranked
    ]


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def request_payload(
    url: str,
    *,
    headers: dict[str, str],
    binary: bool = False,
    attempts: int = 3,
    connect_timeout: int = 15,
    read_timeout: int = 30,
) -> Any:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = requests.get(
                url,
                headers=headers,
                timeout=(connect_timeout, read_timeout + attempt * 10),
            )
            response.raise_for_status()
            return response.content if binary else response.json()
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"source failed after {attempts} attempt(s): {last_error}")


def fetch_holdings(cache_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cache_path = cache_dir / "holdings.json"
    cached = load_json(cache_path) or {}
    cached_by_fund = {
        fund: [item for item in cached.get("holdings", []) if item.get("fund") == fund]
        for fund in ("SPY", "QQQ")
    }
    statuses = []
    combined = []
    fetchers = {
        "SPY": lambda: parse_spy(
            request_payload(
                SPY_URL,
                headers={"User-Agent": USER_AGENT},
                binary=True,
            )
        ),
        "QQQ": lambda: parse_ndx(
            request_payload(
                NDX_URL,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json,text/plain,*/*",
                    "Referer": "https://www.nasdaq.com/market-activity/quotes/nasdaq-ndx-index",
                },
                attempts=2,
                connect_timeout=8,
                read_timeout=15,
            )
        ),
    }
    for fund, fetcher in fetchers.items():
        try:
            fresh = fetcher()
            combined.extend(fresh)
            statuses.append(
                {
                    "source": "SPY官方持仓" if fund == "SPY" else "纳指100成分",
                    "status": "ok" if fund == "SPY" else "degraded",
                    "message": f"{len(fresh)}只；{('State Street官方权重' if fund == 'SPY' else 'Nasdaq成分与市值代理权重')}",
                }
            )
        except Exception as exc:  # retain a valid cached universe when a source is transiently unavailable
            fallback = cached_by_fund.get(fund) or []
            proxy_used = False
            if fund == "QQQ" and not fallback:
                spy_holdings = [item for item in combined if item.get("fund") == "SPY"]
                fallback = derive_qqq_proxy(spy_holdings)
                proxy_used = True
            if not fallback:
                raise RuntimeError(f"{fund} holdings unavailable and no cache exists: {exc}") from exc
            combined.extend(fallback)
            statuses.append(
                {
                    "source": "SPY官方持仓" if fund == "SPY" else "纳指100成分",
                    "status": "degraded",
                    "message": (
                        f"Nasdaq暂不可用；以SPY权重前{len(fallback)}只作为大盘股代理"
                        if proxy_used
                        else f"上游暂不可用，沿用缓存的{len(fallback)}只成分"
                    ),
                }
            )
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps({"updated_at": iso(datetime.now(UTC)), "holdings": combined}, ensure_ascii=False),
        encoding="utf-8",
    )
    return combined, statuses


def parse_spark_item(item: dict[str, Any]) -> dict[str, Any] | None:
    responses = item.get("response") or []
    if not responses:
        return None
    response = responses[0]
    meta = response.get("meta") or {}
    symbol = normalize_symbol(str(item.get("symbol") or meta.get("symbol") or ""))
    timestamps = response.get("timestamp") or []
    indicators = response.get("indicators") or {}
    quote_rows = indicators.get("quote") or []
    quote = quote_rows[0] if quote_rows else {}
    raw_closes = quote.get("close") or []
    raw_volumes = quote.get("volume") or []
    points = []
    for index, raw_close in enumerate(raw_closes):
        if raw_close is None:
            continue
        try:
            close = float(raw_close)
            volume = float(raw_volumes[index]) if index < len(raw_volumes) and raw_volumes[index] else 0.0
            point_time = int(timestamps[index]) if index < len(timestamps) else None
        except (TypeError, ValueError):
            continue
        if close > 0:
            points.append((point_time, close, volume))
    price = meta.get("regularMarketPrice") or (points[-1][1] if points else None)
    previous = meta.get("chartPreviousClose") or meta.get("previousClose")
    market_time = meta.get("regularMarketTime") or (points[-1][0] if points else None)
    if not symbol or price in (None, 0) or previous in (None, 0) or market_time is None:
        return None
    price = float(price)
    previous = float(previous)
    closes = [point[1] for point in points]
    volumes = [point[2] for point in points]
    five_change = (closes[-1] / closes[-2] - 1) * 100 if len(closes) >= 2 else None
    fifteen_change = (closes[-1] / closes[-4] - 1) * 100 if len(closes) >= 4 else None
    prior_volumes = [value for value in volumes[max(0, len(volumes) - 14) : -1] if value > 0]
    volume_pace = (
        volumes[-1] / statistics.median(prior_volumes)
        if volumes and volumes[-1] > 0 and prior_volumes
        else None
    )
    day_high = meta.get("regularMarketDayHigh")
    day_low = meta.get("regularMarketDayLow")
    range_pct = (
        (float(day_high) - float(day_low)) / previous * 100
        if day_high is not None and day_low is not None
        else 0.0
    )
    return {
        "symbol": symbol,
        "company_name": str(meta.get("longName") or meta.get("shortName") or symbol),
        "price": price,
        "change_pct": (price / previous - 1) * 100,
        "five_minute_change_pct": five_change,
        "fifteen_minute_change_pct": fifteen_change,
        "volume_pace": volume_pace,
        "range_pct": range_pct,
        "asof": datetime.fromtimestamp(float(market_time), tz=UTC),
        "sparkline": closes[-24:],
    }


def fetch_spark_batch(symbols: list[str]) -> dict[str, dict[str, Any]]:
    response = requests.get(
        SPARK_URL,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*"},
        params={
            "symbols": ",".join(yahoo_symbol(symbol) for symbol in symbols),
            "range": "1d",
            "interval": "5m",
            "includePrePost": "false",
        },
        timeout=35,
    )
    response.raise_for_status()
    items = response.json().get("spark", {}).get("result", [])
    result = {}
    for item in items if isinstance(items, list) else []:
        parsed = parse_spark_item(item)
        if parsed:
            result[parsed["symbol"]] = parsed
    return result


def fetch_quotes(symbols: Iterable[str]) -> tuple[dict[str, dict[str, Any]], list[str]]:
    # Yahoo's public endpoint is noticeably more reliable with small, sequential
    # batches. Parallel bursts tend to trigger partial responses or throttling.
    batches = list(chunks(sorted(set(symbols)), 20))
    quotes: dict[str, dict[str, Any]] = {}
    errors = []
    for batch_number, batch in enumerate(batches, start=1):
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                quotes.update(fetch_spark_batch(batch))
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                time_module.sleep(0.8 * (attempt + 1))
        if last_error is not None:
            errors.append(
                f"batch {batch_number}: {type(last_error).__name__}: {str(last_error)[:100]}"
            )
        time_module.sleep(0.2)
    return quotes, errors


def select_quote_symbols(holdings: list[dict[str, Any]], per_fund: int = 80) -> set[str]:
    """Select the liquid, high-impact core universe used by the public ranking."""

    selected: set[str] = set()
    for fund in ("SPY", "QQQ"):
        ranked = sorted(
            (item for item in holdings if item.get("fund") == fund),
            key=lambda item: float(item.get("weight") or 0),
            reverse=True,
        )
        selected.update(item["symbol"] for item in ranked[:per_fund])
    return selected | {"SPY", "QQQ", "^NDX", "^GSPC"}


def score_candidates(
    quotes: dict[str, dict[str, Any]], holdings: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    weights: dict[str, float] = {}
    names: dict[str, str] = {}
    for item in holdings:
        symbol = normalize_symbol(str(item.get("symbol") or ""))
        weights[symbol] = weights.get(symbol, 0.0) + max(0.0, float(item.get("weight") or 0.0))
        names.setdefault(symbol, str(item.get("name") or symbol))
    usable = {symbol: quote for symbol, quote in quotes.items() if symbol in weights}
    impact_raw = {symbol: weights[symbol] * abs(quote["change_pct"]) for symbol, quote in usable.items()}
    move_raw = {
        symbol: abs(quote["change_pct"])
        + 2.2 * abs(quote.get("five_minute_change_pct") or 0.0)
        + 1.2 * abs(quote.get("fifteen_minute_change_pct") or 0.0)
        for symbol, quote in usable.items()
    }
    volume_raw = {
        symbol: max(0.0, min(float(quote.get("volume_pace") or 0.0), 8.0) - 1.0)
        for symbol, quote in usable.items()
    }
    range_raw = {symbol: float(quote.get("range_pct") or 0.0) for symbol, quote in usable.items()}
    impact_pct = percentile(impact_raw)
    move_pct = percentile(move_raw)
    volume_pct = percentile(volume_raw)
    range_pct = percentile(range_raw)
    candidates = []
    for symbol, quote in usable.items():
        score = (
            0.38 * impact_pct.get(symbol, 0)
            + 0.34 * move_pct.get(symbol, 0)
            + 0.18 * volume_pct.get(symbol, 0)
            + 0.10 * range_pct.get(symbol, 0)
        )
        tags = []
        if weights[symbol] >= 2:
            tags.append("指数高权重")
        if abs(quote["change_pct"]) >= 3:
            tags.append("日内异动")
        if abs(quote.get("five_minute_change_pct") or 0) >= 1:
            tags.append("5分钟异动")
        if (quote.get("volume_pace") or 0) >= 2:
            tags.append("成交加速")
        if not tags:
            tags.append("综合信号")
        reasons = []
        if weights[symbol] >= 2:
            reasons.append(f"双指数代理权重约{weights[symbol]:.1f}%")
        if abs(quote["change_pct"]) >= 2:
            reasons.append(f"较前收变动{quote['change_pct']:+.2f}%")
        elif abs(quote.get("five_minute_change_pct") or 0) >= 0.5:
            reasons.append(f"最近5分钟变动{quote['five_minute_change_pct']:+.2f}%")
        if (quote.get("volume_pace") or 0) >= 1.5:
            reasons.append(f"最近一档成交约为前序中位数{quote['volume_pace']:.1f}倍")
        if not reasons:
            reasons.append("指数影响、价格偏离与成交节奏综合排名靠前")
        candidates.append(
            {
                **quote,
                "company_name": names.get(symbol) or quote["company_name"],
                "chinese_name": CHINESE_NAMES.get(symbol, names.get(symbol) or quote["company_name"]),
                "index_weight": weights[symbol],
                "score": score,
                "tags": tags[:3],
                "reason": "；".join(reasons[:2]),
            }
        )
    return sorted(candidates, key=lambda item: (-item["score"], item["symbol"]))


def stable_top(candidates: list[dict[str, Any]], previous: dict[str, Any] | None) -> list[dict[str, Any]]:
    by_symbol = {item["symbol"]: item for item in candidates}
    target = [item["symbol"] for item in candidates[:10]]
    previous_symbols = [
        item.get("symbol") for item in (previous or {}).get("top10", []) if item.get("symbol") in by_symbol
    ]
    if not previous_symbols:
        selected = target
    else:
        selected = list(dict.fromkeys(previous_symbols))[:10]
        for symbol in target:
            if len(selected) >= 10:
                break
            if symbol not in selected:
                selected.append(symbol)
        replacements = 0
        for symbol in target:
            if symbol in selected or replacements >= 3:
                continue
            outgoing = min(selected, key=lambda item: by_symbol[item]["score"])
            if by_symbol[symbol]["score"] >= by_symbol[outgoing]["score"] + 0.04:
                selected[selected.index(outgoing)] = symbol
                replacements += 1
        selected = sorted(selected, key=lambda symbol: (-by_symbol[symbol]["score"], symbol))
    result = []
    for rank, symbol in enumerate(selected[:10], start=1):
        item = by_symbol[symbol]
        result.append(
            {
                "rank": rank,
                "symbol": symbol,
                "company_name": item["company_name"],
                "chinese_name": item["chinese_name"],
                "price": round(item["price"], 4),
                "change_pct": round(item["change_pct"], 4),
                "five_minute_change_pct": (
                    round(item["five_minute_change_pct"], 4)
                    if item.get("five_minute_change_pct") is not None
                    else None
                ),
                "volume_pace": round(item["volume_pace"], 3) if item.get("volume_pace") else None,
                "index_weight": round(item["index_weight"], 4),
                "score": round(item["score"], 4),
                "tags": item["tags"],
                "reason": item["reason"],
                "sparkline": [round(value, 4) for value in item.get("sparkline", [])],
                "asof": iso(item["asof"]),
                "stale": False,
            }
        )
    return result


def index_view(quotes: dict[str, dict[str, Any]], index_symbol: str) -> dict[str, Any] | None:
    names = {"^GSPC": "标普500", "^NDX": "纳指100"}
    proxies = {"^GSPC": "SPY", "^NDX": "QQQ"}
    quote = quotes.get(index_symbol)
    is_proxy = False
    if not quote:
        quote = quotes.get(proxies[index_symbol])
        is_proxy = True
    if not quote:
        return None
    return {
        "symbol": index_symbol,
        "name": names[index_symbol] + (f"（{proxies[index_symbol]}方向代理）" if is_proxy else ""),
        "value": round(quote["price"], 4),
        "change_pct": round(quote["change_pct"], 4),
        "five_minute_change_pct": (
            round(quote["five_minute_change_pct"], 4)
            if quote.get("five_minute_change_pct") is not None
            else None
        ),
        "asof": iso(quote["asof"]),
        "source": "Yahoo Finance Spark · 公开延迟报价",
        "is_proxy": is_proxy,
        "stale": False,
    }


def build_state(
    now: datetime,
    previous: dict[str, Any] | None,
    holdings: list[dict[str, Any]],
    holding_statuses: list[dict[str, Any]],
    quotes: dict[str, dict[str, Any]],
    quote_errors: list[str],
) -> dict[str, Any]:
    candidates = score_candidates(quotes, holdings)
    if len(candidates) < 60:
        raise RuntimeError(f"Quote coverage too small for a public ranking: {len(candidates)}")
    top10 = stable_top(candidates, previous)
    indices = [item for item in (index_view(quotes, "^NDX"), index_view(quotes, "^GSPC")) if item]
    if len(indices) < 2:
        raise RuntimeError("Both index snapshots are required")
    market_times = [datetime.fromisoformat(item["asof"].replace("Z", "+00:00")) for item in indices]
    market_timestamp = sorted(market_times)[len(market_times) // 2]
    clock = market_clock(now)
    delay_seconds = max(0, int((now - market_timestamp).total_seconds()))
    if clock["status"] == "open" and delay_seconds > 1800:
        clock["label"] = "常规交易时段 · 行情源延迟"
    session_date = market_timestamp.astimezone(ET_ZONE).date().isoformat()
    previous_feed = (previous or {}).get("feed") or []
    feed = [item for item in previous_feed if item.get("session_date") == session_date][-35:]
    previous_market = (previous or {}).get("session", {}).get("market_timestamp")
    triggers = []
    for item in indices:
        if abs(item.get("five_minute_change_pct") or 0) >= 0.25:
            triggers.append(f"{item['name']}最近5分钟{item['five_minute_change_pct']:+.2f}%")
    for item in top10:
        if abs(item.get("five_minute_change_pct") or 0) >= 2:
            triggers.append(f"{item['symbol']}最近5分钟{item['five_minute_change_pct']:+.2f}%")
    ndx = next(item for item in indices if item["symbol"] == "^NDX")
    spx = next(item for item in indices if item["symbol"] == "^GSPC")
    state_line = (
        f"纳指100 {ndx['change_pct']:+.2f}%，标普500 {spx['change_pct']:+.2f}%；"
        f"规则榜首为{top10[0]['chinese_name']}（{top10[0]['symbol']}）。"
    )
    if not previous_market or previous_market != iso(market_timestamp):
        movers = sorted(
            top10,
            key=lambda item: -max(
                abs(item.get("change_pct") or 0),
                2 * abs(item.get("five_minute_change_pct") or 0),
            ),
        )[:3]
        feed.append(
            {
                "timestamp": iso(market_timestamp),
                "session_date": session_date,
                "indices": indices,
                "movers": movers,
                "state_line": state_line,
                "major_event": bool(triggers),
                "trigger_reasons": triggers[:4],
                "data_status": "交易时段快照" if clock["status"] == "open" else "最近有效收盘",
            }
        )
    sources = [
        {
            "source": "公开延迟行情",
            "status": "degraded" if quote_errors else "ok",
            "message": f"覆盖{len(candidates)}只成分；Yahoo Spark；可能延迟或限流"
            + (f"；{len(quote_errors)}个批次降级" if quote_errors else ""),
            "updated_at": iso(now),
        },
        *[{**item, "updated_at": iso(now)} for item in holding_statuses],
        {
            "source": "确定性规则",
            "status": "ok",
            "message": "指数影响38% + 价格异动34% + 成交节奏18% + 日内振幅10%；不调用LLM",
            "updated_at": iso(now),
        },
    ]
    return {
        "schema_version": 1,
        "generated_at": iso(now),
        "session": {
            "status": clock["status"],
            "label": clock["label"],
            "mode": "snapshot",
            "timestamp": iso(now),
            "market_timestamp": iso(market_timestamp),
            "next_open": iso(clock["next_open"]),
            "next_close": iso(clock["next_close"]),
            "countdown_seconds": clock["countdown"],
            "data_delay_seconds": delay_seconds,
        },
        "indices": indices,
        "top10": top10,
        "feed": feed[-36:],
        "sources": sources,
        "candidate_count": len(candidates),
        "universe_count": len({item["symbol"] for item in holdings}),
        "method": {
            "name": "四维确定性规则",
            "model_used": False,
            "weights": {"index_impact": 0.38, "price_movement": 0.34, "volume_pace": 0.18, "intraday_range": 0.10},
            "replacement_limit": 3,
            "scheduled_interval_minutes": 15,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    args = parser.parse_args()
    now = datetime.now(UTC)
    previous = load_json(args.output)
    try:
        holdings, holding_statuses = fetch_holdings(args.cache_dir)
        symbols = select_quote_symbols(holdings)
        quotes, errors = fetch_quotes(symbols)
        state = build_state(now, previous, holdings, holding_statuses, quotes, errors)
    except Exception as exc:
        if previous:
            print(
                json.dumps(
                    {
                        "retained_previous": True,
                        "generated_at": previous.get("generated_at"),
                        "reason": f"{type(exc).__name__}: {str(exc)[:180]}",
                    },
                    ensure_ascii=False,
                )
            )
            return
        raise
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "generated_at": state["generated_at"],
                "market_timestamp": state["session"]["market_timestamp"],
                "universe": state["universe_count"],
                "candidates": state["candidate_count"],
                "top10": [item["symbol"] for item in state["top10"]],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
