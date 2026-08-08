const byId = (id) => document.getElementById(id);

const state = {
  rawData: null,
  data: null,
  range: "1y",
  group: "all",
  selected: new Set(),
  search: "",
  chart: null,
  sortKey: "latest",
  sortDirection: "desc",
  initializedSelection: false,
  toastTimer: null,
};

const rangeDays = { "1m": 31, "3m": 93, "6m": 186, "1y": 366, "3y": 1096 };
const palettes = {
  nasdaq100: [
    "#4d61a8",
    "#ec684f",
    "#16887e",
    "#b88732",
    "#875c9c",
    "#377d9b",
    "#c04f70",
    "#6b8139",
    "#805d45",
    "#526d82",
    "#aa6f25",
    "#6e5ac7",
  ],
  sp500: ["#d34f42", "#27877e", "#496a9f", "#b17a2d", "#76569a", "#417f9c"],
};

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values) {
  const clean = values.filter(finite).sort((left, right) => left - right);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2
    ? clean[middle]
    : (clean[middle - 1] + clean[middle]) / 2;
}

function signClass(value) {
  if (!finite(value) || Math.abs(value) < 0.005) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function formatPremium(value, digits = 2) {
  if (!finite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatNumber(value, digits = 3) {
  return finite(value) ? value.toFixed(digits) : "—";
}

function formatTurnover(value) {
  if (!finite(value)) return "—";
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(0)} 万`;
  return Math.round(value).toLocaleString("zh-CN");
}

function formatDateTime(value) {
  return value ? String(value).replace("T", " ").replace("+08:00", "") : "—";
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setLoading(loading, message = "正在读取每日快照") {
  const indicator = byId("update-indicator");
  indicator.classList.toggle("running", loading);
  indicator.classList.toggle("ready", !loading && Boolean(state.data));
  indicator.classList.remove("error");
  indicator.querySelector("span").textContent = loading
    ? message
    : "静态快照已就绪";
  byId("refresh-button").disabled = loading;
  byId("refresh-button").classList.toggle("is-spinning", loading);
  const progress = byId("global-progress");
  progress.style.width = loading ? "24%" : "100%";
  progress.style.opacity = loading ? "1" : "0";
}

function setError(message) {
  const indicator = byId("update-indicator");
  indicator.classList.remove("running", "ready");
  indicator.classList.add("error");
  indicator.querySelector("span").textContent = "快照读取失败";
  byId("chart-loading").classList.add("hidden");
  byId("chart-empty").textContent = message;
  byId("chart-empty").classList.remove("hidden");
  byId("refresh-button").disabled = false;
}

function sliceDataset(payload, selectedRange) {
  if (selectedRange === "all") return { ...payload, range: selectedRange };
  const endDates = payload.funds
    .map((fund) => fund.stats?.end_date)
    .filter(Boolean)
    .sort();
  if (!endDates.length) return { ...payload, range: selectedRange };
  const latest = new Date(`${endDates.at(-1)}T00:00:00Z`);
  latest.setUTCDate(latest.getUTCDate() - rangeDays[selectedRange]);
  const cutoff = latest.toISOString().slice(0, 10);
  return {
    ...payload,
    range: selectedRange,
    range_start: cutoff,
    funds: payload.funds.map((fund) => ({
      ...fund,
      series: (fund.series || []).filter((point) => point.date >= cutoff),
    })),
  };
}

function fundColor(fund) {
  const groupMembers = (state.rawData?.funds || [])
    .filter((item) => item.group === fund.group)
    .sort((left, right) => left.code.localeCompare(right.code));
  const index = Math.max(
    0,
    groupMembers.findIndex((item) => item.code === fund.code),
  );
  const palette = palettes[fund.group] || palettes.nasdaq100;
  return palette[index % palette.length];
}

function groupFunds({ includeSearch = false } = {}) {
  let funds = state.data?.funds || [];
  if (state.group !== "all") {
    funds = funds.filter((fund) => fund.group === state.group);
  }
  if (includeSearch && state.search) {
    const query = state.search.toLowerCase();
    funds = funds.filter(
      (fund) =>
        fund.code.toLowerCase().includes(query) ||
        fund.name.toLowerCase().includes(query),
    );
  }
  return funds;
}

function renderMetrics() {
  const funds = groupFunds();
  const live = funds.map((fund) => fund.live_premium).filter(finite);
  const percentiles = funds
    .map((fund) => fund.stats?.percentile252)
    .filter(finite);
  const highest = funds
    .filter((fund) => finite(fund.live_premium))
    .sort((left, right) => right.live_premium - left.live_premium)[0];
  const quoteDates = funds
    .map((fund) => fund.quote_date)
    .filter(Boolean)
    .sort();
  const liveMedian = median(live);

  byId("metric-count").textContent = String(funds.length || "—");
  byId("metric-median").textContent = formatPremium(liveMedian);
  byId("metric-median").className = signClass(liveMedian);
  byId("metric-high").textContent = highest
    ? formatPremium(highest.live_premium)
    : "—";
  byId("metric-high").className = highest
    ? signClass(highest.live_premium)
    : "neutral";
  byId("metric-high-name").textContent = highest
    ? `${highest.code} ${highest.name}`
    : "IOPV 暂无数据";
  const percentile = median(percentiles);
  byId("metric-percentile").textContent = finite(percentile)
    ? `${percentile.toFixed(0)}%`
    : "—";
  byId("quote-date").textContent = quoteDates.length
    ? `${quoteDates.at(-1)} 行情`
    : "行情日期未知";
  byId("generated-at").textContent = `生成于 ${formatDateTime(
    state.rawData?.generated_at,
  )}`;
}

function renderWarnings() {
  const warnings = state.rawData?.warnings || [];
  const panel = byId("warning-panel");
  panel.classList.toggle("hidden", !warnings.length);
  byId("warning-list").innerHTML = warnings
    .slice(-8)
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");
}

function renderFundList() {
  const funds = groupFunds({ includeSearch: true });
  const visibleFunds = groupFunds();
  const sections = [];
  const groups = state.group === "all" ? ["nasdaq100", "sp500"] : [state.group];

  for (const group of groups) {
    const members = funds.filter((fund) => fund.group === group);
    if (!members.length) continue;
    const label = state.data.groups?.[group]?.label || group;
    sections.push(
      `<div class="fund-group-label">${escapeHtml(label)} · ${members.length}</div>`,
    );
    for (const fund of members) {
      const selected = state.selected.has(fund.code);
      const displayed = finite(fund.live_premium)
        ? fund.live_premium
        : fund.stats?.latest;
      sections.push(`
        <button class="fund-option ${selected ? "" : "muted"}" type="button"
          data-code="${fund.code}" aria-pressed="${selected}"
          style="--swatch:${fundColor(fund)}">
          <span class="fund-swatch" aria-hidden="true"></span>
          <span class="fund-main">
            <span class="fund-name">${escapeHtml(fund.name)}</span>
            <span class="fund-code">${fund.market} · ${fund.code}</span>
          </span>
          <span class="fund-premium ${signClass(displayed)}">${formatPremium(
            displayed,
          )}</span>
        </button>`);
    }
  }
  if (!sections.length) {
    sections.push('<div class="table-empty">没有匹配的 ETF</div>');
  }
  byId("fund-list").innerHTML = sections.join("");
  byId("fund-list")
    .querySelectorAll(".fund-option")
    .forEach((button) => {
      button.addEventListener("click", () => toggleFund(button.dataset.code));
    });
  const selectedCount = visibleFunds.filter((fund) =>
    state.selected.has(fund.code),
  ).length;
  byId("visible-count").textContent =
    `${selectedCount} / ${visibleFunds.length}`;
  byId("selected-summary").textContent = `已选 ${selectedCount} 只`;
}

function toggleFund(code) {
  if (state.selected.has(code)) state.selected.delete(code);
  else state.selected.add(code);
  renderFundList();
  renderChart();
}

function medianSeries(funds) {
  const buckets = new Map();
  for (const fund of funds) {
    for (const point of fund.series || []) {
      if (!buckets.has(point.date)) buckets.set(point.date, []);
      buckets.get(point.date).push(point.premium);
    }
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, values]) => ({ date: day, y: median(values) }));
}

function chartPoint(point) {
  return {
    x: Date.parse(`${point.date}T00:00:00Z`),
    date: point.date,
    y: point.premium,
    close: point.close,
    nav: point.nav,
  };
}

function renderChart() {
  byId("chart-loading").classList.add("hidden");
  const selectedFunds = groupFunds().filter((fund) =>
    state.selected.has(fund.code),
  );
  const empty = byId("chart-empty");
  if (!selectedFunds.length) {
    empty.textContent = "请选择至少一只 ETF";
    empty.classList.remove("hidden");
    state.chart?.destroy();
    state.chart = null;
    return;
  }
  if (typeof Chart === "undefined") {
    empty.textContent = "本地图表组件加载失败，请刷新页面";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  state.chart?.destroy();

  const datasets = selectedFunds.map((fund) => ({
    label: `${fund.code} ${fund.name}`,
    data: (fund.series || []).map(chartPoint),
    borderColor: fundColor(fund),
    backgroundColor: fundColor(fund),
    borderWidth: 1.45,
    pointRadius: 0,
    pointHoverRadius: 3,
    pointHitRadius: 8,
    tension: 0.08,
    spanGaps: true,
    order: 20,
  }));
  const medians = medianSeries(selectedFunds);
  datasets.push(
    {
      label: "选中 ETF 中位数",
      data: medians.map((point) => ({
        x: Date.parse(`${point.date}T00:00:00Z`),
        date: point.date,
        y: point.y,
      })),
      borderColor: "#13232d",
      backgroundColor: "#13232d",
      borderWidth: 3,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.12,
      spanGaps: true,
      order: 1,
    },
    {
      label: "零溢价",
      data: medians.map((point) => ({
        x: Date.parse(`${point.date}T00:00:00Z`),
        date: point.date,
        y: 0,
      })),
      borderColor: "rgb(75 91 99 / 55%)",
      borderWidth: 1,
      borderDash: [6, 6],
      pointRadius: 0,
      pointHitRadius: 0,
      order: 100,
    },
  );

  state.chart = new Chart(byId("premium-chart"), {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 220 },
      normalized: true,
      parsing: false,
      interaction: { mode: "nearest", intersect: false, axis: "xy" },
      layout: { padding: { top: 8, right: 8, bottom: 4, left: 4 } },
      scales: {
        x: {
          type: "linear",
          bounds: "data",
          grid: { display: false },
          border: { color: "#d7d2c7" },
          ticks: {
            color: "#7c878b",
            maxTicksLimit: window.innerWidth < 600 ? 5 : 9,
            maxRotation: 0,
            autoSkip: true,
            callback(value) {
              const day = new Date(Number(value));
              return Number.isNaN(day.getTime())
                ? ""
                : day.toISOString().slice(0, 7);
            },
            font: { size: 10 },
          },
        },
        y: {
          grid: { color: "rgb(75 91 99 / 10%)", drawTicks: false },
          border: { display: false },
          grace: "8%",
          ticks: {
            color: "#7c878b",
            padding: 8,
            callback: (value) => `${value}%`,
            font: { size: 10 },
          },
          title: {
            display: true,
            text: "溢价率",
            color: "#7c878b",
            font: { size: 10, weight: "normal" },
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: true,
          padding: 12,
          backgroundColor: "rgb(18 35 44 / 96%)",
          titleColor: "#f8f5ec",
          bodyColor: "#dbe4e6",
          borderColor: "rgb(255 255 255 / 12%)",
          borderWidth: 1,
          callbacks: {
            title(items) {
              return items[0]?.raw?.date || "";
            },
            label(context) {
              return ` ${context.dataset.label}  ${formatPremium(
                context.parsed.y,
              )}`;
            },
            afterLabel(context) {
              const raw = context.raw || {};
              if (!finite(raw.close) || !finite(raw.nav)) return "";
              return ` 收盘 ${formatNumber(raw.close)} · 净值 ${formatNumber(
                raw.nav,
                4,
              )}`;
            },
          },
        },
        decimation: { enabled: true, algorithm: "min-max", samples: 900 },
      },
    },
  });
}

function sortValue(fund, key) {
  if (key === "name") return `${fund.name}${fund.code}`;
  if (key === "live_premium") return fund.live_premium;
  if (key === "turnover") return fund.turnover;
  if (key === "end_date") return fund.stats?.end_date;
  return fund.stats?.[key];
}

function renderRanking() {
  const funds = [...groupFunds({ includeSearch: true })];
  funds.sort((left, right) => {
    const first = sortValue(left, state.sortKey);
    const second = sortValue(right, state.sortKey);
    const firstMissing = first === null || first === undefined || first === "";
    const secondMissing =
      second === null || second === undefined || second === "";
    if (firstMissing && secondMissing)
      return left.code.localeCompare(right.code);
    if (firstMissing) return 1;
    if (secondMissing) return -1;
    const comparison =
      typeof first === "string" ? first.localeCompare(second) : first - second;
    return state.sortDirection === "asc" ? comparison : -comparison;
  });
  if (!funds.length) {
    byId("ranking-body").innerHTML =
      '<tr><td colspan="8" class="table-empty">没有匹配的 ETF</td></tr>';
    return;
  }
  byId("ranking-body").innerHTML = funds
    .map((fund) => {
      const summary = fund.stats || {};
      const groupLabel = state.data.groups?.[fund.group]?.short || fund.group;
      return `<tr data-code="${fund.code}">
        <td><div class="table-fund" style="--swatch:${fundColor(fund)}">
          <i class="table-swatch"></i>
          <span><strong>${escapeHtml(fund.name)}</strong><small>${groupLabel} · ${
            fund.market
          } ${fund.code}</small></span>
        </div></td>
        <td class="number"><span class="premium-pill ${signClass(
          fund.live_premium,
        )}">${formatPremium(fund.live_premium)}</span>
          <small class="sub-value">IOPV ${formatNumber(fund.iopv, 4)}</small></td>
        <td class="number ${signClass(summary.latest)}">${formatPremium(
          summary.latest,
        )}<small class="sub-value">收 ${formatNumber(
          summary.latest_close,
        )} / 净 ${formatNumber(summary.latest_nav, 4)}</small></td>
        <td class="number ${signClass(summary.avg20)}">${formatPremium(
          summary.avg20,
        )}</td>
        <td class="number ${signClass(summary.avg60)}">${formatPremium(
          summary.avg60,
        )}</td>
        <td class="number">${
          finite(summary.percentile252)
            ? `${summary.percentile252.toFixed(0)}%`
            : "—"
        }</td>
        <td class="number">${formatTurnover(fund.turnover)}</td>
        <td class="number">${
          summary.end_date || "—"
        }<small class="sub-value">${summary.matched_days || 0} 个匹配日</small></td>
      </tr>`;
    })
    .join("");
  byId("ranking-body")
    .querySelectorAll("tr[data-code]")
    .forEach((row) => {
      row.addEventListener("click", () => toggleFund(row.dataset.code));
    });
}

function renderSortHeaders() {
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    const active = header.dataset.sort === state.sortKey;
    header.classList.toggle("active-sort", active);
    const marker = header.querySelector("span");
    if (marker) {
      marker.textContent = active
        ? state.sortDirection === "asc"
          ? "↑"
          : "↓"
        : "↕";
    }
  });
}

function renderAll() {
  renderMetrics();
  renderWarnings();
  renderFundList();
  renderRanking();
  renderSortHeaders();
  renderChart();
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportCsv() {
  if (!state.data) return;
  const rows = [
    [
      "指数组",
      "基金代码",
      "基金名称",
      "日期",
      "收盘价",
      "单位净值",
      "收盘溢价率(%)",
      "成交额(元)",
      "成交量",
    ],
  ];
  for (const fund of state.data.funds) {
    const groupLabel = state.data.groups?.[fund.group]?.label || fund.group;
    for (const point of fund.series || []) {
      rows.push([
        groupLabel,
        fund.code,
        fund.name,
        point.date,
        point.close,
        point.nav,
        point.premium,
        point.turnover,
        point.volume,
      ]);
    }
  }
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `etf-premium-${state.range}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadData({ announce = false } = {}) {
  setLoading(true, announce ? "正在重新载入快照" : "正在读取每日快照");
  try {
    const response = await fetch(`data/dashboard.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}`);
    const payload = await response.json();
    if (
      !payload.ready ||
      !Array.isArray(payload.funds) ||
      !payload.funds.length
    ) {
      throw new Error("数据文件尚未准备好");
    }
    state.rawData = payload;
    state.data = sliceDataset(payload, state.range);
    if (!state.initializedSelection) {
      payload.funds.forEach((fund) => state.selected.add(fund.code));
      state.initializedSelection = true;
    }
    renderAll();
    setLoading(false);
    if (announce) showToast("已载入最新发布快照");
  } catch (error) {
    setError(`数据加载失败：${error.message}`);
    showToast(`数据加载失败：${error.message}`);
  }
}

function applyRange(selectedRange) {
  if (!state.rawData) return;
  state.range = selectedRange;
  state.data = sliceDataset(state.rawData, selectedRange);
  renderAll();
}

function bindEvents() {
  byId("refresh-button").addEventListener("click", () =>
    loadData({ announce: true }),
  );
  byId("export-link").addEventListener("click", (event) => {
    event.preventDefault();
    exportCsv();
  });
  byId("fund-search").addEventListener("input", (event) => {
    state.search = event.target.value.trim();
    renderFundList();
    renderRanking();
  });
  byId("group-switch")
    .querySelectorAll("button")
    .forEach((button) => {
      button.addEventListener("click", () => {
        state.group = button.dataset.group;
        byId("group-switch")
          .querySelectorAll("button")
          .forEach((item) => item.classList.toggle("active", item === button));
        renderAll();
      });
    });
  byId("range-switch")
    .querySelectorAll("button")
    .forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.range === state.range) return;
        byId("range-switch")
          .querySelectorAll("button")
          .forEach((item) => item.classList.toggle("active", item === button));
        applyRange(button.dataset.range);
      });
    });
  byId("select-all").addEventListener("click", () => {
    groupFunds().forEach((fund) => state.selected.add(fund.code));
    renderFundList();
    renderChart();
  });
  byId("select-none").addEventListener("click", () => {
    groupFunds().forEach((fund) => state.selected.delete(fund.code));
    renderFundList();
    renderChart();
  });
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort;
      if (state.sortKey === key) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDirection =
          key === "name" || key === "end_date" ? "asc" : "desc";
      }
      renderRanking();
      renderSortHeaders();
    });
  });
  window.addEventListener("resize", () => state.chart?.resize());
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadData();
});
