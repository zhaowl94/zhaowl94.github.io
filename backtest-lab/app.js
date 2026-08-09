let DATA = window.BACKTEST_DATA;

const $ = (id) => document.getElementById(id);
const pct = (v, d = 2) => `${(v * 100).toFixed(d)}%`;
const num = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "-");

const DATASET_LABELS = {
  inceptionCny: "全周期：人民币计价纳指100收益 + 4%债券代理",
  liveQfq: "实盘：513100场内前复权 + 富国天利A",
};
const SIGNAL_LABELS = {
  ndxPrice: "^NDX价格信号",
  cnyTotalReturn: "人民币全收益信号",
  nav513100: "513100基金净值信号",
  qfqPrice: "513100场内前复权信号",
};

function byDate(a, b) {
  return a.date.localeCompare(b.date);
}

function cloneRows(rows) {
  return (rows || [])
    .map((r) => ({
      date: r.date,
      open: Number(r.open ?? r.close),
      high: Number(r.high ?? r.close),
      low: Number(r.low ?? r.close),
      close: Number(r.close),
    }))
    .filter((r) => r.date && Number.isFinite(r.close))
    .sort(byDate);
}

function sma(rows, idx, len) {
  if (idx < len) return NaN;
  let sum = 0;
  for (let i = idx - len; i < idx; i++) sum += rows[i].close;
  return sum / len;
}

function enrichIndicators(rows, maLen, indLen) {
  const out = cloneRows(rows);
  let prevClose = NaN;
  const tr = [];
  const plusDm = [];
  const minusDm = [];

  for (let i = 0; i < out.length; i++) {
    const row = out[i];
    row.ma = sma(out, i, maLen);
    if (i === 0) {
      tr.push(0);
      plusDm.push(0);
      minusDm.push(0);
    } else {
      const p = out[i - 1];
      const up = row.high - p.high;
      const down = p.low - row.low;
      tr.push(
        Math.max(
          row.high - row.low,
          Math.abs(row.high - prevClose),
          Math.abs(row.low - prevClose),
        ),
      );
      plusDm.push(up > down && up > 0 ? up : 0);
      minusDm.push(down > up && down > 0 ? down : 0);
    }
    prevClose = row.close;
  }

  const dx = new Array(out.length).fill(NaN);
  for (let i = indLen; i < out.length; i++) {
    let trSum = 0,
      pSum = 0,
      mSum = 0;
    for (let j = i - indLen + 1; j <= i; j++) {
      trSum += tr[j];
      pSum += plusDm[j];
      mSum += minusDm[j];
    }
    const plusDi = trSum ? (100 * pSum) / trSum : 0;
    const minusDi = trSum ? (100 * mSum) / trSum : 0;
    dx[i] =
      plusDi + minusDi
        ? (100 * Math.abs(plusDi - minusDi)) / (plusDi + minusDi)
        : 0;
  }
  for (let i = indLen * 2; i < out.length; i++) {
    let dxSum = 0,
      count = 0;
    for (let j = i - indLen + 1; j <= i; j++) {
      if (Number.isFinite(dx[j])) {
        dxSum += dx[j];
        count++;
      }
    }
    out[i].adx = count ? dxSum / count : NaN;
  }
  for (let i = indLen; i < out.length; i++) {
    let movement = 0;
    for (let j = i - indLen + 1; j <= i; j++)
      movement += Math.abs(out[j].close - out[j - 1].close);
    out[i].er = movement
      ? Math.abs(out[i].close - out[i - indLen].close) / movement
      : 0;
  }
  for (let i = 20; i < out.length; i++) {
    const returns = [];
    for (let j = i - 19; j <= i; j++)
      returns.push(out[j].close / out[j - 1].close - 1);
    out[i].vol20 = annualizedVol(returns);
  }
  for (let i = 60; i < out.length; i++) {
    const returns = [];
    for (let j = i - 59; j <= i; j++)
      returns.push(out[j].close / out[j - 1].close - 1);
    out[i].vol60 = annualizedVol(returns);
  }
  return out;
}

function annualizedVol(returns) {
  const clean = returns.filter(Number.isFinite);
  if (clean.length < 2) return NaN;
  const mean = clean.reduce((s, r) => s + r, 0) / clean.length;
  const variance =
    clean.reduce((s, r) => s + (r - mean) ** 2, 0) / (clean.length - 1);
  return Math.sqrt(variance * 252);
}

function xirr(cashflows) {
  if (cashflows.length < 2) return NaN;
  const t0 = new Date(cashflows[0].date).getTime();
  const npv = (rate) =>
    cashflows.reduce((s, cf) => {
      const years = (new Date(cf.date).getTime() - t0) / (365.25 * 864e5);
      return s + cf.amount / Math.pow(1 + rate, years);
    }, 0);
  let lo = -0.999,
    hi = 10;
  for (let i = 0; i < 160; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function getConfig() {
  return {
    datasetKey: $("dataset").value,
    signalKey: $("signal").value,
    strategy: $("strategy").value,
    maLen: Number($("maLen").value),
    monthly: Number($("monthly").value),
    high: Number($("high").value) / 100,
    low: Number($("low").value) / 100,
    neutral: Number($("neutral").value) / 100,
    fixed: Number($("fixed").value) / 100,
    ddConfirm: Number($("ddConfirm").value) / 100,
    rebConfirm: Number($("rebConfirm").value) / 100,
    minSwitchDays: Number($("minSwitchDays").value),
    rebalanceBand: Number($("rebalanceBand").value) / 100,
    indLen: Number($("indLen").value),
    adxTh: Number($("adxTh").value),
    erTh: Number($("erTh").value),
    chopMode: $("chopMode").value,
  };
}

function dataset(key = $("dataset").value) {
  return DATA.datasets[key];
}

function makeBondReturn(ds, bondRows, prevDate, date) {
  if (ds.bondProxyAnnualReturn != null)
    return Math.pow(1 + ds.bondProxyAnnualReturn, 1 / 252) - 1;
  const prev = bondRows.get(prevDate);
  const cur = bondRows.get(date);
  if (!prev || !cur) return null;
  return cur / prev - 1;
}

function backtest(configOverride = null) {
  const cfg = configOverride || getConfig();
  const ds = dataset(cfg.datasetKey);
  const equity = cloneRows(ds.equity);
  const signalRows = enrichIndicators(
    ds.signals[cfg.signalKey].rows,
    cfg.maLen,
    cfg.indLen,
  );
  const signalDates = signalRows.map((r) => r.date);
  const bondMap = new Map(
    (ds.bond || []).map((r) => [r.date, Number(r.close)]),
  );

  let sIdx = 0;
  let stock = 0,
    bond = 0,
    invested = 0,
    acctPeak = 0,
    mdd = 0,
    maxLossOnCapital = 0;
  let lastMonth = "",
    lastDate = "",
    lastWeight = NaN,
    target = cfg.strategy === "fixed" ? cfg.fixed : cfg.high;
  let equityPeak = equity[0]?.close ?? 0,
    equityTrough = equity[0]?.close ?? 0;
  let lastSwitchIndex = -1e9;
  let state = "high";
  const series = [],
    cashflows = [],
    trades = [],
    dailyReturns = [];

  for (let i = 1; i < equity.length; i++) {
    const row = equity[i],
      prev = equity[i - 1];
    if (ds.bond && (!bondMap.has(row.date) || !bondMap.has(prev.date)))
      continue;

    while (sIdx + 1 < signalDates.length && signalDates[sIdx + 1] < row.date)
      sIdx++;
    const sig = signalRows[sIdx];
    if (!sig) continue;

    const prevTotal = stock + bond;
    const er = row.close / prev.close - 1;
    const br = makeBondReturn(ds, bondMap, prev.date, row.date);
    if (br == null) continue;
    stock *= 1 + er;
    bond *= 1 + br;
    const marketTotal = stock + bond;
    if (prevTotal > 0) dailyReturns.push(marketTotal / prevTotal - 1);

    if (row.close > equityPeak) equityPeak = row.close;
    if (state === "low" && row.close < equityTrough) equityTrough = row.close;

    const beforeSignalTarget = target;
    let desired = target;
    let reason = "";
    if (cfg.strategy === "fixed") {
      desired = cfg.fixed;
    } else if (cfg.strategy === "maConfirm") {
      const below = Number.isFinite(sig.ma) && sig.close < sig.ma;
      const above = Number.isFinite(sig.ma) && sig.close >= sig.ma;
      const drawdown = row.close / equityPeak - 1;
      const rebound = row.close / equityTrough - 1;
      desired = state === "high" ? cfg.high : cfg.low;
      if (state === "high" && below && drawdown <= -cfg.ddConfirm) {
        if (i - lastSwitchIndex >= cfg.minSwitchDays) {
          state = "low";
          equityTrough = row.close;
          desired = cfg.low;
          reason = `跌破MA且回撤${pct(drawdown, 1)}`;
        }
      } else if (state === "low" && above && rebound >= cfg.rebConfirm) {
        if (i - lastSwitchIndex >= cfg.minSwitchDays) {
          state = "high";
          desired = cfg.high;
          reason = `站回MA且反弹${pct(rebound, 1)}`;
        }
      }
    } else if (cfg.strategy === "adxEr") {
      const trendValid = sig.adx >= cfg.adxTh && sig.er >= cfg.erTh;
      if (trendValid) {
        desired = sig.close >= sig.ma ? cfg.high : cfg.low;
        reason =
          sig.close >= sig.ma ? "ADX/ER有效且在MA上" : "ADX/ER有效且在MA下";
      } else {
        desired = cfg.chopMode === "neutral" ? cfg.neutral : target;
        reason = "ADX/ER显示震荡";
      }
    }
    if (
      cfg.strategy === "adxEr" &&
      Math.abs(desired - target) > 1e-9 &&
      i - lastSwitchIndex < cfg.minSwitchDays
    ) {
      desired = target;
      reason = "最小切换间隔内保持原仓";
    }
    target = desired;

    const month = row.date.slice(0, 7);
    const isNewMonth = month !== lastMonth;
    const changed =
      Number.isFinite(lastWeight) && Math.abs(target - lastWeight) > 1e-9;
    if (changed && Math.abs(target - beforeSignalTarget) > 1e-9)
      lastSwitchIndex = i;
    if (isNewMonth) {
      stock += cfg.monthly * target;
      bond += cfg.monthly * (1 - target);
      invested += cfg.monthly;
      cashflows.push({ date: row.date, amount: -cfg.monthly });
      lastMonth = month;
      reason ||= "月度投入";
    }
    if (changed && Math.abs(target - beforeSignalTarget) > 1e-9) {
      trades.push({
        date: row.date,
        action: "信号切换",
        weight: target,
        reason: reason || "目标仓位变化",
      });
    }

    const totalBeforeRebalance = stock + bond;
    const actualWeight =
      totalBeforeRebalance > 0 ? stock / totalBeforeRebalance : target;
    const needsMonthlyRebalance =
      isNewMonth && Math.abs(actualWeight - target) >= cfg.rebalanceBand;
    const needsSignalRebalance =
      changed && Math.abs(target - beforeSignalTarget) > 1e-9;
    if (
      needsMonthlyRebalance &&
      !needsSignalRebalance &&
      totalBeforeRebalance > 0
    ) {
      trades.push({
        date: row.date,
        action: "月度再平衡",
        weight: target,
        reason: `偏离${pct(actualWeight - target, 1)}`,
      });
    }

    if (
      needsMonthlyRebalance ||
      needsSignalRebalance ||
      !Number.isFinite(lastWeight)
    ) {
      const total = stock + bond;
      stock = total * target;
      bond = total * (1 - target);
      lastWeight = target;
    }

    const total = stock + bond;
    if (total > acctPeak) acctPeak = total;
    const dd = acctPeak ? total / acctPeak - 1 : 0;
    if (dd < mdd) mdd = dd;
    const loss = invested ? total / invested - 1 : 0;
    if (loss < maxLossOnCapital) maxLossOnCapital = loss;
    series.push({
      date: row.date,
      total,
      invested,
      multiple: invested ? total / invested : 1,
      dd,
      weight: target,
    });
    lastDate = row.date;
  }

  const final = series.at(-1)?.total ?? 0;
  cashflows.push({ date: lastDate, amount: final });
  const irr = xirr(cashflows);
  const avgW =
    series.reduce((s, r) => s + r.weight, 0) / Math.max(series.length, 1);
  const vol = annualizedVol(dailyReturns);
  const sharpe = Number.isFinite(vol) && vol > 0 ? (irr - 0.02) / vol : NaN;
  const switchCount = trades.filter((t) => t.action === "信号切换").length;
  return {
    cfg,
    ds,
    equity,
    signalRows,
    series,
    trades,
    dailyReturns,
    final,
    invested,
    irr,
    mdd,
    maxLossOnCapital,
    avgW,
    vol,
    sharpe,
    switchCount,
  };
}

function currentState(signalRows, cfg) {
  const latest = [...signalRows].reverse().find((r) => Number.isFinite(r.ma));
  if (!latest) return [];
  const dist = latest.close / latest.ma - 1;
  const trendValid = latest.adx >= cfg.adxTh && latest.er >= cfg.erTh;
  const regime = trendValid
    ? latest.close >= latest.ma
      ? "上行趋势"
      : "下行趋势"
    : "震荡/低效率";
  return [
    ["日期", latest.date],
    ["收盘", num(latest.close, 2)],
    [`MA${cfg.maLen}`, num(latest.ma, 2)],
    ["距MA", pct(dist, 2)],
    ["ADX", num(latest.adx, 2)],
    ["ER", num(latest.er, 3)],
    ["20日波动", pct(latest.vol20, 1)],
    ["60日波动", pct(latest.vol60, 1)],
    ["判定", regime],
  ];
}

function renderMetrics(result) {
  const years = result.series.length / 252;
  const totalReturn = result.final / result.invested - 1;
  const metrics = [
    ["XIRR", pct(result.irr, 2)],
    ["年化波动率", pct(result.vol, 2)],
    ["夏普(2%无风险)", num(result.sharpe, 2)],
    ["资产/本金", `${num(result.final / result.invested, 2)}x`],
    ["期末盈利率", pct(totalReturn, 1)],
    ["账户最大回撤", pct(result.mdd, 1)],
    ["相对本金最大浮亏", pct(result.maxLossOnCapital, 1)],
    ["平均纳指仓位", pct(result.avgW, 1)],
    ["回测年数", num(years, 1)],
    ["调仓次数", String(result.switchCount)],
  ];
  $("metrics").innerHTML = metrics
    .map(
      ([k, v]) =>
        `<div class="metric"><span>${k}</span><strong>${v}</strong></div>`,
    )
    .join("");
}

function renderCurrent(result) {
  const cfg = result.cfg;
  const items = currentState(result.signalRows, cfg);
  $("current").innerHTML = items
    .map(
      ([k, v]) =>
        `<div class="current-item"><span>${k}</span><strong>${v}</strong></div>`,
    )
    .join("");
}

function renderTrades(trades) {
  $("trades").innerHTML = trades
    .slice(-80)
    .reverse()
    .map(
      (t) =>
        `<tr><td>${t.date}</td><td>${t.action}</td><td>${pct(t.weight, 0)}</td><td>${t.reason}</td></tr>`,
    )
    .join("");
}

function parseList(id) {
  return $(id)
    .value.split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
}

async function sweepAdxEr() {
  const base = getConfig();
  const highs = parseList("sweepHigh").map((v) => v / 100);
  const lows = parseList("sweepLow").map((v) => v / 100);
  const neutrals = parseList("sweepNeutral").map((v) => v / 100);
  const lens = parseList("sweepLen");
  const adxs = parseList("sweepAdx");
  const ers = parseList("sweepEr");
  const chopModes =
    $("sweepChop").value === "both"
      ? ["hold", "neutral"]
      : [$("sweepChop").value];
  const maxDd = -Number($("sweepMaxDd").value) / 100;
  const minXirr = Number($("sweepMinXirr").value) / 100;
  const objective = $("sweepObjective").value;
  const total =
    highs.length *
    lows.length *
    neutrals.length *
    lens.length *
    adxs.length *
    ers.length *
    chopModes.length;
  $("sweepHint").textContent = `正在遍历 ${total} 组参数...`;
  $("sweepResults").innerHTML = "";
  await new Promise((resolve) => setTimeout(resolve, 30));

  const rows = [];
  for (const high of highs)
    for (const low of lows)
      for (const neutral of neutrals) {
        if (low > high) continue;
        for (const indLen of lens)
          for (const adxTh of adxs)
            for (const erTh of ers)
              for (const chopMode of chopModes) {
                const cfg = {
                  ...base,
                  strategy: "adxEr",
                  high,
                  low,
                  neutral,
                  indLen,
                  adxTh,
                  erTh,
                  chopMode,
                };
                const result = backtest(cfg);
                if (result.irr >= minXirr && result.mdd >= maxDd) {
                  rows.push({
                    high,
                    low,
                    neutral,
                    indLen,
                    adxTh,
                    erTh,
                    chopMode,
                    irr: result.irr,
                    mdd: result.mdd,
                    vol: result.vol,
                    sharpe: result.sharpe,
                    switchCount: result.switchCount,
                  });
                }
              }
      }

  rows.sort((a, b) => {
    if (objective === "mdd") return b.mdd - a.mdd || b.irr - a.irr;
    if (objective === "sharpe") return b.sharpe - a.sharpe || b.irr - a.irr;
    return b.irr - a.irr || b.mdd - a.mdd;
  });
  renderSweepRows(rows.slice(0, 50));
  $("sweepHint").textContent =
    `完成：${total}组，符合约束${rows.length}组，显示前${Math.min(50, rows.length)}组。`;
}

function renderSweepRows(rows) {
  $("sweepResults").innerHTML = rows
    .map(
      (r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${pct(r.irr, 2)}</td>
      <td>${pct(r.mdd, 1)}</td>
      <td>${pct(r.vol, 2)}</td>
      <td>${num(r.sharpe, 2)}</td>
      <td>${r.switchCount}</td>
      <td>${pct(r.high, 0)}/${pct(r.low, 0)}/${pct(r.neutral, 0)}</td>
      <td>${r.indLen}</td>
      <td>${r.adxTh}</td>
      <td>${num(r.erTh, 2)}</td>
      <td>${r.chopMode === "hold" ? "保持" : "中性"}</td>
    </tr>
  `,
    )
    .join("");
}

function renderChart(series) {
  renderLineChart({
    canvas: $("chartMultiple"),
    series,
    color: "#1261a6",
    getter: (r) => r.multiple,
    label: (v) => `${num(v, 1)}x`,
    minValue: 0,
    maxValue: Math.max(...series.map((r) => r.multiple), 1.2),
  });
  renderLineChart({
    canvas: $("chartDrawdown"),
    series,
    color: "#b94040",
    getter: (r) => r.dd,
    label: (v) => pct(v, 0),
    minValue: Math.min(...series.map((r) => r.dd), -0.05),
    maxValue: 0,
    fillToZero: true,
  });
  renderLineChart({
    canvas: $("chartWeight"),
    series,
    color: "#22835f",
    getter: (r) => r.weight,
    label: (v) => pct(v, 0),
    minValue: 0,
    maxValue: 1,
    step: true,
  });
}

function renderLineChart({
  canvas,
  series,
  color,
  getter,
  label,
  minValue,
  maxValue,
  fillToZero = false,
  step = false,
}) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  const pad = { l: 70, r: 22, t: 22, b: 34 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const xs = (i) =>
    pad.l + (i * (w - pad.l - pad.r)) / Math.max(series.length - 1, 1);
  const range = maxValue - minValue || 1;
  const ys = (v) => pad.t + ((maxValue - v) / range) * plotH;

  ctx.strokeStyle = "#e5ebf2";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.t + (i * (h - pad.t - pad.b)) / 5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    const value = maxValue - (i * range) / 5;
    ctx.fillStyle = "#607083";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText(label(value), 10, y + 6);
  }

  if (fillToZero) {
    ctx.fillStyle = "rgba(185,64,64,0.08)";
    ctx.beginPath();
    series.forEach((r, i) => {
      const x = xs(i),
        y = ys(getter(r));
      if (i === 0) ctx.moveTo(x, ys(0));
      ctx.lineTo(x, y);
    });
    ctx.lineTo(xs(series.length - 1), ys(0));
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  series.forEach((r, i) => {
    const x = xs(i),
      y = ys(getter(r));
    if (i === 0) {
      ctx.moveTo(x, y);
    } else if (step) {
      const prevY = ys(getter(series[i - 1]));
      ctx.lineTo(x, prevY);
      ctx.lineTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, h - pad.b);
  ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();

  ctx.fillStyle = "#607083";
  ctx.font = "18px system-ui, sans-serif";
  ctx.fillText(series[0]?.date || "", pad.l, h - 10);
  ctx.fillText(series.at(-1)?.date || "", w - pad.r - 90, h - 10);
}

function run() {
  const result = backtest();
  const cfg = result.cfg;
  $("title").textContent =
    DATASET_LABELS[cfg.datasetKey] || result.ds.label || "回测结果";
  $("subtitle").textContent =
    `${SIGNAL_LABELS[cfg.signalKey] || cfg.signalKey}；策略=${$("strategy").selectedOptions[0].textContent}`;
  $("badge").textContent =
    `数据生成：${new Date(DATA.generatedAt).toLocaleString("zh-CN")}`;
  renderMetrics(result);
  renderCurrent(result);
  renderTrades(result.trades);
  renderChart(result.series);
  showFields();
}

function showFields() {
  const strategy = $("strategy").value;
  document.querySelectorAll(".strategy-fields").forEach((el) => {
    el.style.display = el.dataset.strategy === strategy ? "" : "none";
  });
}

function initOptions() {
  $("dataset").innerHTML = Object.keys(DATA.datasets)
    .map(
      (key) => `<option value="${key}">${DATASET_LABELS[key] || key}</option>`,
    )
    .join("");
  updateSignals();
  $("dataset").addEventListener("change", () => {
    updateSignals();
    run();
  });
  $("signal").addEventListener("change", run);
  $("strategy").addEventListener("change", () => {
    showFields();
    run();
  });
  document.querySelectorAll("input, select").forEach((el) => {
    if (!["dataset", "signal", "strategy"].includes(el.id))
      el.addEventListener("change", run);
  });
  $("run").addEventListener("click", run);
  $("presetMa").addEventListener("click", () => {
    $("strategy").value = "maConfirm";
    $("maLen").value = 200;
    $("high").value = 70;
    $("low").value = 5;
    $("ddConfirm").value = 18;
    $("rebConfirm").value = 3;
    run();
  });
  $("presetAdx").addEventListener("click", () => {
    $("strategy").value = "adxEr";
    $("maLen").value = 200;
    $("high").value = 70;
    $("low").value = 0;
    $("neutral").value = 50;
    $("indLen").value = 14;
    $("adxTh").value = 22;
    $("erTh").value = 0.2;
    $("chopMode").value = "hold";
    run();
  });
  $("sweepAdxEr").addEventListener("click", sweepAdxEr);
  $("refresh").addEventListener("click", refreshData);
}

function updateSignals() {
  const ds = dataset();
  $("signal").innerHTML = Object.keys(ds.signals)
    .map(
      (key) =>
        `<option value="${key}">${SIGNAL_LABELS[key] || ds.signals[key].label || key}</option>`,
    )
    .join("");
}

async function refreshData() {
  $("refreshHint").textContent = "正在绕过缓存，读取最新已发布快照...";
  try {
    const res = await fetch(`backtest_lab_data.js?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const source = await res.text();
    const prefix = "window.BACKTEST_DATA = ";
    const start = source.indexOf(prefix);
    if (start < 0) throw new Error("快照格式不正确");
    DATA = JSON.parse(
      source
        .slice(start + prefix.length)
        .trim()
        .replace(/;$/u, ""),
    );
    const selectedDataset = $("dataset").value;
    $("dataset").innerHTML = Object.keys(DATA.datasets)
      .map(
        (key) =>
          `<option value="${key}">${DATASET_LABELS[key] || key}</option>`,
      )
      .join("");
    if (DATA.datasets[selectedDataset]) $("dataset").value = selectedDataset;
    updateSignals();
    run();
    $("refreshHint").textContent =
      `已读取最新发布快照：${new Date(DATA.generatedAt).toLocaleString("zh-CN")}。`;
  } catch (err) {
    $("refreshHint").textContent =
      `刷新失败：${err.message}。当前回测结果保持不变，可稍后重试。`;
  }
}

initOptions();
showFields();
run();
