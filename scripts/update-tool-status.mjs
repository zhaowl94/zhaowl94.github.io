import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDirectory, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function generatedFromScript(relativePath, fallback) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const match = source.match(/"generatedAt":"([^"]+)"/u);
  return match?.[1] || fallback;
}

function ndxTimestamp() {
  const source = fs.readFileSync(
    path.join(root, "ndx-valuation", "data.js"),
    "utf8",
  );
  const generated = source.match(/"generatedAt":"([^"]+)"/u)?.[1];
  if (generated) return generated;
  const dates = [...source.matchAll(/"(\d{4}-\d{2}-\d{2})"/gu)];
  return dates.at(-1)?.[1] ? `${dates.at(-1)[1]}T21:00:00+08:00` : null;
}

const premium = readJson("etf-premium/data/dashboard.json");
const qdii = readJson("qdii-similarity/data/dashboard.json");
const bubble = readJson("bubble-monitor/bubble_data.json");
const bubbleTime = bubble.updated_at
  ? `${bubble.updated_at.replace(" ", "T")}+08:00`
  : null;
const timestamps = [
  premium.generatedAt || premium.generated_at,
  qdii.generatedAt,
  bubbleTime,
  generatedFromScript("strategy-monitor/strategy_data.js"),
  generatedFromScript("backtest-lab/backtest_lab_data.js"),
  ndxTimestamp(),
]
  .filter(Boolean)
  .map((value) => new Date(value))
  .filter((date) => !Number.isNaN(date.getTime()));

const payload = {
  schemaVersion: 1,
  generatedAt: timestamps.length
    ? new Date(
        Math.max(...timestamps.map((date) => date.getTime())),
      ).toISOString()
    : new Date().toISOString(),
  tools: {
    "etf-premium": { updatedAt: premium.generatedAt || premium.generated_at },
    "ndx-valuation": { updatedAt: ndxTimestamp() },
    "bubble-monitor": { updatedAt: bubbleTime },
    "strategy-monitor": {
      updatedAt: generatedFromScript("strategy-monitor/strategy_data.js"),
    },
    "backtest-lab": {
      updatedAt: generatedFromScript("backtest-lab/backtest_lab_data.js"),
    },
    "qdii-similarity": { updatedAt: qdii.generatedAt },
  },
};

const output = path.join(root, "data", "tool-status.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, generatedAt: payload.generatedAt }));
