(function () {
  const STORAGE_KEY = "ndx-valuation-local-data-v1";
  const COLORS = {
    blue: "#2468a2",
    teal: "#057a77",
    red: "#c4493d",
    green: "#2f7d4f",
    amber: "#b66a18",
    purple: "#7f4f9e",
    grid: "#e4ded3",
    muted: "#66706a",
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (n, digits = 2) =>
    Number.isFinite(n)
      ? Number(n).toLocaleString("zh-CN", {
          maximumFractionDigits: digits,
          minimumFractionDigits: digits,
        })
      : "—";
  const fmtInt = (n) =>
    Number.isFinite(n) ? Math.round(n).toLocaleString("zh-CN") : "—";
  const pct = (n, digits = 1) =>
    Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${fmt(n, digits)}%` : "—";

  let raw = loadInitialData();
  let model = computeModel(raw.dates, raw.closes);
  let toastTimer = null;

  window.addEventListener("resize", debounce(render, 120));
  $("updateButton").addEventListener("click", updateData);
  $("csvInput").addEventListener("change", handleCsvInput);
  $("resetButton").addEventListener("click", resetData);

  render();

  function loadInitialData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (
        saved &&
        Array.isArray(saved.dates) &&
        Array.isArray(saved.closes) &&
        saved.dates.length > 200
      ) {
        return normalizeRows(saved.dates, saved.closes);
      }
    } catch (_) {
      localStorage.removeItem(STORAGE_KEY);
    }
    return normalizeRows(window.RAW_NDX.dates, window.RAW_NDX.closes);
  }

  function normalizeRows(dates, closes) {
    const map = new Map();
    for (let i = 0; i < dates.length; i++) {
      const date = String(dates[i]).slice(0, 10);
      const close = Number(closes[i]);
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        Number.isFinite(close) &&
        close > 0
      ) {
        map.set(date, close);
      }
    }
    const sorted = Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    return {
      dates: sorted.map((r) => r[0]),
      closes: sorted.map((r) => r[1]),
    };
  }

  function computeModel(dates, closes) {
    const n = closes.length;
    if (n < 260) throw new Error("数据量不足，至少需要约 1 年日线数据。");

    const t = Array.from({ length: n }, (_, i) => i);
    const ln = closes.map(Math.log);
    const reg = linreg(t, ln);
    const regLn = t.map((x) => reg.intercept + reg.slope * x);
    const trend = regLn.map(Math.exp);
    const residuals = ln.map((v, i) => v - regLn[i]);
    const residStd = std(residuals);
    const upper1 = regLn.map((v) => Math.exp(v + residStd));
    const lower1 = regLn.map((v) => Math.exp(v - residStd));
    const upper2 = regLn.map((v) => Math.exp(v + residStd * 2));
    const lower2 = regLn.map((v) => Math.exp(v - residStd * 2));
    const logDev = closes.map((c, i) => (c / trend[i] - 1) * 100);
    const ma200 = rollingMean(closes, 200);
    const maDev = closes.map((c, i) =>
      ma200[i] == null ? null : (c / ma200[i] - 1) * 100,
    );
    const last = n - 1;

    const logDevValid = logDev.filter(Number.isFinite);
    const maDevValid = maDev.filter(Number.isFinite);
    const logDevP95 = quantile(logDevValid, 0.95);
    const logDevP99 = quantile(logDevValid, 0.99);
    const logDevPctile = percentile(logDevValid, logDev[last]);
    const maP95 = quantile(maDevValid, 0.95);
    const maP99 = quantile(maDevValid, 0.99);
    const maPctile = percentile(maDevValid, maDev[last]);
    const cagr = (Math.exp(reg.slope * 252) - 1) * 100;

    const periods = [
      ["1985-2000", "1985-10-01", "2000-12-31"],
      ["2000-2010", "2000-01-01", "2009-12-31"],
      ["2010-2020", "2010-01-01", "2019-12-31"],
      ["2020-2026", "2020-01-01", "2026-12-31"],
      ["2015-2026", "2015-01-01", "2026-12-31"],
      ["2022-2026", "2022-01-01", "2026-12-31"],
    ]
      .map(([label, start, end]) =>
        computePeriod(label, start, end, dates, closes),
      )
      .filter(Boolean);

    return {
      dates,
      closes,
      trend,
      upper1,
      lower1,
      upper2,
      lower2,
      logDev,
      ma200,
      maDev,
      periods,
      snapshot: {
        date: dates[last],
        close: closes[last],
        trend: trend[last],
        logDev: logDev[last],
        logDevStd: std(logDevValid),
        logDevP95,
        logDevP99,
        logDevPctile,
        ma200: ma200[last],
        maDev: maDev[last],
        maP95,
        maP99,
        maPctile,
        cagr,
        r2: reg.r2,
        rows: n,
        start: dates[0],
      },
    };
  }

  function linreg(x, y) {
    const n = x.length;
    let sx = 0,
      sy = 0,
      sxy = 0,
      sx2 = 0,
      sy2 = 0;
    for (let i = 0; i < n; i++) {
      sx += x[i];
      sy += y[i];
      sxy += x[i] * y[i];
      sx2 += x[i] * x[i];
      sy2 += y[i] * y[i];
    }
    const denom = n * sx2 - sx * sx;
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    const rDenom = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
    const r = rDenom === 0 ? 0 : (n * sxy - sx * sy) / rDenom;
    return { slope, intercept, r2: r * r };
  }

  function rollingMean(values, windowSize) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= windowSize) sum -= values[i - windowSize];
      if (i >= windowSize - 1) out[i] = sum / windowSize;
    }
    return out;
  }

  function std(values) {
    const nums = values.filter(Number.isFinite);
    if (!nums.length) return NaN;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return Math.sqrt(
      nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length,
    );
  }

  function quantile(values, q) {
    const nums = values
      .filter(Number.isFinite)
      .slice()
      .sort((a, b) => a - b);
    if (!nums.length) return NaN;
    const pos = (nums.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? nums[lo] : nums[lo] + (nums[hi] - nums[lo]) * (pos - lo);
  }

  function percentile(values, value) {
    if (!Number.isFinite(value)) return NaN;
    const nums = values.filter(Number.isFinite);
    if (!nums.length) return NaN;
    return (nums.filter((v) => v <= value).length / nums.length) * 100;
  }

  function positionPct(devPct) {
    if (!Number.isFinite(devPct) || devPct <= 0) return "--";
    const x = devPct / 100;
    return pct((0.2 / (1 - 1 / (1 + x))) * 100, 1);
  }

  function computePeriod(label, start, end, dates, closes) {
    const s = dates.findIndex((d) => d >= start);
    let e = -1;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] <= end) {
        e = i;
        break;
      }
    }
    if (s < 0 || e <= s || e - s < 50) return null;
    const part = closes.slice(s, e + 1);
    const t = Array.from({ length: part.length }, (_, i) => i);
    const reg = linreg(t, part.map(Math.log));
    const fittedLast = Math.exp(reg.intercept + reg.slope * (part.length - 1));
    return {
      label,
      days: part.length,
      cagr: (Math.exp(reg.slope * 252) - 1) * 100,
      r2: reg.r2,
      dev: (part[part.length - 1] / fittedLast - 1) * 100,
      endDate: dates[e],
    };
  }

  function render() {
    renderSummary();
    renderCharts();
    renderTable();
  }

  function renderSummary() {
    const s = model.snapshot;
    const status =
      s.maDev >= s.maP99
        ? ["高于 P99", "positive"]
        : s.maDev >= s.maP95
          ? ["高于 P95", "warn"]
          : ["常态区间", "neutral"];
    $("trendCaption").textContent =
      `${s.start} 至 ${s.date}，${fmtInt(s.rows)} 个交易日，CAGR ${pct(s.cagr)}`;
    $("summary").innerHTML = `
      <div class="summary-hero">
        <div class="summary-kicker">最新收盘</div>
        <div class="summary-main">${fmtInt(s.close)}</div>
        <div class="summary-sub">${s.date} · ${fmtInt(s.rows)} 个交易日</div>
      </div>
      <div class="summary-grid">
        ${metric("趋势线", fmtInt(s.trend), `R² ${fmt(s.r2, 4)} · CAGR ${pct(s.cagr)}`, "neutral")}
        ${metric(
          "趋势偏离",
          pct(s.logDev),
          `历史分位 ${fmt(s.logDevPctile, 1)}% · 推荐仓位 ${positionPct(s.logDev)}`,
          s.logDev >= 0 ? "positive" : "negative",
          [`P95 ${pct(s.logDevP95)}`, `P99 ${pct(s.logDevP99)}`],
        )}
        ${metric("MA200", fmtInt(s.ma200), "200 日均线", "neutral")}
        ${metric(
          "MA200 偏离",
          pct(s.maDev),
          `历史分位 ${fmt(s.maPctile, 1)}%`,
          s.maDev >= 0 ? "ma-positive" : "ma-negative",
          [`P95 ${pct(s.maP95)}`, `P99 ${pct(s.maP99)}`],
        )}
      </div>
      <div class="summary-status ${status[1]}">
        <div class="status-label">当前状态</div>
        <div class="status-value">${status[0]}</div>
        <div class="status-note">基于 MA200 偏离阈值</div>
      </div>`;
  }

  async function updateData() {
    const button = $("updateButton");
    button.disabled = true;
    button.textContent = "更新中...";
    const before = model.snapshot.date;
    try {
      const latest = await fetchLatestRows(before);
      const merged = normalizeRows(
        [...raw.dates, ...latest.dates],
        [...raw.closes, ...latest.closes],
      );
      const changed =
        merged.dates.length !== raw.dates.length ||
        merged.dates[merged.dates.length - 1] !==
          raw.dates[raw.dates.length - 1] ||
        merged.closes[merged.closes.length - 1] !==
          raw.closes[raw.closes.length - 1];

      raw = merged;
      model = computeModel(raw.dates, raw.closes);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
      render();

      if (changed) {
        toast(`已通过 ${latest.source} 更新至 ${model.snapshot.date}`);
      } else {
        toast(`${latest.source} 已检查，当前已是最新：${model.snapshot.date}`);
      }
    } catch (error) {
      toast(error.message || "自动更新失败，可用 CSV 导入兜底。");
    } finally {
      button.disabled = false;
      button.textContent = "更新数据";
    }
  }

  async function fetchLatestRows(lastDate) {
    const errors = [];
    const startDate = addDays(lastDate, -7);
    const endDate = todayString();
    const sources = [
      {
        name: "本地代理",
        run: async () => fetchLocalProxy(lastDate),
      },
      {
        name: "东方财富",
        run: async () => fetchEastmoneyKlines(startDate, endDate),
      },
      {
        name: "东方财富实时",
        run: async () => {
          const quote = await fetchEastmoneyQuote();
          return filterFreshRows(
            { dates: [quote.date], closes: [quote.close] },
            startDate,
          );
        },
      },
      {
        name: "新浪实时",
        run: async () => {
          const quote = await fetchSinaQuote();
          return filterFreshRows(
            { dates: [quote.date], closes: [quote.close] },
            startDate,
          );
        },
      },
      {
        name: "Stooq",
        run: async () => {
          const url = `https://stooq.com/q/d/l/?s=%5Endx&i=d&d1=${compactDate(startDate)}&d2=${compactDate(endDate)}`;
          const text = await fetchText(url, 12000);
          const parsed = parseCsv(text, 1);
          return filterFreshRows(parsed, startDate);
        },
      },
      {
        name: "Yahoo",
        run: async () => {
          const p1 = Math.floor(
            new Date(`${startDate}T00:00:00Z`).getTime() / 1000,
          );
          const p2 = Math.floor((Date.now() + 86400000) / 1000);
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?period1=${p1}&period2=${p2}&interval=1d&events=history`;
          const json = await fetchJson(url, 12000);
          return parseYahooChart(json, startDate);
        },
      },
    ];

    for (const source of sources) {
      try {
        const rows = await source.run();
        if (rows.dates.length)
          return { ...rows, source: rows.source || source.name };
        errors.push(`${source.name}: 无有效新数据`);
      } catch (error) {
        errors.push(`${source.name}: ${error.message || error}`);
      }
    }
    throw new Error(
      `自动更新失败：${errors.join("；")}。可先下载日线 CSV 后用“导入 CSV”。`,
    );
  }

  async function fetchLocalProxy(lastDate) {
    const base = location.protocol === "file:" ? "http://127.0.0.1:8866" : "";
    const json = await fetchJson(
      `${base}/api/ndx/update?last=${encodeURIComponent(lastDate)}`,
      18000,
    );
    if (!json.ok) throw new Error(json.error || "本地代理返回失败");
    const rows = Array.isArray(json.rows) ? json.rows : [];
    return {
      dates: rows.map((r) => r.date),
      closes: rows.map((r) => Number(r.close)),
      source: json.source || "本地代理",
    };
  }

  async function fetchEastmoneyKlines(startDate, endDate) {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.NDX&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&beg=${compactDate(startDate)}&end=${compactDate(endDate)}`;
    const json = await jsonp(url, 12000);
    const klines = json && json.data && json.data.klines;
    if (!Array.isArray(klines) || !klines.length)
      throw new Error("无历史 K 线");
    const dates = [];
    const closes = [];
    for (const row of klines) {
      const parts = String(row).split(",");
      const date = parts[0];
      const close = Number(parts[2]);
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        Number.isFinite(close) &&
        close > 0
      ) {
        dates.push(date);
        closes.push(close);
      }
    }
    return filterFreshRows({ dates, closes }, startDate);
  }

  async function fetchEastmoneyQuote() {
    const url =
      "https://push2.eastmoney.com/api/qt/stock/get?secid=100.NDX&fields=f43,f58,f59,f60,f86";
    const json = await jsonp(url, 10000);
    const data = json && json.data;
    if (!data) throw new Error("无报价数据");
    const rawPrice = Number(data.f43);
    const scale = Number.isFinite(Number(data.f59))
      ? 10 ** Number(data.f59)
      : 100;
    const close = rawPrice > 100000 ? rawPrice / scale : rawPrice;
    const timestamp = String(data.f86 || "");
    const date =
      timestamp.length >= 8
        ? `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`
        : todayString();
    if (!Number.isFinite(close) || close <= 0) throw new Error("报价格式异常");
    return { date, close };
  }

  function jsonp(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const callbackName = `ndxJsonp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const script = document.createElement("script");
      const sep = url.includes("?") ? "&" : "?";
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("请求超时"));
      }, timeoutMs);

      window[callbackName] = (payload) => {
        cleanup();
        resolve(payload);
      };
      script.src = `${url}${sep}cb=${callbackName}&_=${Date.now()}`;
      script.onerror = () => {
        cleanup();
        reject(new Error("脚本加载失败"));
      };

      function cleanup() {
        clearTimeout(timer);
        delete window[callbackName];
        script.remove();
      }

      document.head.appendChild(script);
    });
  }

  async function fetchText(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchJson(url, timeoutMs) {
    const text = await fetchText(url, timeoutMs);
    return JSON.parse(text);
  }

  function parseYahooChart(json, startDate) {
    const result =
      json && json.chart && json.chart.result && json.chart.result[0];
    if (!result || !Array.isArray(result.timestamp))
      throw new Error("返回数据格式异常");
    const closes =
      result.indicators &&
      result.indicators.quote &&
      result.indicators.quote[0] &&
      result.indicators.quote[0].close;
    if (!Array.isArray(closes)) throw new Error("缺少 close 序列");
    const dates = [];
    const values = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const close = Number(closes[i]);
      if (Number.isFinite(close) && close > 0) {
        dates.push(
          new Date(result.timestamp[i] * 1000).toISOString().slice(0, 10),
        );
        values.push(close);
      }
    }
    return filterFreshRows({ dates, closes: values }, startDate);
  }

  function fetchSinaQuote() {
    return new Promise((resolve, reject) => {
      const old = window.hq_str_gb_ndx;
      delete window.hq_str_gb_ndx;
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        cleanup();
        window.hq_str_gb_ndx = old;
        reject(new Error("请求超时"));
      }, 10000);

      script.src = `https://hq.sinajs.cn/list=gb_ndx&_=${Date.now()}`;
      script.onload = () => {
        const rawQuote = window.hq_str_gb_ndx;
        cleanup();
        if (old !== undefined) window.hq_str_gb_ndx = old;
        try {
          if (!rawQuote) throw new Error("无报价内容");
          const parts = String(rawQuote).split(",");
          const close = Number(parts[1] || parts[0]);
          const date = normalizeQuoteDate(parts[3]) || todayString();
          if (!Number.isFinite(close) || close <= 0)
            throw new Error("报价格式异常");
          resolve({ date, close });
        } catch (error) {
          reject(error);
        }
      };
      script.onerror = () => {
        cleanup();
        window.hq_str_gb_ndx = old;
        reject(new Error("脚本加载失败"));
      };

      function cleanup() {
        clearTimeout(timer);
        script.remove();
      }

      document.head.appendChild(script);
    });
  }

  function normalizeQuoteDate(value) {
    if (!value) return "";
    const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
  }

  function filterFreshRows(rows, startDate) {
    const normalized = normalizeRows(rows.dates, rows.closes);
    const dates = [];
    const closes = [];
    for (let i = 0; i < normalized.dates.length; i++) {
      if (normalized.dates[i] >= startDate) {
        dates.push(normalized.dates[i]);
        closes.push(normalized.closes[i]);
      }
    }
    return { dates, closes };
  }

  function compactDate(date) {
    return date.replaceAll("-", "");
  }

  function todayString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(date, days) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function metric(label, value, note, cls, chips = []) {
    return `<div class="metric">
      <div class="metric-top">
        <span class="metric-label">${label}</span>
        ${chips.length ? `<span class="metric-chips">${chips.map((chip) => `<b>${chip}</b>`).join("")}</span>` : ""}
      </div>
      <div class="metric-row">
        <span class="metric-value ${cls || ""}">${value}</span>
        <span class="metric-note">${note}</span>
      </div>
    </div>`;
  }

  function renderCharts() {
    const sample = sampledIndices(model.dates.length, 1500);
    const sampledDates = sample.map((i) => model.dates[i]);

    lineChart("trendChart", {
      dates: sampledDates,
      yScale: "log",
      yFormatter: fmtInt,
      tooltipFormatter: fmtInt,
      series: [
        {
          name: "NDX",
          values: sample.map((i) => model.closes[i]),
          color: COLORS.blue,
          width: 2,
        },
        {
          name: "趋势",
          values: sample.map((i) => model.trend[i]),
          color: COLORS.red,
          width: 2,
          dash: "6 5",
        },
        {
          name: "+1σ",
          values: sample.map((i) => model.upper1[i]),
          color: COLORS.amber,
          width: 1,
          dash: "4 4",
        },
        {
          name: "-1σ",
          values: sample.map((i) => model.lower1[i]),
          color: COLORS.amber,
          width: 1,
          dash: "4 4",
        },
        {
          name: "+2σ",
          values: sample.map((i) => model.upper2[i]),
          color: COLORS.red,
          width: 1,
          opacity: 0.45,
          dash: "3 5",
        },
        {
          name: "-2σ",
          values: sample.map((i) => model.lower2[i]),
          color: COLORS.red,
          width: 1,
          opacity: 0.45,
          dash: "3 5",
        },
      ],
    });

    lineChart("deviationChart", {
      dates: sampledDates,
      yFormatter: (v) => `${Math.round(v)}%`,
      tooltipFormatter: (v) => pct(v, 1),
      zeroLine: true,
      referenceLines: [
        { value: model.snapshot.logDevP95, label: "P95", color: COLORS.amber },
        { value: model.snapshot.logDevP99, label: "P99", color: COLORS.red },
        {
          value: model.snapshot.logDev,
          label: `Now ${fmt(model.snapshot.logDevPctile, 1)}%ile`,
          color: COLORS.teal,
          dash: "2 0",
          dy: -8,
        },
      ],
      areaToZero: true,
      areaColors: {
        positive: "rgba(196, 73, 61, 0.18)",
        negative: "rgba(47, 125, 79, 0.16)",
      },
      series: [
        {
          name: "趋势偏离",
          values: sample.map((i) => model.logDev[i]),
          color: COLORS.teal,
          width: 1.7,
        },
      ],
    });

    const maSample = sample.filter((i) => model.maDev[i] != null);
    lineChart("maChart", {
      dates: maSample.map((i) => model.dates[i]),
      yFormatter: (v) => `${Math.round(v)}%`,
      tooltipFormatter: (v) => pct(v, 1),
      zeroLine: true,
      referenceLines: [
        { value: model.snapshot.maP95, label: "P95", color: COLORS.amber },
        { value: model.snapshot.maP99, label: "P99", color: COLORS.red },
      ],
      areaToZero: true,
      areaColors: {
        positive: "rgba(47, 125, 79, 0.17)",
        negative: "rgba(196, 73, 61, 0.18)",
      },
      series: [
        {
          name: "MA200 偏离",
          values: maSample.map((i) => model.maDev[i]),
          color: COLORS.purple,
          width: 1.7,
        },
      ],
    });

    const recentIdx = sampledIndices(model.dates.length, 1500);
    lineChart("recentChart", {
      dates: recentIdx.map((i) => model.dates[i]),
      yFormatter: fmtInt,
      tooltipFormatter: fmtInt,
      series: [
        {
          name: "NDX",
          values: recentIdx.map((i) => model.closes[i]),
          color: COLORS.blue,
          width: 2,
        },
        {
          name: "MA200",
          values: recentIdx.map((i) => model.ma200[i]),
          color: COLORS.amber,
          width: 2,
          dash: "6 5",
        },
      ],
    });
  }

  function renderTable() {
    const rows = model.periods
      .map(
        (r) => `<tr>
      <td>${r.label}</td>
      <td>${r.endDate}</td>
      <td>${fmtInt(r.days)}</td>
      <td class="${r.cagr >= 0 ? "positive" : "negative"}">${pct(r.cagr, 2)}</td>
      <td>${fmt(r.r2, 4)}</td>
      <td class="${r.dev >= 0 ? "positive" : "negative"}">${pct(r.dev)}</td>
      <td>${positionPct(r.dev)}</td>
    </tr>`,
      )
      .join("");
    $("periodTable").innerHTML = `<thead><tr>
      <th>区间</th><th>区间结束</th><th>交易日</th><th>CAGR</th><th>R²</th><th>末值偏离</th><th>推荐仓位</th>
    </tr></thead><tbody>${rows}</tbody>`;
  }

  function lineChart(id, cfg) {
    const el = $(id);
    const width = Math.max(320, Math.round(el.getBoundingClientRect().width));
    const height = Math.max(240, Math.round(el.getBoundingClientRect().height));
    const margin = { top: 18, right: 54, bottom: 34, left: 62 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const allValues = cfg.series
      .flatMap((s) => s.values)
      .filter(Number.isFinite);
    if (cfg.referenceLines)
      allValues.push(
        ...cfg.referenceLines.map((l) => l.value).filter(Number.isFinite),
      );
    if (cfg.zeroLine || cfg.areaToZero) allValues.push(0);
    let min = Math.min(...allValues);
    let max = Math.max(...allValues);
    if (cfg.yScale === "log") {
      min = Math.max(1, min * 0.82);
      max *= 1.12;
    } else {
      const pad = (max - min || 1) * 0.12;
      min -= pad;
      max += pad;
    }
    const x = (i) =>
      margin.left +
      (cfg.dates.length === 1 ? 0 : (i / (cfg.dates.length - 1)) * plotW);
    const y = (v) => {
      if (!Number.isFinite(v)) return NaN;
      if (cfg.yScale === "log") {
        const lo = Math.log(min);
        const hi = Math.log(max);
        return (
          margin.top + ((hi - Math.log(Math.max(1, v))) / (hi - lo)) * plotH
        );
      }
      return margin.top + ((max - v) / (max - min)) * plotH;
    };
    const yTicks =
      cfg.yScale === "log" ? logTicks(min, max) : linearTicks(min, max, 5);
    const xTicks = dateTicks(cfg.dates, width < 720 ? 5 : 8);
    const paths = cfg.series.map((s) => ({
      ...s,
      path: pathFor(s.values, x, y),
    }));
    const zeroY = y(0);
    const area =
      cfg.areaToZero && Number.isFinite(zeroY)
        ? areaToZero(cfg.series[0].values, x, y, zeroY, cfg.areaColors)
        : "";

    el.innerHTML = `<svg width="${width}" height="${height}" role="img" aria-label="${id}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      <g class="grid">
        ${yTicks.map((t) => `<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(t)}" y2="${y(t)}"></line>`).join("")}
      </g>
      ${cfg.zeroLine && Number.isFinite(zeroY) ? `<line class="zero-line" x1="${margin.left}" x2="${width - margin.right}" y1="${zeroY}" y2="${zeroY}"></line>` : ""}
      ${
        cfg.referenceLines
          ? cfg.referenceLines
              .map(
                (r) => `<g>
        <line x1="${margin.left}" x2="${width - margin.right}" y1="${y(r.value)}" y2="${y(r.value)}" stroke="${r.color}" stroke-width="1.2" stroke-dasharray="${r.dash || "5 5"}"></line>
        <text x="${width - margin.right + 8}" y="${y(r.value) + 4 + (r.dy || 0)}" fill="${r.color}" font-size="11">${r.label}</text>
      </g>`,
              )
              .join("")
          : ""
      }
      ${area}
      <g class="axis">
        ${yTicks.map((t) => `<text x="${margin.left - 10}" y="${y(t) + 4}" text-anchor="end">${cfg.yFormatter ? cfg.yFormatter(t) : fmt(t)}</text>`).join("")}
        ${xTicks.map((t) => `<text x="${x(t.index)}" y="${height - 10}" text-anchor="middle">${t.label}</text>`).join("")}
      </g>
      <g>
        ${paths.map((s) => `<path class="series" d="${s.path}" stroke="${s.color}" stroke-width="${s.width || 1.5}" opacity="${s.opacity || 1}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}></path>`).join("")}
      </g>
      <line class="crosshair" x1="0" x2="0" y1="${margin.top}" y2="${height - margin.bottom}"></line>
      <rect class="hit" x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}" fill="transparent"></rect>
    </svg>
    <div class="legend">${cfg.series.map((s) => `<span style="color:${s.color}">${s.name}</span>`).join(" ")}</div>`;

    const svg = el.querySelector("svg");
    const hit = el.querySelector(".hit");
    const crosshair = el.querySelector(".crosshair");
    hit.addEventListener("mousemove", (event) => {
      const rect = svg.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const idx = clamp(
        Math.round(((localX - margin.left) / plotW) * (cfg.dates.length - 1)),
        0,
        cfg.dates.length - 1,
      );
      const cx = x(idx);
      crosshair.setAttribute("x1", cx);
      crosshair.setAttribute("x2", cx);
      crosshair.style.opacity = "1";
      showTooltip(
        event,
        cfg.dates[idx],
        cfg.series.map((s) => ({
          name: s.name,
          color: s.color,
          value: cfg.tooltipFormatter
            ? cfg.tooltipFormatter(s.values[idx])
            : fmt(s.values[idx]),
        })),
      );
    });
    hit.addEventListener("mouseleave", () => {
      crosshair.style.opacity = "0";
      hideTooltip();
    });
  }

  function pathFor(values, x, y) {
    let d = "";
    let open = false;
    for (let i = 0; i < values.length; i++) {
      const py = y(values[i]);
      if (!Number.isFinite(py)) {
        open = false;
        continue;
      }
      d += `${open ? "L" : "M"}${x(i).toFixed(2)},${py.toFixed(2)}`;
      open = true;
    }
    return d;
  }

  function areaToZero(values, x, y, zeroY, colors) {
    const positiveColor =
      colors && colors.positive ? colors.positive : "rgba(196, 73, 61, 0.18)";
    const negativeColor =
      colors && colors.negative ? colors.negative : "rgba(47, 125, 79, 0.16)";
    const segments = [];
    let current = null;

    function signOf(value) {
      return value >= 0 ? "positive" : "negative";
    }

    function startSegment(sign, point) {
      current = { sign, points: [point] };
    }

    function closeSegment(point) {
      if (!current) return;
      current.points.push(point);
      if (current.points.length >= 2) segments.push(current);
      current = null;
    }

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (!Number.isFinite(value)) {
        closeSegment(
          current ? current.points[current.points.length - 1] : null,
        );
        continue;
      }

      const point = { x: x(i), y: y(value), zeroY };
      if (!current) {
        startSegment(
          signOf(value),
          value === 0 ? { ...point, y: zeroY } : point,
        );
      } else {
        current.points.push(value === 0 ? { ...point, y: zeroY } : point);
      }

      const nextValue = values[i + 1];
      if (!Number.isFinite(nextValue)) {
        closeSegment(point);
        continue;
      }

      if (value === 0) {
        closeSegment({ ...point, y: zeroY });
        startSegment(signOf(nextValue), { ...point, y: zeroY });
        continue;
      }

      if ((value > 0 && nextValue < 0) || (value < 0 && nextValue > 0)) {
        const ratio = Math.abs(value) / (Math.abs(value) + Math.abs(nextValue));
        const crossX = x(i) + (x(i + 1) - x(i)) * ratio;
        const cross = { x: crossX, y: zeroY, zeroY };
        closeSegment(cross);
        startSegment(signOf(nextValue), cross);
      }
    }

    if (current && current.points.length >= 2) segments.push(current);

    return segments
      .map((segment) => {
        const color =
          segment.sign === "positive" ? positiveColor : negativeColor;
        return `<path d="${areaPath(segment.points)}" fill="${color}"></path>`;
      })
      .join("");
  }

  function areaPath(points) {
    if (points.length < 2) return "";
    const top = points
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join("");
    const bottom = points
      .slice()
      .reverse()
      .map((p) => `L${p.x.toFixed(2)},${p.zeroY.toFixed(2)}`)
      .join("");
    return `${top}${bottom}Z`;
  }

  function sampledIndices(length, maxPoints) {
    if (length <= maxPoints) return Array.from({ length }, (_, i) => i);
    const out = [];
    const step = (length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i++) out.push(Math.round(i * step));
    return Array.from(new Set(out));
  }

  function linearTicks(min, max, count) {
    const step = niceStep((max - min) / Math.max(1, count - 1));
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 0.5; v += step) ticks.push(v);
    return ticks.slice(0, 8);
  }

  function niceStep(raw) {
    const pow = 10 ** Math.floor(Math.log10(raw || 1));
    const x = raw / pow;
    const nice = x <= 1 ? 1 : x <= 2 ? 2 : x <= 5 ? 5 : 10;
    return nice * pow;
  }

  function logTicks(min, max) {
    const ticks = [];
    const start = Math.floor(Math.log10(min));
    const end = Math.ceil(Math.log10(max));
    for (let e = start; e <= end; e++) {
      [1, 2, 5].forEach((m) => {
        const v = m * 10 ** e;
        if (v >= min && v <= max) ticks.push(v);
      });
    }
    return ticks;
  }

  function dateTicks(dates, count) {
    if (!dates.length) return [];
    const ticks = [];
    for (let i = 0; i < count; i++) {
      const index = Math.round(
        (i * (dates.length - 1)) / Math.max(1, count - 1),
      );
      ticks.push({ index, label: dates[index].slice(0, 4) });
    }
    return ticks.filter((t, i, arr) => i === 0 || t.label !== arr[i - 1].label);
  }

  function showTooltip(event, date, rows) {
    const tip = $("tooltip");
    tip.innerHTML = `<b>${date}</b>${rows.map((r) => `<div><span style="color:${r.color}">${r.name}</span><strong>${r.value}</strong></div>`).join("")}`;
    tip.style.left = `${event.clientX}px`;
    tip.style.top = `${event.clientY}px`;
    tip.style.opacity = "1";
  }

  function hideTooltip() {
    $("tooltip").style.opacity = "0";
  }

  async function handleCsvInput(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const parsed = parseCsv(await file.text());
      raw = normalizeRows(parsed.dates, parsed.closes);
      model = computeModel(raw.dates, raw.closes);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
      render();
      toast(
        `已导入 ${fmtInt(raw.dates.length)} 行，最新日期 ${model.snapshot.date}`,
      );
    } catch (error) {
      toast(error.message || "CSV 解析失败");
    } finally {
      event.target.value = "";
    }
  }

  function parseCsv(text, minRows = 260) {
    const rows = text
      .trim()
      .split(/\r?\n/)
      .map(parseCsvLine)
      .filter((r) => r.length);
    if (rows.length < 2) throw new Error("CSV 数据太少。");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const dateIdx = header.findIndex((h) => h === "date" || h.includes("日期"));
    let closeIdx = header.findIndex(
      (h) => h === "close" || h === "收盘" || h.includes("close"),
    );
    if (closeIdx < 0) closeIdx = 1;
    if (dateIdx < 0 || closeIdx < 0)
      throw new Error("CSV 需要包含 date 和 close 列。");

    const dates = [];
    const closes = [];
    for (let i = 1; i < rows.length; i++) {
      const date = rows[i][dateIdx];
      const close = Number(rows[i][closeIdx]);
      if (date && Number.isFinite(close) && close > 0) {
        dates.push(date);
        closes.push(close);
      }
    }
    if (dates.length < minRows) throw new Error("有效数据不足。");
    return { dates, closes };
  }

  function parseCsvLine(line) {
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = !quoted;
      } else if (ch === "," && !quoted) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  function resetData() {
    localStorage.removeItem(STORAGE_KEY);
    raw = normalizeRows(window.RAW_NDX.dates, window.RAW_NDX.closes);
    model = computeModel(raw.dates, raw.closes);
    render();
    toast("已恢复内置历史数据。");
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function debounce(fn, ms) {
    let timer = null;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
})();
