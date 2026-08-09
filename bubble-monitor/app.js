const eventNames = {
  "1985-10-01": "NDX 成立",
  "1990-10-11": "1990 年衰退底部",
  "1998-10-08": "LTCM 危机底部",
  "1999-12-31": "dot-com 泡沫前夜",
  "2000-03-27": "dot-com 泡沫顶峰",
  "2000-05-23": "dot-com 初次暴跌",
  "2001-09-21": "9/11 底部",
  "2002-10-07": "互联网泡沫底部",
  "2007-10-31": "次贷泡沫顶峰",
  "2009-03-09": "金融危机底部",
  "2010-05-26": "Flash Crash 底部",
  "2011-10-03": "美债危机底部",
  "2015-08-25": "A 股传导底部",
  "2018-12-24": "2018 年 12 月底部",
  "2020-03-20": "COVID 底部",
  "2021-11-19": "疫后牛市峰值",
  "2022-12-28": "2022 熊市底部",
  "2026-03-30": "伊朗冲突底部",
};

const el = (id) => document.getElementById(id);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const fmt = (v, digits = 2) =>
  num(v) === null
    ? "--"
    : Number(v).toLocaleString("zh-CN", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
const pct = (v, digits = 2) => (num(v) === null ? "--" : `${fmt(v, digits)}%`);
const sigma = (v) => (num(v) === null ? "--" : `${fmt(v, 2)} σ`);
const signedClass = (v) => (num(v) > 0 ? "pos" : num(v) < 0 ? "neg" : "neu");
const stateText = { normal: "正常", warning: "警告", danger: "危险" };
const positionPct = (devPct) => {
  if (num(devPct) === null || devPct <= 0) return "--";
  const x = devPct / 100;
  return pct((0.2 / (1 - 1 / (1 + x))) * 100, 1);
};

function setStatus(text, tone) {
  el("status").textContent = text;
  el("status").className = `status ${tone || ""}`;
}

function scoreData(d) {
  const c = d.ndx_trend?.current || {};
  const cape = num(d.shiller_cape?.value);
  const pe = num(d.sp500_pe?.value);
  const qqqPe = num(d.qqq?.pe);
  const fear = num(d.fear_greed?.value);
  const vix = num(d.vix?.value);
  const putCall = num(d.put_call?.total);
  const top10 = num(d.ndx_concentration?.top10 ?? d.qqq?.top10_pct);
  const marginSigma = num(d.margin_debt?.sigma);
  const hySigma = num(d.hy_spread?.sigma);
  const buffett = num(d.buffett_indicator?.value);
  const ipo = num(d.ipo?.y2025);

  const parts = [
    {
      name: "趋势过热",
      score: clamp(((num(c.sigma) + 1) / 4.2) * 100),
      weight: 0.24,
    },
    {
      name: "估值",
      score: clamp(
        (((cape || 0) - 24) / 18) * 42 +
          (((pe || 0) - 18) / 14) * 28 +
          (((qqqPe || 0) - 24) / 18) * 30,
      ),
      weight: 0.24,
    },
    {
      name: "情绪",
      score: clamp(
        (fear || 0) * 0.55 +
          (vix === null ? 35 : clamp(((25 - vix) / 18) * 100)) * 0.25 +
          (putCall === null ? 35 : clamp(((1.05 - putCall) / 0.45) * 100)) *
            0.2,
      ),
      weight: 0.16,
    },
    {
      name: "集中度",
      score: clamp((((top10 || 0) - 45) / 25) * 100),
      weight: 0.14,
    },
    {
      name: "杠杆信用",
      score: clamp(
        (marginSigma === null ? 45 : ((marginSigma + 1) / 3.5) * 100) * 0.55 +
          (hySigma === null ? 45 : ((-hySigma + 0.5) / 2.5) * 100) * 0.45,
      ),
      weight: 0.14,
    },
    {
      name: "IPO 热度",
      score: clamp((((ipo || 0) - 140) / 520) * 100),
      weight: 0.08,
    },
  ];
  const total = parts.reduce((sum, p) => sum + p.score * p.weight, 0);
  return { total: Math.round(total), parts };
}

function riskText(score) {
  if (score >= 72) return ["高温", "risk-high"];
  if (score >= 48) return ["偏热", "risk-mid"];
  return ["温和", "risk-low"];
}

function renderHero(d, score) {
  const c = d.ndx_trend?.current || {};
  const [label, klass] = riskText(score.total);
  el("ndxValue").textContent = fmt(c.ndx, 2);
  el("ndxMeta").textContent =
    `${c.date || "--"} 收盘；样本 ${fmt(d.ndx_trend?.data_points, 0)} 个交易日`;
  el("scoreValue").textContent = `${score.total}/100`;
  el("scorePill").textContent = label;
  el("scorePill").className = `pill ${klass}`;
  el("trendValue").textContent = sigma(c.sigma);
  el("trendValue").className = `big ${signedClass(c.sigma)}`;
  el("trendMeta").textContent =
    `较全周期回归趋势 ${pct(c.dev_lr)}；推荐仓位 ${positionPct(c.dev_lr)}；年化趋势 ${pct(d.ndx_trend?.annual_growth)}`;
  el("maValue").textContent = pct(c.dev_ma200);
  el("maValue").className = `big ${signedClass(c.dev_ma200)}`;
  el("maMeta").textContent = `MA200 ${fmt(c.ma200, 2)}；正值表示价格高于均线`;
}

function renderMetrics(d) {
  const c = d.ndx_trend?.current || {};
  const byHigh = (v, warn, danger) =>
    num(v) === null
      ? "warning"
      : v >= danger
        ? "danger"
        : v >= warn
          ? "warning"
          : "normal";
  const byLow = (v, warn, danger) =>
    num(v) === null
      ? "warning"
      : v <= danger
        ? "danger"
        : v <= warn
          ? "warning"
          : "normal";
  const byAbs = (v, warn, danger) =>
    num(v) === null
      ? "warning"
      : Math.abs(v) >= danger
        ? "danger"
        : Math.abs(v) >= warn
          ? "warning"
          : "normal";
  const items = [
    {
      label: "S&P 500 PE",
      value: fmt(d.sp500_pe?.value, 2),
      note: d.sp500_pe?.source || "",
      state: byHigh(d.sp500_pe?.value, 26, 32),
    },
    {
      label: "Shiller CAPE",
      value: fmt(d.shiller_cape?.value, 2),
      note: d.shiller_cape?.source || "",
      state: byHigh(d.shiller_cape?.value, 32, 40),
    },
    {
      label: "QQQ PE",
      value: fmt(d.qqq?.pe, 2),
      note: `Top10 ${pct(d.qqq?.top10_pct ?? d.ndx_concentration?.top10)}`,
      state: byHigh(d.qqq?.pe, 30, 38),
    },
    {
      label: "恐惧贪婪",
      value: fmt(d.fear_greed?.value, 1),
      note: d.fear_greed?.rating || "",
      state: byHigh(d.fear_greed?.value, 65, 80),
    },
    {
      label: "VIX",
      value: fmt(d.vix?.value, 2),
      note: d.vix?.source || "",
      state: byLow(d.vix?.value, 14, 11),
    },
    {
      label: "Put/Call",
      value: fmt(d.put_call?.total, 2),
      note: `Equity ${fmt(d.put_call?.equity, 2)}`,
      state: byLow(d.put_call?.total, 0.8, 0.65),
    },
    {
      label: "巴菲特指标",
      value: pct(d.buffett_indicator?.value, 0),
      note: `σ ${fmt(d.buffett_indicator?.sigma, 2)}`,
      state: byHigh(d.buffett_indicator?.value, 180, 220),
    },
    {
      label: "高收益利差",
      value: `${fmt(d.hy_spread?.value, 2)}%`,
      note: `长期均值 ${fmt(d.hy_spread?.mean, 2)}%`,
      state: byLow(d.hy_spread?.value, 3.5, 2.8),
    },
    {
      label: "融资融券",
      value: `${fmt(d.margin_debt?.total_b, 0)}B`,
      note: `同比 ${fmt(d.margin_debt?.yoy_change_b, 0)}B；σ ${fmt(d.margin_debt?.sigma, 2)}`,
      state: byHigh(d.margin_debt?.sigma, 1, 2),
    },
    {
      label: "集中度 Top10",
      value: pct(d.ndx_concentration?.top10, 2),
      note: `Top5 ${pct(d.ndx_concentration?.top5, 2)}`,
      state: byHigh(d.ndx_concentration?.top10, 58, 66),
    },
    {
      label: "趋势偏离",
      value: pct(c.dev_lr, 2),
      note: `推荐仓位 ${positionPct(c.dev_lr)}；当前趋势点位 ${fmt(c.predicted, 2)}；${sigma(c.sigma)}`,
      state: byAbs(c.sigma, 1, 2),
    },
    {
      label: "IPO 数量",
      value: fmt(d.ipo?.y2025, 0),
      note: `2021 年 ${fmt(d.ipo?.y2021, 0)}；1999 年 ${fmt(d.ipo?.y1999, 0)}`,
      state: byHigh(d.ipo?.y2025, 300, 500),
    },
  ];
  el("metrics").innerHTML = items
    .map(
      (item) => `
        <article class="metric ${item.state}">
          <div class="metric-head">
            <div class="label">${item.label}</div>
            <div class="state ${item.state}">${stateText[item.state]}</div>
          </div>
          <div class="value ${item.state === "danger" ? "pos" : item.state === "warning" ? "neu" : "neg"}">${item.value}</div>
          <div class="note">${item.note || "&nbsp;"}</div>
        </article>
      `,
    )
    .join("");
}

function renderBars(score) {
  el("scoreBars").innerHTML = score.parts
    .map(
      (p) => `
        <div class="bar-row">
          <div>${p.name}</div>
          <div class="track"><div class="fill" style="width:${clamp(p.score)}%"></div></div>
          <strong>${Math.round(p.score)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderPeaks(d) {
  const c = d.ndx_trend?.current || {};
  const rows = [
    ...(d.ndx_trend?.peak_comparisons || []),
    { ...c, label: "当前" },
  ];
  el("peakRows").innerHTML = rows
    .map(
      (r) => `
        <tr>
          <td>${eventNames[r.date] || r.label || "--"}</td>
          <td>${r.date || "--"}</td>
          <td>${fmt(r.ndx, 2)}</td>
          <td class="${signedClass(r.sigma)}">${sigma(r.sigma)}</td>
          <td>${pct(r.dev_ma200)}</td>
          <td class="${signedClass(r.dev_lr)}">${pct(r.dev_lr)}</td>
          <td>${positionPct(r.dev_lr)}</td>
        </tr>
      `,
    )
    .join("");
}

function renderEvents(d) {
  const rows = d.ndx_trend?.historical || [];
  el("eventRows").innerHTML = rows
    .map(
      (r) => `
        <tr>
          <td>${eventNames[r.date] || r.label || "--"}</td>
          <td>${r.date || "--"}</td>
          <td>${fmt(r.ndx, 2)}</td>
          <td class="${signedClass(r.sigma)}">${sigma(r.sigma)}</td>
          <td>${pct(r.dev_ma200)}</td>
          <td class="${signedClass(r.dev_lr)}">${pct(r.dev_lr)}</td>
          <td>${positionPct(r.dev_lr)}</td>
        </tr>
      `,
    )
    .join("");
}

function renderChart(d) {
  const svg = el("sigmaChart");
  const points = [
    ...(d.ndx_trend?.historical || []),
    { ...(d.ndx_trend?.current || {}), label: "当前" },
  ].filter((p) => p.date && num(p.sigma) !== null);
  if (!points.length) {
    svg.innerHTML = "";
    return;
  }
  const width = 860,
    height = 260,
    pad = 34;
  const years = points.map((p) => new Date(p.date).getFullYear());
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const minY = -3;
  const maxY = 5;
  const x = (date) =>
    pad +
    ((new Date(date).getFullYear() - minYear) / (maxYear - minYear || 1)) *
      (width - pad * 2);
  const y = (v) =>
    height - pad - ((v - minY) / (maxY - minY)) * (height - pad * 2);
  const path = points
    .map(
      (p, i) =>
        `${i ? "L" : "M"} ${x(p.date).toFixed(1)} ${y(p.sigma).toFixed(1)}`,
    )
    .join(" ");
  const axis = [0, 2, 4, -2]
    .map(
      (v) =>
        `<line x1="${pad}" x2="${width - pad}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? "#9aa6b8" : "#e5ebf3"}" /><text x="8" y="${y(v) + 4}" fill="#667085" font-size="11">${v}σ</text>`,
    )
    .join("");
  const dots = points
    .map((p) => {
      const color =
        p.sigma >= 2
          ? "#c83e3e"
          : p.sigma >= 1
            ? "#c47a0a"
            : p.sigma <= -1
              ? "#12945f"
              : "#2563eb";
      const title = `${eventNames[p.date] || p.label || p.date}: ${sigma(p.sigma)}`;
      return `<circle cx="${x(p.date)}" cy="${y(p.sigma)}" r="4.2" fill="${color}"><title>${title}</title></circle>`;
    })
    .join("");
  svg.innerHTML = `
        <rect x="0" y="0" width="${width}" height="${height}" fill="#fbfdff"></rect>
        ${axis}
        <path d="${path}" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linejoin="round"></path>
        ${dots}
        <text x="${pad}" y="${height - 10}" fill="#667085" font-size="11">${minYear}</text>
        <text x="${width - pad - 28}" y="${height - 10}" fill="#667085" font-size="11">${maxYear}</text>
      `;
}

function renderHoldings(d) {
  const names = d.ndx_concentration?.all_names || [];
  const weights = d.ndx_concentration?.all_weights || [];
  const max = Math.max(...weights, 1);
  el("holdings").innerHTML = names
    .slice(0, 20)
    .map(
      (name, i) => `
        <div class="holding">
          <strong>${name}</strong>
          <div class="track"><div class="fill" style="width:${(weights[i] / max) * 100}%"></div></div>
          <span>${pct(weights[i], 2)}</span>
        </div>
      `,
    )
    .join("");
}

async function loadData(message = "正在读取已发布快照...") {
  setStatus(message);
  const resp = await fetch(`bubble_data.json?ts=${Date.now()}`, {
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`读取失败：HTTP ${resp.status}`);
  const data = await resp.json();
  const score = scoreData(data);
  renderHero(data, score);
  renderMetrics(data);
  renderBars(score);
  renderPeaks(data);
  renderEvents(data);
  renderChart(data);
  renderHoldings(data);
  setStatus(
    `已发布快照：${data.updated_at || "--"}。后台定时任务会保留上游失败时最近一次有效数据。`,
  );
}

async function updateData() {
  const btn = el("updateBtn");
  btn.disabled = true;
  setStatus("正在绕过缓存，拉取最新已发布快照...");
  try {
    await loadData("正在拉取最新发布快照...");
  } catch (err) {
    setStatus(
      `刷新失败：${err.message}。当前页面会保留已经渲染的数据，可稍后重试。`,
      "pos",
    );
  } finally {
    btn.disabled = false;
  }
}

el("reloadBtn").addEventListener("click", () =>
  loadData("正在重新读取已发布快照...").catch((err) =>
    setStatus(err.message, "pos"),
  ),
);
el("updateBtn").addEventListener("click", updateData);
loadData().catch((err) => {
  setStatus(
    `${err.message}。请通过 GitHub Pages 或本地静态服务器访问本页。`,
    "pos",
  );
});
