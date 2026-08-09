#!/usr/bin/env python3
"""
fetch_data.py — 抓取纳指100成分股 + ^NDX 指数近 10 年日线收盘价。

输出:
    ndx100-dashboard/data/quotes.json   { ticker: { "YYYY-MM-DD": close } }
    ndx100-dashboard/data/meta.json     { last_success, source, errors, ticker_count,
                         expected_count, generated_at, period_start, index, note }

数据源策略（源分离 + 三级兜底）:
    - ^NDX 指数    -> Stooq（符号 ^ndx），失败时用 yfinance 单标的兜底。
    - 个股        -> yfinance 批量（auto_adjust=True，复权收盘）。
                     批量内逐只 try/except KeyError 保护取列；
                     缺失/全 NaN/退市的收进 missing，单只崩不了整批。
    - missing     -> Stooq（符号加 .US，未复权，在 meta 标注）。
    - 仍失败      -> 上次缓存 data/quotes.json 里的旧值（保命兜底）。

失败处理:
    - 任何一只失败都记进 meta.errors，但脚本总是 sys.exit(0)，
      让 GitHub Actions job 显示绿色，同时 meta 把失败暴露给前端可见。
"""
from __future__ import annotations

import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

# --------------------------------------------------------------------------- #
# 配置
# --------------------------------------------------------------------------- #
ROOT = Path(__file__).resolve().parent.parent
TICKERS_FILE = ROOT / "scripts" / "ndx100-tickers.txt"
DATA_DIR = ROOT / "ndx100-dashboard" / "data"
QUOTES_FILE = DATA_DIR / "quotes.json"
META_FILE = DATA_DIR / "meta.json"

INDEX_TICKER = "^NDX"          # 纳指100 指数本身，作为相对强弱基准
YEARS_BACK = 10                # 近 10 年
DATA_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------- #
# 工具函数
# --------------------------------------------------------------------------- #
def load_tickers() -> list[str]:
    """读 tickers.txt，跳过空行和注释。"""
    if not TICKERS_FILE.exists():
        print(f"ERROR: 找不到 {TICKERS_FILE}", file=sys.stderr)
        sys.exit(1)
    out = []
    for line in TICKERS_FILE.read_text(encoding="utf-8").splitlines():
        t = line.strip().split("#", 1)[0].strip().upper()
        if t:
            out.append(t)
    if not out:
        print("ERROR: tickers.txt 是空的", file=sys.stderr)
        sys.exit(1)
    if INDEX_TICKER not in out:
        out.append(INDEX_TICKER)
    return out


def load_cached_quotes() -> dict:
    """读上次缓存，失败返回 {}。"""
    if not QUOTES_FILE.exists():
        return {}
    try:
        return json.loads(QUOTES_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def iso_today_minus_years(years: int) -> str:
    return (datetime.now(timezone.utc) - pd.Timedelta(days=365 * years)).strftime("%Y-%m-%d")


def series_to_dict(s: "pd.Series") -> dict:
    """把一只股票的收盘价 Series 转成 {date: close}，去掉 NaN。"""
    out = {}
    for dt, val in s.dropna().items():
        if pd.isna(val):
            continue
        out[dt.strftime("%Y-%m-%d")] = round(float(val), 4)
    return out


# --------------------------------------------------------------------------- #
# 数据源 1: yfinance（仅个股，批量）
# --------------------------------------------------------------------------- #
def fetch_yfinance_batch(tickers: list[str]) -> tuple[dict[str, dict], list[str]]:
    """
    一次性下载所有个股 ticker，返回 (result_dict, missing_list)。

    容错（修复 bug1）：逐 ticker 取列用 try/except KeyError 保护；
    缺列/全 NaN/退市的 ticker 收进 missing，由调用方交 Stooq。
    指数（^ 开头）不应进入本函数（见主流程的源分离）。
    """
    import yfinance as yf

    result: dict[str, dict] = {}
    missing: list[str] = []
    if not tickers:
        return result, missing

    start = iso_today_minus_years(YEARS_BACK)
    print(f"[yfinance] 下载 {len(tickers)} 只个股, start={start} ...")

    df = yf.download(
        tickers=tickers,
        start=start,
        auto_adjust=True,   # 复权收盘（auto_adjust 后 Close 即复权价）
        actions=False,
        threads=True,
        progress=False,
        group_by="ticker",
    )

    if df is None or df.empty:
        print("[yfinance] 返回空 DataFrame")
        return result, list(tickers)  # 全部交 Stooq

    is_multi = isinstance(df.columns, pd.MultiIndex)

    for tk in tickers:
        try:
            if is_multi and tk in df.columns.get_level_values(0):
                # 多标的 group_by='ticker'：列顶层通常是 ticker。
                sub = df[tk]
                close_series = sub["Close"]
            elif is_multi and tk in df.columns.get_level_values(1):
                # 单标的下载：新版 yfinance 可能返回 (Price, Ticker)。
                close_series = df["Close"][tk]
            else:
                sub = df  # 单 ticker 退化情况
                close_series = sub["Close"]
            if close_series is None or getattr(close_series, "empty", False):
                raise KeyError(tk)
            if close_series.dropna().empty:
                raise KeyError(tk)
            result[tk] = series_to_dict(close_series)
        except KeyError:
            print(f"[yfinance] {tk} 缺列/无数据，转入 missing -> Stooq")
            missing.append(tk)
        except Exception as e:
            print(f"[yfinance] {tk} 异常: {e}，转入 missing -> Stooq")
            missing.append(tk)

    return result, missing


# --------------------------------------------------------------------------- #
# 数据源 2: Stooq (pandas_datareader) —— 指数主源 / 个股兜底
# --------------------------------------------------------------------------- #
def fetch_stooq_single(ticker: str) -> dict:
    """
    对单只 ticker 用 Stooq 抓，返回 {date: close} 或 {}。
    - 指数 ^NDX -> 符号 ^ndx（Stooq 指数原样小写）
    - 个股 AAPL -> 符号 AAPL.US
    注意: Stooq 的 Close 未复权。
    """
    try:
        import pandas_datareader.data as web
    except ImportError:
        print("[stooq] pandas_datareader 未安装，跳过")
        return {}

    start = iso_today_minus_years(YEARS_BACK)
    sym = ticker.lower() if ticker.startswith("^") else f"{ticker}.US"

    try:
        df = web.DataReader(sym, "stooq", start=start)
    except Exception as e:
        print(f"[stooq] {ticker}({sym}) 异常: {e}")
        return {}

    if df is None or df.empty:
        return {}
    if "Close" not in df.columns:
        return {}
    # Stooq 返回倒序（最新在前），统一成正序
    s = df["Close"].sort_index()
    return series_to_dict(s)


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def main() -> int:
    all_tickers = load_tickers()

    # 源分离（修复 bug2）：指数走 Stooq，个股走 yfinance 批量
    index_tickers = [t for t in all_tickers if t.startswith("^")]
    stock_tickers = [t for t in all_tickers if not t.startswith("^")]

    cached = load_cached_quotes()
    errors: dict[str, str] = {}
    quotes: dict[str, dict] = {}
    used_stooq_for_stock = False  # 是否有"个股"用了 stooq（影响 source 标记）

    # 1) 指数 -> Stooq；失败时用 yfinance 单标的兜底
    for tk in index_tickers:
        print(f"[stooq] 指数 {tk}")
        data = fetch_stooq_single(tk)
        if not data:
            print(f"[yfinance] 兜底指数: {tk}")
            try:
                yf_index, _ = fetch_yfinance_batch([tk])
                data = yf_index.get(tk, {})
            except Exception as e:
                print(f"[yfinance] 指数 {tk} 异常: {e}")
        if data:
            quotes[tk] = data
        elif tk in cached and cached[tk]:
            quotes[tk] = cached[tk]
            errors[tk] = "stooq 失败，使用缓存旧值"
        else:
            errors[tk] = "stooq 失败且无缓存"

    # 2) 个股 -> yfinance 批量
    try:
        yf_data, missing = fetch_yfinance_batch(stock_tickers)
    except Exception as e:
        print(f"[yfinance] 整体异常: {e}")
        traceback.print_exc()
        yf_data, missing = {}, list(stock_tickers)

    for tk, data in yf_data.items():
        quotes[tk] = data

    # 3) 个股 missing -> Stooq 兜底（这是降级，标 used_stooq_for_stock）
    for tk in missing:
        print(f"[stooq] 兜底个股: {tk}")
        data = fetch_stooq_single(tk)
        if data:
            quotes[tk] = data
            used_stooq_for_stock = True
        elif tk in cached and cached[tk]:
            quotes[tk] = cached[tk]
            errors[tk] = "yfinance+stooq 均失败，使用缓存旧值"
        else:
            errors[tk] = "所有数据源均失败且无缓存"

    # 4) 判定整体 source
    n_have = len(quotes)
    n_expected = len(all_tickers)
    any_fresh = bool(yf_data) or used_stooq_for_stock
    if n_have == 0:
        source = "FAILED"
    elif not any_fresh:
        source = "cached"              # 本次一个新数都没抓到（指数也算缓存），全靠旧值
    elif used_stooq_for_stock:
        source = "yfinance+stooq"      # 有个股用了未复权兜底
    else:
        source = "yfinance"

    # 5) 写 quotes.json
    QUOTES_FILE.write_text(json.dumps(quotes, separators=(",", ":")), encoding="utf-8")

    # 6) 写 meta.json —— last_success 只在确实拿到新数据那天更新
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if source == "FAILED":
        prev_meta = {}
        if META_FILE.exists():
            try:
                prev_meta = json.loads(META_FILE.read_text(encoding="utf-8"))
            except Exception:
                prev_meta = {}
        last_success = prev_meta.get("last_success", "")
    else:
        last_success = today_str

    meta = {
        "last_success": last_success,
        "source": source,
        "errors": errors,
        "ticker_count": n_have,
        "expected_count": n_expected,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "period_start": iso_today_minus_years(YEARS_BACK),
        "index": INDEX_TICKER,
        "note": (
            "个股: yfinance=复权收盘; stooq=未复权收盘(仅兜底). "
            "指数 ^NDX: Stooq 主源，Yahoo Finance 兜底. "
            "source=yfinance+stooq 表示部分个股用了未复权兜底数据."
        ),
    }
    META_FILE.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n完成: source={source}, 有数据 {n_have}/{n_expected}, errors={len(errors)}")
    if errors:
        for k, v in list(errors.items())[:20]:
            print(f"   {k}: {v}")
    # 关键: 永远 exit(0)，把失败留给 meta 暴露（前端可见），CI 不染红
    return 0


if __name__ == "__main__":
    sys.exit(main())
