"""Build a compact static QDII similarity snapshot for GitHub Pages.

Without ``--refresh`` the script is fully offline and consumes an existing
cache directory. With ``--refresh`` it updates stale entries through the
original QDII collectors, while retaining the last valid cached value when an
upstream source is unavailable.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = SITE_ROOT / "scripts" / "qdii-cache"
DEFAULT_OUTPUT = SITE_ROOT / "qdii-similarity" / "data" / "dashboard.json"

REFERENCES = {
    "270042": {
        "name": "广发纳斯达克100ETF联接A",
        "short": "广发纳指",
        "keywords": ["纳斯达克", "纳指", "100", "NDX", "NASDAQ"],
        "index_patterns": [r"纳斯达克\s*100", r"纳指", r"NASDAQ\s*100", r"^NDX"],
    },
    "161128": {
        "name": "易方达标普信息科技指数(QDII-LOF)",
        "short": "易方达标普科技",
        "keywords": ["标普", "信息科技", "科技", "S&P", "INFORMATION", "TECH"],
        "index_patterns": [r"标普.*信息科技", r"S&P.*INFORMATION", r"标普\s*500\s*信息科技"],
    },
    "017091": {
        "name": "景顺长城纳斯达克科技市值加权ETF联接A",
        "short": "景顺纳指科技",
        "keywords": ["纳斯达克", "科技", "纳指", "TECH", "NDX", "NASDAQ"],
        "index_patterns": [r"纳斯达克\s*科技", r"NASDAQ\s*100\s*TECH", r"纳指\s*科技"],
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--workers", type=int, default=4)
    return parser.parse_args()


def load_cache(cache_dir: Path, key: str):
    path = cache_dir / f"{key}.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload.get("data")
    except (OSError, ValueError, TypeError):
        return None


def normalized_ticker(value) -> str:
    return re.sub(r"[\s.\-_]", "", str(value or "")).upper()


def holdings_overlap(left, right):
    if not left or not right:
        return None
    lmap, rmap = {}, {}
    for item in left:
        key = normalized_ticker(item.get("ticker"))
        if key:
            lmap[key] = lmap.get(key, 0.0) + float(item.get("weight") or 0)
    for item in right:
        key = normalized_ticker(item.get("ticker"))
        if key:
            rmap[key] = rmap.get(key, 0.0) + float(item.get("weight") or 0)
    total = (sum(lmap.values()) + sum(rmap.values())) / 2
    if not lmap or not rmap or total <= 0:
        return 0.0
    shared = set(lmap).intersection(rmap)
    return min(1.0, sum(min(lmap[key], rmap[key]) for key in shared) / total)


def returns_by_date(rows):
    clean = []
    for row in rows or []:
        try:
            clean.append((str(row["date"]), float(row["nav"])))
        except (KeyError, TypeError, ValueError):
            continue
    clean.sort(key=lambda item: item[0])
    output = {}
    previous = None
    for date, value in clean:
        if previous not in (None, 0):
            output[date] = value / previous - 1
        previous = value
    return output


def return_correlation(left, right, window=90, min_overlap=30):
    lret, rret = returns_by_date(left), returns_by_date(right)
    common = sorted(set(lret).intersection(rret))[-window:]
    if len(common) < min_overlap:
        return None
    x = [lret[date] for date in common]
    y = [rret[date] for date in common]
    xmean, ymean = sum(x) / len(x), sum(y) / len(y)
    numerator = sum((a - xmean) * (b - ymean) for a, b in zip(x, y))
    xsum = sum((a - xmean) ** 2 for a in x)
    ysum = sum((b - ymean) ** 2 for b in y)
    if xsum <= 0 or ysum <= 0:
        return None
    corr = numerator / math.sqrt(xsum * ysum)
    return max(0.0, min(1.0, (corr + 1) / 2))


def index_similarity(name, basic, meta):
    parts = [str(name or "")]
    if isinstance(basic, dict):
        for key in ("跟踪标的", "业绩比较基准", "投资目标", "基金类型"):
            if basic.get(key):
                parts.append(str(basic[key]))
    text = " ".join(parts)
    upper = text.upper()
    if any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in meta["index_patterns"]):
        return 1.0
    hits = sum(1 for keyword in meta["keywords"] if keyword.upper() in upper)
    keyword_score = min(1.0, hits / max(2.0, len(meta["keywords"]) * 0.5))
    region_score = 0.15 if any(token in text for token in ("美国", "美股", "纳斯达克", "标普", "S&P", "道琼斯")) else 0.0
    return max(keyword_score * 0.7, region_score)


def score_parts(holdings_score, correlation_score, index_score):
    values = []
    for weight, value in ((0.5, holdings_score), (0.3, correlation_score), (0.2, index_score)):
        if value is not None:
            values.append((weight, value))
    if not values:
        return None
    return round(sum(weight * value for weight, value in values) / sum(weight for weight, _ in values) * 100, 2)


def compute_similarity(fund, reference_data):
    output = {}
    for code, reference in reference_data.items():
        holdings_score = holdings_overlap(fund["holdings"], reference["holdings"])
        correlation_score = return_correlation(fund["nav_history"], reference["nav_history"])
        index_score = index_similarity(fund.get("name"), fund.get("basic"), REFERENCES[code])
        output[code] = {
            "score": score_parts(holdings_score, correlation_score, index_score),
            "holdings": round(holdings_score * 100, 2) if holdings_score is not None else None,
            "correlation": round(correlation_score * 100, 2) if correlation_score is not None else None,
            "index": round(index_score * 100, 2) if index_score is not None else None,
        }
    return output


def load_fund(cache_dir: Path, fund: dict) -> dict:
    code = str(fund.get("code", "")).zfill(6)
    holdings_payload = load_cache(cache_dir, f"hold_{code}") or {}
    nav_history = load_cache(cache_dir, f"nav_{code}") or []
    basic = load_cache(cache_dir, f"basic_{code}") or {}
    return {
        **fund,
        "code": code,
        "holdings": holdings_payload.get("holdings", []) if isinstance(holdings_payload, dict) else [],
        "holdings_quarter": holdings_payload.get("quarter") if isinstance(holdings_payload, dict) else None,
        "holdings_source": holdings_payload.get("source") if isinstance(holdings_payload, dict) else None,
        "nav_history": nav_history,
        "basic": basic,
    }


def refresh_cache(cache_dir: Path, workers: int):
    os.environ["QDII_CACHE_DIR"] = str(cache_dir.resolve())
    source_dir = SITE_ROOT / "scripts" / "qdii-source"
    sys.path.insert(0, str(source_dir))
    import data_sources as ds  # pylint: disable=import-outside-toplevel

    stale_funds = load_cache(cache_dir, "qdii_list") or []
    fresh_funds = ds.fetch_qdii_list_em()
    funds = fresh_funds or stale_funds
    if fresh_funds:
        ds.cache_set(ds.KEY_LIST, fresh_funds)
    if not funds:
        raise RuntimeError("QDII fund list is unavailable and no cache exists")

    try:
        etf_lookup = ds.get_etf_lookup(funds)
    except Exception as error:  # upstream collectors intentionally degrade to cache
        print(f"ETF lookup refresh failed: {error}")
        etf_lookup = load_cache(cache_dir, "_etf_lookup") or {}

    def update_one(fund):
        code = str(fund.get("code", "")).zfill(6)
        name = fund.get("name", "")
        old_holdings = load_cache(cache_dir, f"hold_{code}")
        old_nav = load_cache(cache_dir, f"nav_{code}")
        old_basic = load_cache(cache_dir, f"basic_{code}")

        holdings = ds.cache_get(ds.KEY_HOLD(code), ds.TTL_HOLD)
        if holdings is None:
            holdings = ds.resolve_holdings(code, name, etf_lookup) or old_holdings
            if holdings:
                ds.cache_set(ds.KEY_HOLD(code), holdings)

        nav = ds.cache_get(ds.KEY_NAV(code), ds.TTL_NAV)
        if nav is None:
            nav = ds.fetch_nav_em(code) or old_nav
            if nav:
                ds.cache_set(ds.KEY_NAV(code), nav)

        basic = ds.cache_get(ds.KEY_BASIC(code), ds.TTL_BASIC)
        if basic is None:
            basic = ds.fetch_basic_em(code) or old_basic
            if basic:
                ds.cache_set(ds.KEY_BASIC(code), basic)
        return code

    failures = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(update_one, fund): fund for fund in funds}
        for index, future in enumerate(as_completed(futures), 1):
            try:
                future.result()
            except Exception as error:
                failures += 1
                code = futures[future].get("code", "?")
                print(f"{code} refresh failed: {error}")
            if index % 50 == 0 or index == len(futures):
                print(f"QDII refresh {index}/{len(futures)}; failures={failures}")
    return funds, failures


def main() -> None:
    args = parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    refresh_failures = 0
    if args.refresh:
        funds, refresh_failures = refresh_cache(args.cache_dir, args.workers)
    else:
        funds = load_cache(args.cache_dir, "qdii_list") or []
    if not funds:
        raise RuntimeError(f"No QDII list found in {args.cache_dir}")

    references = {}
    for code in REFERENCES:
        ref = load_fund(args.cache_dir, {"code": code, "name": REFERENCES[code]["name"]})
        references[code] = {
            "holdings": ref["holdings"],
            "nav_history": ref["nav_history"],
        }

    output_funds = []
    coverage = {"holdings": 0, "nav": 0, "basic": 0, "similarity": 0}
    for source_fund in funds:
        fund = load_fund(args.cache_dir, dict(source_fund))
        similarity = compute_similarity(fund, references)
        data_status = {
            "holdings_ok": bool(fund["holdings"]),
            "nav_ok": bool(fund["nav_history"]),
            "basic_ok": bool(fund["basic"]),
            "holdings_n": len(fund["holdings"]),
            "nav_n": len(fund["nav_history"]),
        }
        coverage["holdings"] += int(data_status["holdings_ok"])
        coverage["nav"] += int(data_status["nav_ok"])
        coverage["basic"] += int(data_status["basic_ok"])
        coverage["similarity"] += int(any(item["score"] is not None for item in similarity.values()))
        output_funds.append({
            key: fund.get(key)
            for key in (
                "code", "name", "type", "nav", "nav_date", "purchase_status",
                "redeem_status", "daily_quota", "min_purchase", "fee_rate",
            )
        } | {
            "holdings": fund["holdings"],
            "holdings_quarter": fund["holdings_quarter"],
            "holdings_source": fund["holdings_source"],
            "basic": fund["basic"],
            "similarity": similarity,
            "data_status": data_status,
        })

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    snapshot = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "count": len(output_funds),
        "references": REFERENCES,
        "coverage": coverage,
        "refreshFailures": refresh_failures,
        "schedule": "每周一 06:25（北京时间）自动更新；页面按钮读取最新发布快照",
        "funds": output_funds,
    }
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "count": len(output_funds), "coverage": coverage}, ensure_ascii=False))


if __name__ == "__main__":
    main()
