"use strict";

const REF_SHORT = {
  270042: "广发纳指",
  161128: "易方达标普科技",
  "017091": "景顺纳指科技",
};

const state = {
  allFunds: [],
  funds: [],
  references: {},
  lastSort: "sim_avg",
  lastFilter: { q: "", status: "" },
  generatedAt: null,
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadSnapshot();
});

function bindEvents() {
  $("btn-update").addEventListener("click", () => loadSnapshot(true));
  $("btn-refresh-view").addEventListener("click", resetView);

  let qTimer;
  $("filter-q").addEventListener("input", (event) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.lastFilter.q = event.target.value.trim();
      applyView();
    }, 180);
  });
  $("filter-status").addEventListener("change", (event) => {
    state.lastFilter.status = event.target.value;
    applyView();
  });
  $("sort-key").addEventListener("change", (event) => {
    state.lastSort = event.target.value;
    applyView();
  });
  document.querySelectorAll("th.sortable").forEach((heading) => {
    heading.addEventListener("click", () => {
      state.lastSort = heading.dataset.sort;
      $("sort-key").value = state.lastSort;
      applyView();
    });
  });
  document.querySelector(".modal-close").addEventListener("click", closeDetail);
  document
    .querySelector(".modal-backdrop")
    .addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetail();
  });
}

async function loadSnapshot(announce = false) {
  const button = $("btn-update");
  button.disabled = true;
  button.textContent = announce ? "刷新中…" : "载入中…";
  renderProgress({
    pct: 32,
    msg: announce ? "正在绕过缓存读取最新发布快照…" : "正在读取发布快照…",
  });
  try {
    const response = await fetch(`data/dashboard.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.allFunds = payload.funds || [];
    state.references = payload.references || {};
    state.generatedAt = payload.generatedAt;
    applyView();
    renderSnapshotStatus(payload);
  } catch (error) {
    renderProgress({ pct: 0, msg: `快照读取失败：${error.message}` });
    $("funds-body").innerHTML =
      `<tr class="empty-row"><td colspan="11">加载失败：${escapeHtml(error.message)}</td></tr>`;
  } finally {
    button.disabled = false;
    button.textContent = "刷新最新快照";
  }
}

function resetView() {
  state.lastSort = "sim_avg";
  state.lastFilter = { q: "", status: "" };
  $("filter-q").value = "";
  $("filter-status").value = "";
  $("sort-key").value = "sim_avg";
  applyView();
}

function applyView() {
  const query = state.lastFilter.q.toLowerCase();
  let funds = state.allFunds.filter((fund) => {
    if (query) {
      const haystack =
        `${fund.code || ""} ${fund.name || ""} ${fund.type || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    const purchase = fund.purchase_status || "";
    if (state.lastFilter.status === "open" && !purchase.includes("开放"))
      return false;
    if (state.lastFilter.status === "limited" && !purchase.includes("限"))
      return false;
    if (state.lastFilter.status === "paused" && !purchase.includes("暂停"))
      return false;
    return true;
  });
  funds = [...funds].sort(sorter(state.lastSort));
  state.funds = funds;
  renderTable();
  $("total-count").textContent = String(funds.length);
  document.querySelectorAll("th.sortable").forEach((heading) => {
    heading.classList.toggle("active", heading.dataset.sort === state.lastSort);
  });
}

function sorter(key) {
  if (key === "code" || key === "name" || key === "type") {
    return (left, right) =>
      String(left[key] || "").localeCompare(String(right[key] || ""), "zh-CN");
  }
  if (key === "quota_asc")
    return (left, right) =>
      numeric(left.daily_quota, Infinity) -
      numeric(right.daily_quota, Infinity);
  if (key === "quota")
    return (left, right) =>
      numeric(right.daily_quota, -1) - numeric(left.daily_quota, -1);
  if (key === "nav")
    return (left, right) => numeric(right.nav, -1) - numeric(left.nav, -1);
  if (key.startsWith("sim_") && key !== "sim_avg") {
    const code = key.slice(4);
    return (left, right) =>
      similarityScore(right, code) - similarityScore(left, code);
  }
  return (left, right) =>
    numeric(avgSim(right), -1) - numeric(avgSim(left), -1);
}

function numeric(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function renderSnapshotStatus(payload) {
  const count = payload.count || state.allFunds.length;
  const coverage = payload.coverage || {};
  const generated = formatTime(payload.generatedAt);
  renderProgress({
    pct: 100,
    msg: `已载入 ${count} 只 QDII；快照生成于 ${generated}`,
  });
  $("err-count").textContent = payload.refreshFailures
    ? `(${payload.refreshFailures})`
    : "";
  $("error-log").textContent = payload.refreshFailures
    ? `上次后台更新有 ${payload.refreshFailures} 个抓取任务失败，相关基金已尽量沿用最近有效缓存。`
    : "上次后台生成未报告基金级异常。";

  const cards = [
    ["基金列表", count, count],
    ["持仓覆盖", coverage.holdings || 0, count],
    ["净值覆盖", coverage.nav || 0, count],
    ["基本信息", coverage.basic || 0, count],
  ];
  $("sources").innerHTML = cards
    .map(
      ([label, value, total]) => `<div class="source-card">
    <span class="dot ${value ? "ok" : "fail"}"></span>
    <div class="source-meta"><div class="source-name">${label} · ${value}/${total}</div>
    <div class="source-msg">静态快照 · ${generated}</div></div>
  </div>`,
    )
    .join("");

  $("refs-status").innerHTML = Object.entries(REF_SHORT)
    .map(([code, short]) => {
      const loaded = state.allFunds.some(
        (fund) => fund.code === code && fund.similarity,
      );
      return `<div class="ref-card"><span class="dot ${loaded ? "ok" : "pending"}"></span>
      <div class="name"><span class="code">${code}</span><span>${short}</span></div>
      <div class="stat">${loaded ? "已计算 ✓" : "数据不足"}</div></div>`;
    })
    .join("");
}

function renderProgress(progress) {
  $("progress-msg").textContent = progress.msg || "就绪";
  $("progress-pct").textContent = `${progress.pct || 0}%`;
  $("progress-fill").style.width = `${progress.pct || 0}%`;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value || "--")
    : date.toLocaleString("zh-CN");
}

function renderTable() {
  const body = $("funds-body");
  if (!state.funds.length) {
    body.innerHTML =
      '<tr class="empty-row"><td colspan="11">没有匹配的基金</td></tr>';
    return;
  }
  body.innerHTML = state.funds.map(rowHtml).join("");
  body.querySelectorAll("tr[data-code]").forEach((row) => {
    row.addEventListener("click", () => openDetail(row.dataset.code));
  });
}

function rowHtml(fund) {
  const quota = numeric(fund.daily_quota, 0);
  const quotaText =
    quota > 0
      ? quota >= 10000
        ? `${(quota / 10000).toFixed(2)} 万`
        : quota.toLocaleString()
      : "—";
  const purchase = fund.purchase_status || "";
  const purchaseClass =
    purchase.includes("暂停") || purchase.includes("封闭")
      ? "paused"
      : purchase.includes("限")
        ? "limited"
        : "open";
  const dataStatus = fund.data_status || {};
  const dots = [
    ["持仓", dataStatus.holdings_ok],
    ["净值", dataStatus.nav_ok],
    ["基本信息", dataStatus.basic_ok],
  ]
    .map(
      ([title, ok]) =>
        `<span class="ddot ${ok ? "ok" : ""}" title="${title}"></span>`,
    )
    .join("");
  const average = avgSim(fund);
  return `<tr data-code="${fund.code}">
    <td class="col-code">${fund.code}</td>
    <td class="col-name">${escapeHtml(fund.name)}</td>
    <td class="col-type">${escapeHtml(fund.type || "")}</td>
    <td class="num">${fund.nav != null ? Number(fund.nav).toFixed(4) : "—"}${fund.nav_date ? `<span class="sub">${escapeHtml(fund.nav_date)}</span>` : ""}</td>
    <td class="num quota">${quotaText}</td>
    <td><span class="status-badge ${purchaseClass}">${escapeHtml(purchase || "—")}</span></td>
    <td><span class="data-dots">${dots}</span></td>
    <td class="num">${simCell(fund, "270042")}</td>
    <td class="num">${simCell(fund, "161128")}</td>
    <td class="num">${simCell(fund, "017091")}</td>
    <td class="num sim-cell ${simClass(average)}">${average != null ? average.toFixed(1) : "—"}</td>
  </tr>`;
}

function similarityScore(fund, code) {
  return numeric(fund.similarity?.[code]?.score, -1);
}

function simCell(fund, code) {
  const score = fund.similarity?.[code]?.score;
  return score == null
    ? '<span class="sim-cell sim-low">—</span>'
    : `<span class="sim-cell ${simClass(score)}">${Number(score).toFixed(1)}</span>`;
}

function simClass(score) {
  if (score == null) return "sim-low";
  if (score >= 60) return "sim-high";
  if (score >= 35) return "sim-mid";
  return "sim-low";
}

function avgSim(fund) {
  const scores = Object.values(fund.similarity || {})
    .map((item) => item.score)
    .filter((score) => score != null);
  return scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : null;
}

function openDetail(code) {
  const fund = state.allFunds.find((item) => item.code === code);
  if (!fund) return;
  $("modal-title").innerHTML =
    `<span class="detail-code">${fund.code}</span> ${escapeHtml(fund.name)}`;
  $("modal-body").innerHTML = detailHtml(fund);
  $("detail-modal").classList.remove("hidden");
}

function closeDetail() {
  $("detail-modal").classList.add("hidden");
}

function detailHtml(fund) {
  const basic = fund.basic || {};
  const entries = [
    ["基金代码", fund.code],
    ["基金类型", fund.type],
    ["单位净值", fund.nav],
    ["净值日期", fund.nav_date],
    ["每日限购额度", fund.daily_quota],
    ["申购状态", fund.purchase_status],
    ["赎回状态", fund.redeem_status],
    ["基金管理人", basic["基金管理人"]],
    ["基金托管人", basic["基金托管人"]],
    ["跟踪标的", basic["跟踪标的"]],
    ["业绩比较基准", basic["业绩比较基准"]],
    ["投资目标", basic["投资目标"]],
  ].filter(([, value]) => value != null && value !== "");

  const similarityCards = Object.entries(REF_SHORT)
    .map(([code, short]) => {
      const item = fund.similarity?.[code] || {};
      const breakdown = [
        item.holdings != null
          ? `持仓 ${Number(item.holdings).toFixed(0)}%`
          : null,
        item.correlation != null
          ? `相关 ${Number(item.correlation).toFixed(0)}%`
          : null,
        item.index != null ? `指数 ${Number(item.index).toFixed(0)}%` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<div class="sim-card ${simClass(item.score)}"><div class="ref-name">${short} <span>${code}</span></div>
      <div class="score">${item.score != null ? Number(item.score).toFixed(1) : "—"}</div><div class="breakdown">${breakdown || "数据不足"}</div></div>`;
    })
    .join("");

  const holdings = fund.holdings || [];
  const maximum = Math.max(
    ...holdings.map((item) => numeric(item.weight, 0)),
    1,
  );
  const holdingRows = holdings.length
    ? holdings
        .map(
          (
            item,
            index,
          ) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.ticker)}</td>
    <td>${escapeHtml(item.name)}</td><td class="num">${numeric(item.weight, 0).toFixed(2)}%</td>
    <td><span class="w-bar" style="width:${((numeric(item.weight, 0) / maximum) * 100).toFixed(1)}%"></span></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5">无持仓数据</td></tr>';

  return `<section><h3>基本信息</h3><div class="kv-grid">${entries.map(([key, value]) => `<div class="k">${key}</div><div class="v">${escapeHtml(value)}</div>`).join("")}</div></section>
    <section><h3>相似度细分</h3><div class="sim-breakdown">${similarityCards}</div></section>
    <section><h3>快照说明</h3><div class="cross-validation">生成于 ${formatTime(state.generatedAt)}；页面不会从浏览器直接请求基金实时接口。</div></section>
    <section><h3>最新季度前十大重仓股 ${fund.holdings_quarter ? `(${escapeHtml(fund.holdings_quarter)})` : ""}</h3>
      <table class="holdings-table"><thead><tr><th>#</th><th>代码</th><th>名称</th><th class="num">权重</th><th></th></tr></thead><tbody>${holdingRows}</tbody></table></section>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}
