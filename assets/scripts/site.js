const statusButton = document.querySelector("#refresh-status");
const siteUpdated = document.querySelector("#site-updated");

function formatTimestamp(value) {
  if (!value) return "暂无时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function applyToolStatus(payload) {
  const tools = payload.tools || {};
  document.querySelectorAll("[data-tool]").forEach((card) => {
    const key = card.dataset.tool;
    const target = card.querySelector("[data-tool-updated]");
    const item = tools[key];
    if (target)
      target.textContent =
        item?.label || (item ? formatTimestamp(item.updatedAt) : "待发布");
  });
  siteUpdated.textContent = formatTimestamp(payload.generatedAt);
}

async function loadToolStatus({ announce = false } = {}) {
  if (!siteUpdated) return;
  if (location.protocol === "file:") {
    siteUpdated.textContent = "直接打开模式；请进入各工具读取本地数据";
    return;
  }
  if (announce) siteUpdated.textContent = "正在拉取最新发布状态…";
  if (statusButton) statusButton.disabled = true;
  try {
    const response = await fetch(`data/tool-status.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    applyToolStatus(await response.json());
  } catch {
    siteUpdated.textContent = "状态暂不可用；工具页面仍可直接打开";
  } finally {
    if (statusButton) statusButton.disabled = false;
  }
}

document.querySelectorAll("[data-current-year]").forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});

statusButton?.addEventListener("click", () =>
  loadToolStatus({ announce: true }),
);
loadToolStatus();
