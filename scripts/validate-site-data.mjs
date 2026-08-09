import fs from "node:fs";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const premium = readJson("etf-premium/data/dashboard.json");
const qdii = readJson("qdii-similarity/data/dashboard.json");
const bubble = readJson("bubble-monitor/bubble_data.json");
const marketPulse = readJson("market-pulse/data/state.json");
const ndx100Meta = readJson("ndx100-dashboard/data/meta.json");
const ndx100Quotes = readJson("ndx100-dashboard/data/quotes.json");
const status = readJson("data/tool-status.json");
const strategy = fs.readFileSync("strategy-monitor/strategy_data.js", "utf8");
const backtest = fs.readFileSync("backtest-lab/backtest_lab_data.js", "utf8");
const valuation = fs.readFileSync("ndx-valuation/data.js", "utf8");

assert(
  premium.ready && premium.funds?.length >= 12,
  "ETF premium snapshot is incomplete",
);
assert(
  qdii.funds?.length >= 500 && qdii.count === qdii.funds.length,
  "QDII snapshot is incomplete",
);
assert(
  bubble.ndx_trend?.current && bubble.vix,
  "Bubble snapshot is incomplete",
);
assert(
  strategy.includes("window.STRATEGY_DATA") && strategy.length > 100_000,
  "Strategy snapshot is incomplete",
);
assert(
  backtest.includes("window.BACKTEST_DATA") && backtest.length > 100_000,
  "Backtest snapshot is incomplete",
);
assert(
  valuation.includes("window.RAW_NDX") && valuation.length > 100_000,
  "Valuation snapshot is incomplete",
);
assert(
  marketPulse.method?.model_used === false &&
    marketPulse.top10?.length === 10 &&
    marketPulse.indices?.length === 2 &&
    marketPulse.candidate_count >= 60 &&
    marketPulse.sources?.length >= 3,
  "Market Pulse snapshot is incomplete or unexpectedly uses a model",
);
assert(
  ndx100Meta.ticker_count >= 80 && Object.keys(ndx100Quotes).length >= 80,
  "NDX 100 dashboard snapshot is incomplete",
);
assert(
  Object.keys(status.tools || {}).length === 8,
  "Home status must describe all eight public research tools",
);

console.log(
  JSON.stringify({
    premiumFunds: premium.funds.length,
    qdiiFunds: qdii.funds.length,
    bubbleDate: bubble.updated_at,
    marketPulseCandidates: marketPulse.candidate_count,
    ndx100Tickers: ndx100Meta.ticker_count,
    tools: Object.keys(status.tools).length,
  }),
);
