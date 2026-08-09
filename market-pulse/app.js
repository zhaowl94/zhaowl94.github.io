const DATA_URL = "data/state.json";

const elements = {
  refresh: document.querySelector("#refreshSnapshot"),
  sessionDot: document.querySelector("#sessionDot"),
  sessionLabel: document.querySelector("#sessionLabel"),
  marketTimestamp: document.querySelector("#marketTimestamp"),
  generatedTimestamp: document.querySelector("#generatedTimestamp"),
  coverageCount: document.querySelector("#coverageCount"),
  loadStatus: document.querySelector("#load-status"),
  indexCards: document.querySelector("#indexCards"),
  rankingRows: document.querySelector("#rankingRows"),
  methodWeights: document.querySelector("#methodWeights"),
  modelUsed: document.querySelector("#modelUsed"),
  replacementLimit: document.querySelector("#replacementLimit"),
  scheduledInterval: document.querySelector("#scheduledInterval"),
  bulletinFeed: document.querySelector("#bulletinFeed"),
  sourceGrid: document.querySelector("#sourceGrid"),
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : dateFormatter.format(date);
}

function formatNumber(value) {
  return Number.isFinite(Number(value))
    ? numberFormatter.format(Number(value))
    : "--";
}

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined) return "--";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
}

function changeClass(value) {
  return Number(value) >= 0 ? "change-up" : "change-down";
}

function clear(element) {
  element.replaceChildren();
}

function appendText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function buildSparkline(values, isPositive) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 112 34");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("spark-svg");
  if (!isPositive) svg.classList.add("negative");
  const usable = (values || []).map(Number).filter(Number.isFinite);
  if (usable.length < 2) return svg;
  const low = Math.min(...usable);
  const high = Math.max(...usable);
  const spread = high - low || 1;
  const points = usable
    .map((value, index) => {
      const x = (index / (usable.length - 1)) * 110 + 1;
      const y = 32 - ((value - low) / spread) * 30;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const line = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polyline",
  );
  line.setAttribute("points", points);
  svg.append(line);
  return svg;
}

function renderSession(state) {
  const session = state.session || {};
  elements.sessionLabel.textContent = session.label || "快照状态未知";
  elements.sessionDot.classList.toggle("open", session.status === "open");
  elements.marketTimestamp.textContent = formatDate(session.market_timestamp);
  elements.generatedTimestamp.textContent = formatDate(state.generated_at);
  elements.coverageCount.textContent = `${state.candidate_count || 0} / ${state.universe_count || 0} 只`;
}

function renderIndices(indices) {
  clear(elements.indexCards);
  for (const item of indices || []) {
    const card = document.createElement("article");
    card.className = "index-card";
    card.dataset.symbol = item.symbol;
    const head = document.createElement("div");
    head.className = "index-card-head";
    appendText(head, "strong", "", item.name);
    appendText(head, "span", "", item.symbol);
    card.append(head);
    appendText(card, "p", "index-value", formatNumber(item.value));
    const move = document.createElement("div");
    move.className = "index-move";
    appendText(
      move,
      "strong",
      Number(item.change_pct) < 0 ? "negative" : "",
      formatPercent(item.change_pct),
    );
    appendText(
      move,
      "small",
      "",
      `5 分钟 ${formatPercent(item.five_minute_change_pct)}`,
    );
    card.append(move);
    elements.indexCards.append(card);
  }
}

function renderRanking(top10) {
  clear(elements.rankingRows);
  for (const item of top10 || []) {
    const row = document.createElement("tr");
    const stock = document.createElement("td");
    const stockCell = document.createElement("div");
    stockCell.className = "stock-cell";
    appendText(
      stockCell,
      "span",
      "stock-rank",
      String(item.rank).padStart(2, "0"),
    );
    const identity = document.createElement("span");
    appendText(
      identity,
      "strong",
      "stock-name",
      item.chinese_name || item.company_name || item.symbol,
    );
    appendText(
      identity,
      "small",
      "stock-symbol",
      `${item.symbol} · ${item.reason || "规则异动"}`,
    );
    stockCell.append(identity);
    stock.append(stockCell);
    row.append(stock);
    appendText(row, "td", "", formatNumber(item.price));
    appendText(
      row,
      "td",
      changeClass(item.change_pct),
      formatPercent(item.change_pct),
    );
    appendText(
      row,
      "td",
      changeClass(item.five_minute_change_pct),
      formatPercent(item.five_minute_change_pct),
    );
    appendText(row, "td", "", `${Number(item.index_weight || 0).toFixed(2)}%`);
    const score = document.createElement("td");
    appendText(score, "span", "score-pill", Number(item.score || 0).toFixed(3));
    row.append(score);
    const spark = document.createElement("td");
    spark.append(buildSparkline(item.sparkline, Number(item.change_pct) >= 0));
    row.append(spark);
    elements.rankingRows.append(row);
  }
}

function renderMethod(method) {
  const labels = {
    index_impact: "指数影响",
    price_movement: "价格异动",
    volume_pace: "成交节奏",
    intraday_range: "日内振幅",
  };
  clear(elements.methodWeights);
  for (const [key, value] of Object.entries(method.weights || {})) {
    const item = document.createElement("div");
    item.className = "weight-item";
    const head = document.createElement("div");
    head.className = "weight-item-head";
    appendText(head, "span", "", labels[key] || key);
    appendText(head, "strong", "", `${Math.round(Number(value) * 100)}%`);
    const track = document.createElement("div");
    track.className = "weight-track";
    const fill = document.createElement("span");
    fill.className = "weight-fill";
    fill.style.width = `${Math.min(100, Number(value) * 100)}%`;
    track.append(fill);
    item.append(head, track);
    elements.methodWeights.append(item);
  }
  elements.modelUsed.textContent =
    method.model_used === false ? "不使用" : "状态未知";
  elements.replacementLimit.textContent = `${method.replacement_limit || "--"} 只 / 次`;
  elements.scheduledInterval.textContent = `${method.scheduled_interval_minutes || "--"} 分钟`;
}

function renderFeed(feed) {
  clear(elements.bulletinFeed);
  const entries = [...(feed || [])].reverse().slice(0, 8);
  if (!entries.length) {
    appendText(
      elements.bulletinFeed,
      "li",
      "bulletin-item",
      "当前交易日暂无新播报。",
    );
    return;
  }
  for (const item of entries) {
    const entry = document.createElement("li");
    entry.className = "bulletin-item";
    appendText(entry, "time", "bulletin-time", formatDate(item.timestamp));
    appendText(entry, "p", "", item.state_line || "规则快照已更新。");
    const movers = document.createElement("div");
    movers.className = "bulletin-movers";
    for (const mover of item.movers || []) {
      appendText(
        movers,
        "span",
        "",
        `${mover.symbol} ${formatPercent(mover.change_pct)}`,
      );
    }
    entry.append(movers);
    elements.bulletinFeed.append(entry);
  }
}

function renderSources(sources) {
  clear(elements.sourceGrid);
  for (const item of sources || []) {
    const card = document.createElement("article");
    card.className = "source-card";
    const head = document.createElement("div");
    head.className = "source-card-head";
    appendText(head, "h3", "", item.source || "数据源");
    appendText(
      head,
      "span",
      `status-chip ${item.status === "ok" ? "" : "degraded"}`.trim(),
      item.status || "unknown",
    );
    card.append(head);
    appendText(card, "p", "", item.message || "暂无来源说明");
    elements.sourceGrid.append(card);
  }
}

function render(state, refreshed) {
  renderSession(state);
  renderIndices(state.indices);
  renderRanking(state.top10);
  renderMethod(state.method || {});
  renderFeed(state.feed);
  renderSources(state.sources);
  elements.loadStatus.textContent = refreshed
    ? `已重新读取 · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`
    : "已读取当前发布快照";
}

async function loadSnapshot({ refreshed = false } = {}) {
  elements.refresh.disabled = true;
  elements.loadStatus.textContent = refreshed
    ? "正在绕过缓存重新读取…"
    : "正在加载本地数据文件…";
  try {
    const separator = DATA_URL.includes("?") ? "&" : "?";
    const response = await fetch(`${DATA_URL}${separator}t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    if (
      !Array.isArray(state.top10) ||
      state.top10.length !== 10 ||
      state.method?.model_used !== false
    ) {
      throw new Error("快照结构校验失败");
    }
    render(state, refreshed);
  } catch (error) {
    elements.loadStatus.textContent = `读取失败：${error.message}。请稍后重试。`;
  } finally {
    elements.refresh.disabled = false;
  }
}

elements.refresh.addEventListener("click", () =>
  loadSnapshot({ refreshed: true }),
);
loadSnapshot();
