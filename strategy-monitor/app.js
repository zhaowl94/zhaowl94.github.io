let DATA = window.STRATEGY_DATA;

const els = {
  dataStamp: document.getElementById("dataStamp"),
  refreshDataBtn: document.getElementById("refreshDataBtn"),
  resetBtn: document.getElementById("resetBtn"),
  runBtn: document.getElementById("runBtn"),
  refreshStatus: document.getElementById("refreshStatus"),
  etfSelect: document.getElementById("etfSelect"),
  preset: document.getElementById("preset"),
  maLength: document.getElementById("maLength"),
  confirmDays: document.getElementById("confirmDays"),
  bufferPct: document.getElementById("bufferPct"),
  bufferValue: document.getElementById("bufferValue"),
  highWeightPct: document.getElementById("highWeightPct"),
  lowWeightPct: document.getElementById("lowWeightPct"),
  monthlyContribution: document.getElementById("monthlyContribution"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  signalBadge: document.getElementById("signalBadge"),
  signalDate: document.getElementById("signalDate"),
  signalPrice: document.getElementById("signalPrice"),
  maDeviation: document.getElementById("maDeviation"),
  bandText: document.getElementById("bandText"),
  confirmText: document.getElementById("confirmText"),
  actionText: document.getElementById("actionText"),
  targetEquity: document.getElementById("targetEquity"),
  targetBond: document.getElementById("targetBond"),
  nextActionText: document.getElementById("nextActionText"),
  ndxClose: document.getElementById("ndxClose"),
  fxClose: document.getElementById("fxClose"),
  equityClose: document.getElementById("equityClose"),
  bondClose: document.getElementById("bondClose"),
  dcaTable: document.getElementById("dcaTable"),
  lumpTable: document.getElementById("lumpTable"),
  tradeTable: document.getElementById("tradeTable"),
  signalChart: document.getElementById("signalChart"),
  portfolioChart: document.getElementById("portfolioChart"),
};

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(digits)}%`;
}

function num(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function byDate(rows) {
  return new Map(rows.map((row) => [row.date, row]));
}

function selectedEtf() {
  const code = els.etfSelect?.value || DATA.equities?.[0]?.code || "513100";
  return (
    (DATA.equities || []).find((item) => item.code === code) || {
      code: "513100",
      name: "国泰纳指ETF",
      liveStart: DATA.equity?.[0]?.date,
      liveEnd: DATA.equity?.at(-1)?.date,
      rows: DATA.equity,
    }
  );
}

function latestOnOrBefore(rows, date) {
  let best = null;
  for (const row of rows) {
    if (row.date <= date) best = row;
    else break;
  }
  return best;
}

function getParams() {
  return {
    maLength: clamp(Number(els.maLength.value), 20, 500),
    confirmDays: clamp(Number(els.confirmDays.value), 1, 80),
    bufferPct: clamp(Number(els.bufferPct.value), 0, 20),
    highWeight: clamp(Number(els.highWeightPct.value) / 100, 0, 1),
    lowWeight: clamp(Number(els.lowWeightPct.value) / 100, 0, 1),
    monthlyContribution: Math.max(
      0.01,
      Number(els.monthlyContribution.value) || 1,
    ),
    startDate: els.startDate.value,
    endDate: els.endDate.value,
  };
}

function applyPreset(name) {
  const defaults = DATA.defaults;
  els.maLength.value = defaults.maLength;
  els.confirmDays.value = defaults.confirmDays;
  els.bufferPct.value = defaults.bufferPct;
  els.lowWeightPct.value = defaults.lowWeightPct;
  els.monthlyContribution.value = defaults.monthlyContribution;
  if (name === "aggressive") els.highWeightPct.value = 70;
  else if (name === "balanced") els.highWeightPct.value = 60;
  updateBufferLabel();
}

function updateBufferLabel() {
  els.bufferValue.textContent = `${Number(els.bufferPct.value).toFixed(1)}%`;
}

function makeNdxCnyRows(ndxRows, fxRows) {
  let fxIndex = 0;
  let lastFx = NaN;
  const rows = [];
  for (const ndx of ndxRows) {
    while (fxIndex < fxRows.length && fxRows[fxIndex].date <= ndx.date) {
      lastFx = fxRows[fxIndex].fx;
      fxIndex++;
    }
    if (!Number.isFinite(lastFx)) continue;
    rows.push({
      date: ndx.date,
      close: ndx.close * lastFx,
      ndxClose: ndx.close,
      fx: lastFx,
    });
  }
  return rows;
}

function sma(rows, index, length) {
  if (index < length - 1) return NaN;
  let sum = 0;
  for (let i = index - length + 1; i <= index; i++) sum += rows[i].close;
  return sum / length;
}

function computeSignal(signalRows, params) {
  const buffer = params.bufferPct / 100;
  let state = params.lowWeight;
  let up = 0;
  let down = 0;
  const points = [];
  const trades = [];
  for (let i = 0; i < signalRows.length; i++) {
    const row = signalRows[i];
    const ma = sma(signalRows, i, params.maLength);
    const upper = Number.isFinite(ma) ? ma * (1 + buffer) : NaN;
    const lower = Number.isFinite(ma) ? ma * (1 - buffer) : NaN;
    let zone = "inside";
    if (Number.isFinite(ma) && row.close > upper) {
      up++;
      down = 0;
      zone = "above";
    } else if (Number.isFinite(ma) && row.close < lower) {
      down++;
      up = 0;
      zone = "below";
    } else {
      up = 0;
      down = 0;
    }
    let nextState = state;
    let reason = "";
    if (up >= params.confirmDays && state !== params.highWeight) {
      nextState = params.highWeight;
      reason = `高于 MA${params.maLength} 上沿连续 ${params.confirmDays} 日`;
    } else if (down >= params.confirmDays && state !== params.lowWeight) {
      nextState = params.lowWeight;
      reason = `低于 MA${params.maLength} 下沿连续 ${params.confirmDays} 日`;
    }
    if (nextState !== state) {
      trades.push({
        confirmDate: row.date,
        from: state,
        to: nextState,
        price: row.close,
        ma,
        reason,
      });
      state = nextState;
    }
    points.push({ ...row, ma, upper, lower, zone, up, down, state });
  }
  return { points, trades };
}

function commonBacktestDates(equityRows, bondRows, startDate, endDate) {
  const eMap = byDate(equityRows);
  const bMap = byDate(bondRows);
  return [...eMap.keys()]
    .filter(
      (date) =>
        bMap.has(date) &&
        (!startDate || date >= startDate) &&
        (!endDate || date <= endDate),
    )
    .sort();
}

function stateAt(points, date, fallback) {
  let lo = 0;
  let hi = points.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].date <= date) {
      best = points[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best ? best.state : fallback;
}

function executionEvents(trades, dates) {
  const events = [];
  let pointer = 0;
  for (const trade of trades) {
    while (pointer < dates.length && dates[pointer] <= trade.confirmDate)
      pointer++;
    if (pointer < dates.length)
      events.push({ ...trade, executeDate: dates[pointer] });
  }
  return events;
}

function xirr(cashflows) {
  function npv(rate) {
    const t0 = new Date(cashflows[0].date).getTime();
    return cashflows.reduce((sum, cf) => {
      const years = (new Date(cf.date).getTime() - t0) / (365.25 * 864e5);
      return sum + cf.amount / Math.pow(1 + rate, years);
    }, 0);
  }
  let lo = -0.999;
  let hi = 10;
  for (let i = 0; i < 180; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function simulateDca({
  name,
  equityRows,
  bondRows,
  signalPoints,
  trades,
  constantWeight,
  params,
}) {
  const eMap = byDate(equityRows);
  const bMap = byDate(bondRows);
  const dates = commonBacktestDates(
    equityRows,
    bondRows,
    params.startDate,
    params.endDate,
  );
  const events = constantWeight == null ? executionEvents(trades, dates) : [];
  let eventIndex = 0;
  let target =
    constantWeight ?? stateAt(signalPoints, dates[0], params.lowWeight);
  let stock = 0;
  let bond = 0;
  let invested = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let maxLossOnCapital = 0;
  let lastMonth = "";
  let prevEq = null;
  let prevBond = null;
  const cashflows = [];
  const curve = [];

  for (const date of dates) {
    const eq = eMap.get(date).close;
    const bd = bMap.get(date).close;
    if (prevEq != null) {
      stock *= eq / prevEq;
      bond *= bd / prevBond;
    }

    while (
      eventIndex < events.length &&
      events[eventIndex].executeDate <= date
    ) {
      target = events[eventIndex].to;
      const total = stock + bond;
      if (total > 0) {
        stock = total * target;
        bond = total * (1 - target);
      }
      eventIndex++;
    }

    const month = date.slice(0, 7);
    if (month !== lastMonth) {
      stock += params.monthlyContribution * target;
      bond += params.monthlyContribution * (1 - target);
      invested += params.monthlyContribution;
      cashflows.push({ date, amount: -params.monthlyContribution });
      lastMonth = month;
      const total = stock + bond;
      stock = total * target;
      bond = total * (1 - target);
    }

    const total = stock + bond;
    if (total > peak) peak = total;
    const drawdown = peak > 0 ? total / peak - 1 : 0;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    const lossOnCapital = invested > 0 ? total / invested - 1 : 0;
    if (lossOnCapital < maxLossOnCapital) maxLossOnCapital = lossOnCapital;
    curve.push({
      date,
      total,
      invested,
      valueRatio: invested > 0 ? total / invested : 1,
      target,
    });
    prevEq = eq;
    prevBond = bd;
  }

  const final = curve.at(-1)?.total ?? 0;
  cashflows.push({ date: dates.at(-1), amount: final });
  return {
    name,
    start: dates[0],
    end: dates.at(-1),
    months: cashflows.length - 1,
    invested,
    final,
    xirr: xirr(cashflows),
    maxDrawdown,
    maxLossOnCapital,
    multiple: invested > 0 ? final / invested : 0,
    curve,
    switches: events.filter(
      (event) =>
        event.executeDate >= dates[0] && event.executeDate <= dates.at(-1),
    ).length,
  };
}

function simulateLump({
  name,
  equityRows,
  bondRows,
  signalPoints,
  trades,
  constantWeight,
  params,
}) {
  const eMap = byDate(equityRows);
  const bMap = byDate(bondRows);
  const dates = commonBacktestDates(
    equityRows,
    bondRows,
    params.startDate,
    params.endDate,
  );
  const events = constantWeight == null ? executionEvents(trades, dates) : [];
  let eventIndex = 0;
  let target =
    constantWeight ?? stateAt(signalPoints, dates[0], params.lowWeight);
  let stock = target;
  let bond = 1 - target;
  let peak = 1;
  let maxDrawdown = 0;
  let prevEq = eMap.get(dates[0]).close;
  let prevBond = bMap.get(dates[0]).close;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  let lastMonth = dates[0].slice(0, 7);
  const curve = [{ date: dates[0], total: 1, target }];

  for (const date of dates.slice(1)) {
    const eq = eMap.get(date).close;
    const bd = bMap.get(date).close;
    const before = stock + bond;
    stock *= eq / prevEq;
    bond *= bd / prevBond;
    let total = stock + bond;
    const dailyReturn = total / before - 1;
    sum += dailyReturn;
    sumSq += dailyReturn * dailyReturn;
    n++;

    while (
      eventIndex < events.length &&
      events[eventIndex].executeDate <= date
    ) {
      target = events[eventIndex].to;
      total = stock + bond;
      stock = total * target;
      bond = total * (1 - target);
      eventIndex++;
    }

    const month = date.slice(0, 7);
    if (month !== lastMonth) {
      total = stock + bond;
      stock = total * target;
      bond = total * (1 - target);
      lastMonth = month;
    }

    total = stock + bond;
    if (total > peak) peak = total;
    const dd = total / peak - 1;
    if (dd < maxDrawdown) maxDrawdown = dd;
    curve.push({ date, total, target });
    prevEq = eq;
    prevBond = bd;
  }

  const years = n / 252;
  const final = curve.at(-1).total;
  const annualized = Math.pow(final, 1 / years) - 1;
  const mean = sum / Math.max(1, n);
  const variance = Math.max(0, (sumSq - n * mean * mean) / Math.max(1, n - 1));
  const volatility = Math.sqrt(variance * 252);
  return {
    name,
    start: dates[0],
    end: dates.at(-1),
    final,
    annualized,
    volatility,
    sharpe: volatility > 0 ? (annualized - 0.02) / volatility : 0,
    maxDrawdown,
    curve,
    switches: events.filter(
      (event) =>
        event.executeDate >= dates[0] && event.executeDate <= dates.at(-1),
    ).length,
  };
}

function htmlTable(el, headers, rows) {
  el.innerHTML = [
    `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`,
    `<tbody>${rows.map((row) => `<tr>${row.map((cell, i) => `<td${i > 0 && String(cell).startsWith("-") ? ' class="negative"' : ""}>${cell}</td>`).join("")}</tr>`).join("")}</tbody>`,
  ].join("");
}

function drawLineChart(canvas, series, options = {}) {
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(
    1,
    Math.round(rect.width || canvas.clientWidth || 800),
  );
  const height = Math.max(1, Math.round(rect.height || 340));
  canvas.style.width = "100%";
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const pad = { left: 52, right: 22, top: 18, bottom: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const all = series
    .flatMap((s) =>
      s.data.map((p) => (options.log ? Math.log(p.value) : p.value)),
    )
    .filter(Number.isFinite);
  if (!all.length) return;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const dates = series[0].data.map((p) => p.date);
  const xOf = (index) =>
    pad.left + (dates.length <= 1 ? 0 : (index / (dates.length - 1)) * plotW);
  const yOf = (value) =>
    pad.top +
    (1 - ((options.log ? Math.log(value) : value) - min) / span) * plotH;

  ctx.strokeStyle = "#d9e0e5";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * plotH;
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
  }
  ctx.stroke();

  for (const item of series) {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.width || 2;
    ctx.setLineDash(item.dash || []);
    ctx.beginPath();
    item.data.forEach((point, index) => {
      if (!Number.isFinite(point.value) || point.value <= 0) return;
      const x = xOf(index);
      const y = yOf(point.value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.fillStyle = "#667380";
  ctx.font = "12px Microsoft YaHei, Arial";
  ctx.fillText(dates[0] || "", pad.left, height - 8);
  const end = dates.at(-1) || "";
  ctx.fillText(end, width - pad.right - ctx.measureText(end).width, height - 8);
  const topLabel = options.log ? Math.exp(max) : max;
  const bottomLabel = options.log ? Math.exp(min) : min;
  ctx.fillText(num(topLabel, options.digits ?? 2), 8, pad.top + 4);
  ctx.fillText(num(bottomLabel, options.digits ?? 2), 8, pad.top + plotH);

  if (options.legend) {
    let x = pad.left;
    for (const item of series) {
      ctx.fillStyle = item.color;
      ctx.fillRect(x, pad.top - 12, 16, 3);
      ctx.fillStyle = "#667380";
      ctx.fillText(item.name, x + 22, pad.top - 7);
      x += ctx.measureText(item.name).width + 48;
    }
  }
}

function downsample(rows, max = 900) {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  const out = [];
  const valueOf = (row) => {
    if (Number.isFinite(row.close)) return row.close;
    if (Number.isFinite(row.total)) return row.total;
    if (Number.isFinite(row.valueRatio)) return row.valueRatio;
    if (Number.isFinite(row.value)) return row.value;
    return NaN;
  };
  for (let i = 0; i < rows.length; i += step) {
    const chunk = rows.slice(i, i + step);
    const keep = new Map();
    keep.set(i, rows[i]);
    let minIndex = i;
    let maxIndex = i;
    for (let j = 0; j < chunk.length; j++) {
      const index = i + j;
      const value = valueOf(rows[index]);
      if (!Number.isFinite(value)) continue;
      if (value < valueOf(rows[minIndex])) minIndex = index;
      if (value > valueOf(rows[maxIndex])) maxIndex = index;
    }
    keep.set(minIndex, rows[minIndex]);
    keep.set(maxIndex, rows[maxIndex]);
    if (i + chunk.length - 1 < rows.length)
      keep.set(i + chunk.length - 1, rows[i + chunk.length - 1]);
    out.push(
      ...[...keep.entries()]
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]),
    );
  }
  if (out.at(-1)?.date !== rows.at(-1).date) out.push(rows.at(-1));
  return out.filter(
    (row, index, arr) => index === 0 || row.date !== arr[index - 1].date,
  );
}

function latestCommonDate(rows) {
  return rows.at(-1)?.date || "--";
}

function calculate() {
  const params = getParams();
  const etf = selectedEtf();
  const equityRows = etf.rows;
  const signalRows = equityRows;
  const signal = computeSignal(signalRows, params);
  const dates = commonBacktestDates(
    equityRows,
    DATA.bond,
    params.startDate,
    params.endDate,
  );
  const events = executionEvents(signal.trades, dates);
  const latest = signal.points.at(-1);
  const latestEquity = equityRows.at(-1);
  const latestBond = DATA.bond.at(-1);
  const latestNdx = latestOnOrBefore(DATA.ndx, latest.date);
  const latestFx = latestOnOrBefore(DATA.fx, latest.date);
  const currentTarget = latest.state;
  const activeRun =
    latest.zone === "above"
      ? latest.up
      : latest.zone === "below"
        ? latest.down
        : 0;
  const remaining =
    latest.zone === "inside"
      ? null
      : Math.max(0, params.confirmDays - activeRun);
  const modeText =
    currentTarget === params.highWeight
      ? "高仓持有"
      : currentTarget === params.lowWeight
        ? "清仓防守"
        : "中间仓位";

  const failedRefresh = (DATA.refreshResults || []).filter((item) => !item.ok);
  const refreshNote = failedRefresh.length
    ? `；上次刷新部分失败：${failedRefresh.map((item) => item.name).join("、")}`
    : "";
  els.dataStamp.textContent = `数据生成：${new Date(DATA.generatedAt).toLocaleString("zh-CN")}；当前标的：${etf.name} ${etf.code}；信号至 ${latest.date}，场内ETF ${etf.liveStart} 至 ${etf.liveEnd}${refreshNote}`;
  els.signalBadge.className = `signal-badge ${currentTarget === params.highWeight ? "high" : currentTarget === params.lowWeight ? "low" : "neutral"}`;
  els.signalBadge.textContent = modeText;
  els.signalDate.textContent = latest.date;
  els.signalPrice.textContent = num(latest.close, 2);
  const maDeviation = Number.isFinite(latest.ma)
    ? latest.close / latest.ma - 1
    : NaN;
  els.maDeviation.textContent = pct(maDeviation, 2);
  els.maDeviation.className = maDeviation >= 0 ? "positive" : "negative";
  els.bandText.textContent = `${num(latest.ma, 2)} / ${num(latest.lower, 2)} - ${num(latest.upper, 2)}`;
  els.confirmText.textContent =
    latest.zone === "above"
      ? `上沿外 ${latest.up} 日`
      : latest.zone === "below"
        ? `下沿外 ${latest.down} 日`
        : "缓冲带内";
  els.actionText.textContent =
    currentTarget === params.highWeight ? "维持高仓" : "维持低仓";
  els.targetEquity.textContent = pct(currentTarget, 0);
  els.targetBond.textContent = pct(1 - currentTarget, 0);
  els.nextActionText.textContent =
    remaining == null
      ? "价格仍在缓冲带内，当前没有倒计时信号。"
      : remaining === 0
        ? "信号已经确认，按下一 A 股交易日执行目标仓位。"
        : `若继续停留在当前带外区域，还需要 ${remaining} 个交易日确认。`;
  els.ndxClose.textContent = latestNdx ? num(latestNdx.close, 2) : "--";
  els.fxClose.textContent = latestFx ? num(latestFx.fx, 4) : "--";
  els.equityClose.textContent = `${etf.code} ${latestEquity.date} / ${num(latestEquity.close, 3)}`;
  els.bondClose.textContent = `${latestBond.date} / ${num(latestBond.close, 4)}`;

  const strategyDca = simulateDca({
    name: "策略",
    equityRows,
    bondRows: DATA.bond,
    signalPoints: signal.points,
    trades: signal.trades,
    params,
  });
  const staticDca = simulateDca({
    name: `固定${pct(params.highWeight, 0)}`,
    equityRows,
    bondRows: DATA.bond,
    signalPoints: signal.points,
    trades: [],
    constantWeight: params.highWeight,
    params,
  });
  const equityDca = simulateDca({
    name: `${etf.code} 100%`,
    equityRows,
    bondRows: DATA.bond,
    signalPoints: signal.points,
    trades: [],
    constantWeight: 1,
    params,
  });
  const bondDca = simulateDca({
    name: "债券100%",
    equityRows,
    bondRows: DATA.bond,
    signalPoints: signal.points,
    trades: [],
    constantWeight: 0,
    params,
  });
  const dcaRows = [strategyDca, staticDca, equityDca, bondDca];
  htmlTable(
    els.dcaTable,
    ["策略", "XIRR", "最大回撤", "本金最大浮亏", "期末/本金", "调仓"],
    dcaRows.map((row) => [
      row.name,
      pct(row.xirr, 2),
      pct(row.maxDrawdown, 1),
      pct(row.maxLossOnCapital, 1),
      `${row.multiple.toFixed(2)}x`,
      row.switches,
    ]),
  );

  const strategyLump = simulateLump({
    name: "策略",
    equityRows,
    bondRows: DATA.bond,
    signalPoints: signal.points,
    trades: signal.trades,
    params,
  });
  const staticLump = simulateLump({
    name: `固定${pct(params.highWeight, 0)}`,
    equityRows,
    bondRows: DATA.bond,
    signalPoints: signal.points,
    trades: [],
    constantWeight: params.highWeight,
    params,
  });
  const equityLump = simulateLump({
    name: `${etf.code} 100%`,
    equityRows,
    bondRows: DATA.bond,
    signalPoints: signal.points,
    trades: [],
    constantWeight: 1,
    params,
  });
  const bondLump = simulateLump({
    name: "债券100%",
    equityRows,
    bondRows: DATA.bond,
    signalPoints: signal.points,
    trades: [],
    constantWeight: 0,
    params,
  });
  htmlTable(
    els.lumpTable,
    ["策略", "年化", "波动", "夏普", "最大回撤", "期末"],
    [strategyLump, staticLump, equityLump, bondLump].map((row) => [
      row.name,
      pct(row.annualized, 2),
      pct(row.volatility, 2),
      row.sharpe.toFixed(2),
      pct(row.maxDrawdown, 1),
      `${row.final.toFixed(2)}x`,
    ]),
  );

  htmlTable(
    els.tradeTable,
    ["确认日", "执行日", "动作", "原因"],
    events.map((event) => [
      event.confirmDate,
      event.executeDate,
      `${pct(event.from, 0)} → ${pct(event.to, 0)}`,
      event.reason,
    ]),
  );

  const chartPoints = downsample(
    signal.points.filter(
      (p) =>
        (!params.startDate || p.date >= params.startDate) &&
        (!params.endDate || p.date <= params.endDate),
    ),
  );
  drawLineChart(
    els.signalChart,
    [
      {
        name: `${etf.code} 拼接收盘价`,
        color: "#146c94",
        data: chartPoints.map((p) => ({ date: p.date, value: p.close })),
      },
      {
        name: "MA",
        color: "#202a33",
        width: 1.5,
        data: chartPoints.map((p) => ({ date: p.date, value: p.ma })),
      },
      {
        name: "上沿",
        color: "#b54708",
        width: 1,
        dash: [5, 5],
        data: chartPoints.map((p) => ({ date: p.date, value: p.upper })),
      },
      {
        name: "下沿",
        color: "#147a4d",
        width: 1,
        dash: [5, 5],
        data: chartPoints.map((p) => ({ date: p.date, value: p.lower })),
      },
    ],
    { log: false, legend: true, digits: 3 },
  );

  const curve = downsample(strategyDca.curve);
  const staticCurve = new Map(staticDca.curve.map((p) => [p.date, p]));
  drawLineChart(
    els.portfolioChart,
    [
      {
        name: "累计本金",
        color: "#667380",
        width: 1.5,
        dash: [6, 5],
        data: curve.map((p) => ({ date: p.date, value: p.invested })),
      },
      {
        name: "策略资产",
        color: "#146c94",
        data: curve.map((p) => ({ date: p.date, value: p.total })),
      },
      {
        name: `固定${pct(params.highWeight, 0)}资产`,
        color: "#b54708",
        data: curve.map((p) => ({
          date: p.date,
          value: staticCurve.get(p.date)?.total ?? NaN,
        })),
      },
    ],
    { log: false, legend: true, digits: 0 },
  );
}

async function refreshData() {
  els.refreshStatus.textContent = "正在绕过缓存，拉取最新已发布快照...";
  els.refreshDataBtn.disabled = true;
  try {
    const res = await fetch(`strategy_data.js?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const source = await res.text();
    const prefix = "window.STRATEGY_DATA = ";
    const start = source.indexOf(prefix);
    if (start < 0) throw new Error("快照格式不正确");
    DATA = JSON.parse(
      source
        .slice(start + prefix.length)
        .trim()
        .replace(/;$/u, ""),
    );
    const selectedCode = els.etfSelect?.value;
    if (els.etfSelect && DATA.equities?.length) {
      els.etfSelect.innerHTML = DATA.equities
        .map(
          (item) =>
            `<option value="${item.code}">${item.name} ${item.code}</option>`,
        )
        .join("");
      if (DATA.equities.some((item) => item.code === selectedCode))
        els.etfSelect.value = selectedCode;
    }
    calculate();
    els.refreshStatus.textContent = `已读取最新发布快照：${new Date(DATA.generatedAt).toLocaleString("zh-CN")}。`;
  } catch (error) {
    els.refreshStatus.textContent = `刷新失败：${error.message}。当前结果保持不变，可稍后重试。`;
  } finally {
    els.refreshDataBtn.disabled = false;
  }
}

function init() {
  if (els.etfSelect && DATA.equities?.length) {
    els.etfSelect.innerHTML = DATA.equities
      .map(
        (item) =>
          `<option value="${item.code}">${item.name} ${item.code}</option>`,
      )
      .join("");
  }
  const etf = selectedEtf();
  const equityRows = etf.rows;
  const firstLive =
    equityRows[0].date > DATA.bond[0].date
      ? equityRows[0].date
      : DATA.bond[0].date;
  els.startDate.value = firstLive;
  els.endDate.value =
    equityRows.at(-1).date < DATA.bond.at(-1).date
      ? equityRows.at(-1).date
      : DATA.bond.at(-1).date;
  applyPreset("balanced");
  calculate();
  els.bufferPct.addEventListener("input", () => {
    updateBufferLabel();
    els.preset.value = "custom";
  });
  for (const el of [
    els.maLength,
    els.confirmDays,
    els.highWeightPct,
    els.lowWeightPct,
    els.monthlyContribution,
    els.startDate,
    els.endDate,
  ]) {
    el.addEventListener("input", () => {
      els.preset.value = "custom";
    });
  }
  els.etfSelect?.addEventListener("change", () => {
    const current = selectedEtf();
    const rows = current.rows;
    els.endDate.value =
      rows.at(-1).date < DATA.bond.at(-1).date
        ? rows.at(-1).date
        : DATA.bond.at(-1).date;
    calculate();
  });
  els.preset.addEventListener("change", () => {
    if (els.preset.value !== "custom") {
      applyPreset(els.preset.value);
      calculate();
    }
  });
  els.runBtn.addEventListener("click", calculate);
  els.resetBtn.addEventListener("click", () => {
    els.preset.value = "balanced";
    applyPreset("balanced");
    calculate();
  });
  els.refreshDataBtn.addEventListener("click", refreshData);
  window.addEventListener("resize", calculate);
}

init();
