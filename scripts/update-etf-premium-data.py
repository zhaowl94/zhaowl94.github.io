#!/usr/bin/env python3
"""Generate the static ETF premium dataset used by GitHub Pages."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import statistics
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "etf-premium" / "data" / "dashboard.json"
CHINA_TZ = timezone(timedelta(hours=8))
SPOT_URL = "https://push2delay.eastmoney.com/api/qt/clist/get"
HISTORY_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
NAV_URL = "https://fund.eastmoney.com/pingzhongdata/{code}.js"
NAV_PATTERN = re.compile(r"Data_netWorthTrend\s*=\s*(\[.*?\])\s*;", re.DOTALL)

GROUPS = {
    "nasdaq100": {
        "label": "纳斯达克 100",
        "short": "纳指 100",
        "description": "跟踪 Nasdaq-100 的境内上市跨境 ETF",
    },
    "sp500": {
        "label": "标普 500",
        "short": "标普 500",
        "description": "跟踪 S&P 500 的境内上市跨境 ETF",
    },
}

FALLBACK_FUNDS = [
    {"code": "159501", "name": "纳指ETF嘉实", "group": "nasdaq100"},
    {"code": "159513", "name": "纳斯达克100ETF大成", "group": "nasdaq100"},
    {"code": "159632", "name": "纳斯达克ETF华安", "group": "nasdaq100"},
    {"code": "159659", "name": "纳斯达克100ETF招商", "group": "nasdaq100"},
    {"code": "159660", "name": "纳指ETF汇添富", "group": "nasdaq100"},
    {"code": "159696", "name": "纳指ETF易方达", "group": "nasdaq100"},
    {"code": "159941", "name": "纳指ETF广发", "group": "nasdaq100"},
    {"code": "513100", "name": "纳指ETF国泰", "group": "nasdaq100"},
    {"code": "513110", "name": "纳指ETF华泰柏瑞", "group": "nasdaq100"},
    {"code": "513300", "name": "纳斯达克ETF华夏", "group": "nasdaq100"},
    {"code": "513390", "name": "纳指100ETF博时", "group": "nasdaq100"},
    {"code": "513870", "name": "纳指ETF富国", "group": "nasdaq100"},
    {"code": "159612", "name": "标普500ETF国泰", "group": "sp500"},
    {"code": "159655", "name": "标普500ETF华夏", "group": "sp500"},
    {"code": "513500", "name": "标普500ETF博时", "group": "sp500"},
    {"code": "513650", "name": "标普500ETF南方", "group": "sp500"},
]
FALLBACK_BY_CODE = {item["code"]: item for item in FALLBACK_FUNDS}


class DataSourceError(RuntimeError):
    """A public market-data response could not be used."""


def now_iso() -> str:
    return datetime.now(CHINA_TZ).isoformat(timespec="seconds")


def session() -> requests.Session:
    client = requests.Session()
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=0.55,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=12, pool_maxsize=12)
    client.mount("https://", adapter)
    client.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0 Safari/537.36"
            ),
            "Accept": "application/json,text/javascript,*/*;q=0.8",
            "Referer": "https://quote.eastmoney.com/",
        }
    )
    return client


def as_float(value: Any) -> float | None:
    if value in (None, "", "-", "--", "---"):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def date_field(value: Any) -> str | None:
    text = str(value or "").strip()
    if re.fullmatch(r"\d{8}", text):
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    return None


def classify(name: str, code: str = "") -> str | None:
    if code in FALLBACK_BY_CODE:
        return FALLBACK_BY_CODE[code]["group"]
    compact = re.sub(r"\s+", "", str(name or "")).upper()
    if re.search(r"标普500|S&P500|SP500", compact):
        return "sp500"
    if any(word in compact for word in ("生物", "科技", "创新", "医药", "医疗", "消费", "互联网", "1000")):
        return None
    if re.search(r"纳斯达克100|纳指100|纳100|NASDAQ100|NDX100", compact):
        return "nasdaq100"
    if re.search(r"(纳指|纳斯达克).*ETF", compact):
        return "nasdaq100"
    return None


def fetch_spot() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with session() as client:
        for page in range(1, 101):
            params = {
                "pn": str(page),
                "pz": "100",
                "po": "1",
                "np": "1",
                "ut": "bd1d9ddb04089700cf9c27f6f7426281",
                "fltt": "2",
                "invt": "2",
                "wbp2u": "|0|0|0|web",
                "fid": "f12",
                "fs": "b:MK0021,b:MK0022,b:MK0023,b:MK0024,b:MK0827",
                "fields": "f2,f3,f6,f8,f12,f13,f14,f20,f21,f124,f297,f402,f441",
            }
            response = client.get(SPOT_URL, params=params, timeout=25)
            response.raise_for_status()
            data = (response.json().get("data") or {})
            batch = data.get("diff") or []
            if isinstance(batch, dict):
                batch = list(batch.values())
            if not batch:
                break
            for raw in batch:
                code = str(raw.get("f12") or "").zfill(6)
                price = as_float(raw.get("f2"))
                iopv = as_float(raw.get("f441"))
                epoch = as_float(raw.get("f124"))
                rows.append(
                    {
                        "code": code,
                        "name": str(raw.get("f14") or code),
                        "market": "SH" if str(raw.get("f13")) == "1" else "SZ",
                        "price": price,
                        "iopv": iopv,
                        "live_premium": (
                            (price / iopv - 1) * 100
                            if price is not None and iopv not in (None, 0)
                            else None
                        ),
                        "quoted_discount": as_float(raw.get("f402")),
                        "change_pct": as_float(raw.get("f3")),
                        "turnover": as_float(raw.get("f6")),
                        "turnover_rate": as_float(raw.get("f8")),
                        "market_cap": as_float(raw.get("f20")),
                        "float_market_cap": as_float(raw.get("f21")),
                        "quote_date": date_field(raw.get("f297")),
                        "quote_updated_at": (
                            datetime.fromtimestamp(epoch, CHINA_TZ).isoformat(timespec="seconds")
                            if epoch
                            else None
                        ),
                    }
                )
            total = int(data.get("total") or len(rows))
            if len(rows) >= total or len(batch) < 100:
                break
    if not rows:
        raise DataSourceError("ETF spot list is empty")
    return rows


def discover() -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    try:
        targets = []
        for row in fetch_spot():
            group = classify(row["name"], row["code"])
            if group:
                targets.append({**row, "group": group})
        if targets:
            return sorted(targets, key=lambda item: (item["group"], item["code"])), warnings
        warnings.append("实时列表未识别出目标 ETF，已使用内置清单")
    except Exception as exc:
        warnings.append(f"实时列表不可用，已使用内置清单：{exc}")
    return [
        {
            **item,
            "market": "SH" if item["code"].startswith("5") else "SZ",
            "price": None,
            "iopv": None,
            "live_premium": None,
            "quoted_discount": None,
            "change_pct": None,
            "turnover": None,
            "turnover_rate": None,
            "market_cap": None,
            "float_market_cap": None,
            "quote_date": None,
            "quote_updated_at": None,
        }
        for item in FALLBACK_FUNDS
    ], warnings


def fetch_prices(code: str, client: requests.Session) -> list[dict[str, Any]]:
    market_id = 1 if code.startswith(("5", "6")) else 0
    params = {
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116",
        "ut": "7eea3edcaed734bea9cbfc24409ed989",
        "klt": "101",
        "fqt": "0",
        "beg": "20000101",
        "end": datetime.now(CHINA_TZ).strftime("%Y%m%d"),
        "secid": f"{market_id}.{code}",
    }
    response = client.get(HISTORY_URL, params=params, timeout=30)
    response.raise_for_status()
    lines = ((response.json().get("data") or {}).get("klines") or [])
    result = []
    for line in lines:
        parts = str(line).split(",")
        if len(parts) < 11 or as_float(parts[2]) is None:
            continue
        result.append(
            {
                "date": date_field(parts[0]),
                "close": as_float(parts[2]),
                "volume": as_float(parts[5]),
                "turnover": as_float(parts[6]),
            }
        )
    if not result:
        raise DataSourceError(f"{code} price history is empty")
    return result


def fetch_navs(code: str, client: requests.Session) -> list[dict[str, Any]]:
    response = client.get(NAV_URL.format(code=code), timeout=30)
    response.raise_for_status()
    response.encoding = "utf-8"
    match = NAV_PATTERN.search(response.text)
    if not match:
        raise DataSourceError(f"{code} NAV payload is invalid")
    result = []
    for item in json.loads(match.group(1)):
        nav = as_float(item.get("y"))
        epoch_ms = as_float(item.get("x"))
        if nav in (None, 0) or epoch_ms is None:
            continue
        result.append(
            {
                "date": datetime.fromtimestamp(epoch_ms / 1000, timezone.utc).date().isoformat(),
                "nav": nav,
            }
        )
    if not result:
        raise DataSourceError(f"{code} NAV history is empty")
    return result


def merge_series(prices: list[dict[str, Any]], navs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    nav_by_date = {row["date"]: row["nav"] for row in navs}
    merged = []
    for price in prices:
        nav = nav_by_date.get(price["date"])
        close = price["close"]
        if nav in (None, 0) or close is None:
            continue
        merged.append(
            {
                "date": price["date"],
                "premium": round((close / nav - 1) * 100, 6),
                "close": close,
                "nav": nav,
                "turnover": price.get("turnover"),
                "volume": price.get("volume"),
            }
        )
    return sorted(merged, key=lambda item: item["date"])


def rounded(value: float | None, digits: int = 4) -> float | None:
    return round(value, digits) if value is not None and math.isfinite(value) else None


def stats(series: list[dict[str, Any]]) -> dict[str, Any]:
    values = [float(item["premium"]) for item in series]
    if not values:
        return {"latest": None, "matched_days": 0, "start_date": None, "end_date": None}
    last20 = values[-20:]
    last60 = values[-60:]
    last252 = values[-252:]
    latest = values[-1]
    sigma = statistics.pstdev(last60) if len(last60) > 1 else 0
    return {
        "latest": rounded(latest),
        "avg20": rounded(statistics.fmean(last20)),
        "avg60": rounded(statistics.fmean(last60)),
        "percentile252": rounded(100 * sum(value <= latest for value in last252) / len(last252), 2),
        "min252": rounded(min(last252)),
        "max252": rounded(max(last252)),
        "zscore60": rounded((latest - statistics.fmean(last60)) / sigma, 3) if sigma else None,
        "positive_ratio252": rounded(100 * sum(value > 0 for value in last252) / len(last252), 2),
        "start_date": series[0]["date"],
        "end_date": series[-1]["date"],
        "matched_days": len(series),
        "latest_close": series[-1]["close"],
        "latest_nav": series[-1]["nav"],
    }


def load_existing(output: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(output.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except (OSError, ValueError):
        return None


def fetch_one(
    fund: dict[str, Any], existing: dict[str, Any] | None
) -> tuple[dict[str, Any] | None, str | None, bool]:
    try:
        with session() as client:
            prices = fetch_prices(fund["code"], client)
            navs = fetch_navs(fund["code"], client)
        series = merge_series(prices, navs)
        if not series:
            raise DataSourceError("no same-date price and NAV observations")
        return (
            {
                **fund,
                "series": series,
                "stats": stats(series),
                "source_counts": {
                    "price_days": len(prices),
                    "nav_days": len(navs),
                    "matched_days": len(series),
                },
                "history_updated_at": now_iso(),
            },
            None,
            True,
        )
    except Exception as exc:
        if existing and existing.get("series"):
            live_fields = {
                key: value
                for key, value in fund.items()
                if value is not None or key in {"code", "name", "group", "market"}
            }
            return (
                {**existing, **live_fields},
                f"{fund['code']} 更新失败，沿用上次数据：{exc}",
                False,
            )
        return None, f"{fund['code']} 无可用数据：{exc}", False


def atomic_write(output: Path, payload: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".dashboard-", suffix=".json", dir=output.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def build(output: Path) -> bool:
    existing_payload = load_existing(output)
    existing_by_code = {
        fund["code"]: fund for fund in (existing_payload or {}).get("funds", [])
    }
    targets, warnings = discover()
    results: dict[str, dict[str, Any]] = {}
    refreshed = 0
    with ThreadPoolExecutor(max_workers=6, thread_name_prefix="premium") as pool:
        futures = {
            pool.submit(fetch_one, fund, existing_by_code.get(fund["code"])): fund
            for fund in targets
        }
        for done, future in enumerate(as_completed(futures), start=1):
            fund = futures[future]
            result, warning, was_refreshed = future.result()
            if result:
                results[result["code"]] = result
            if warning:
                warnings.append(warning)
            refreshed += int(was_refreshed)
            print(f"[{done:02d}/{len(targets):02d}] {fund['code']} {fund['name']}")

    if refreshed == 0 and existing_payload and existing_payload.get("ready"):
        print("No source refreshed; keeping the previously published dataset.")
        return False

    ordered = [results[item["code"]] for item in targets if item["code"] in results]
    groups_present = {fund["group"] for fund in ordered}
    if len(ordered) < 12 or groups_present != set(GROUPS):
        raise RuntimeError(
            f"Dataset safety check failed: {len(ordered)} funds, groups={sorted(groups_present)}"
        )
    payload = {
        "ready": True,
        "generated_at": now_iso(),
        "groups": GROUPS,
        "funds": ordered,
        "warnings": warnings[-50:],
        "methodology": {
            "historical": "(A股ETF未复权收盘价 ÷ 同一净值日期的单位净值 - 1) × 100%",
            "live": "(最新成交价 ÷ IOPV实时估值 - 1) × 100%",
            "join": "仅保留收盘价与官方单位净值日期完全一致的观测",
            "sources": ["东方财富 ETF 行情", "天天基金公开单位净值"],
        },
    }
    atomic_write(output, payload)
    print(f"Wrote {len(ordered)} funds ({refreshed} refreshed) to {output}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build(args.output.resolve())


if __name__ == "__main__":
    main()
