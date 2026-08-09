import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(HERE, "..");
const SOURCE_ROOT = path.join(HERE, "research-data");
const OUT = path.join(SITE_ROOT, "strategy-monitor", "strategy_data.js");
const REFRESH = process.argv.includes("--refresh");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeTextFile(file, text) {
  const target = path.resolve(file);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, "utf8");
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(error.code)) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          // The temporary file may already be absent after a failed rename.
        }
        throw error;
      }
      if (attempt === 5) break;
      await sleep(250 * (attempt + 1));
    }
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.writeFileSync(target, text, "utf8");
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Best-effort cleanup after the fallback write succeeds.
      }
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(error.code)) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          // The temporary file may already be absent after a failed write.
        }
        throw error;
      }
      if (attempt === 5) break;
      await sleep(250 * (attempt + 1));
    }
  }
  const fallback = `${target}.latest`;
  fs.writeFileSync(fallback, text, "utf8");
  return fallback;
}

function freshest(file) {
  const target = path.resolve(file);
  const fallback = `${target}.latest`;
  if (!fs.existsSync(fallback)) return target;
  if (!fs.existsSync(target)) return fallback;
  return fs.statSync(fallback).mtimeMs >= fs.statSync(target).mtimeMs
    ? fallback
    : target;
}

function normalizeDate(value) {
  const text = String(value ?? "").trim();
  const parts = text.split(/[/-]/);
  if (parts.length !== 3) return text;
  return `${parts[0].padStart(4, "0")}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function readCsv(file) {
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!text) return [];
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines.filter(Boolean).map((line) => {
    const parts = line.split(",");
    const row = {};
    headers.forEach((header, index) => {
      row[header] = parts[index] ?? "";
    });
    if (row.date) row.date = normalizeDate(row.date);
    if (row.observation_date)
      row.observation_date = normalizeDate(row.observation_date);
    return row;
  });
}

function readOhlc(file) {
  return readCsv(file)
    .map((row) => ({
      date: row.date,
      open: Number(row.open ?? row.close),
      high: Number(row.high ?? row.close),
      low: Number(row.low ?? row.close),
      close: Number(row.close),
    }))
    .filter(
      (row) =>
        row.date &&
        [row.open, row.high, row.low, row.close].every(
          (x) => Number.isFinite(x) && x > 0,
        ),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

function readClose(file, column) {
  return readCsv(file)
    .map((row) => ({ date: row.date, close: Number(row[column]) }))
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function readFx(file) {
  return readCsv(file)
    .map((row) => ({
      date: row.observation_date || row.date,
      fx: Number(row.DEXCHUS ?? row.fx),
    }))
    .filter((row) => row.date && Number.isFinite(row.fx) && row.fx > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      accept: "*/*",
      "user-agent": "Mozilla/5.0 strategy-monitor",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.text();
}

async function refreshNdx() {
  const now = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?period1=497021400&period2=${now}&interval=1d&events=history`;
  const json = JSON.parse(await fetchText(url));
  const result = json.chart?.result?.[0];
  if (!result) throw new Error("Yahoo ^NDX payload missing result");
  const quote = result.indicators.quote[0];
  const rows = ["date,open,high,low,close"];
  for (let i = 0; i < result.timestamp.length; i++) {
    if (quote.close[i] == null) continue;
    const date = new Date(result.timestamp[i] * 1000)
      .toISOString()
      .slice(0, 10);
    rows.push(
      [date, quote.open[i], quote.high[i], quote.low[i], quote.close[i]].join(
        ",",
      ),
    );
  }
  await writeTextFile(
    path.join(SOURCE_ROOT, "nasdaq100_index.csv"),
    `${rows.join("\n")}\n`,
  );
}

async function refreshFx() {
  const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXCHUS";
  const text = await fetchText(url);
  const lines = text.trim().split(/\r?\n/);
  const rows = ["observation_date,DEXCHUS"];
  for (const line of lines.slice(1)) {
    const [date, value] = line.split(",");
    if (date && value && value !== ".")
      rows.push(`${normalizeDate(date)},${value}`);
  }
  await writeTextFile(
    path.join(SOURCE_ROOT, "usdcny_fred.csv"),
    `${rows.join("\n")}\n`,
  );
}

async function fetchTencentQfqFull(symbol, minDate) {
  const rows = new Map();
  let end = new Date().toISOString().slice(0, 10);
  for (let round = 0; round < 20; round++) {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,${end},800,qfq`;
    const json = JSON.parse(await fetchText(url));
    const payload = json.data?.[symbol];
    const chunk = payload?.qfqday || payload?.day;
    if (!Array.isArray(chunk) || chunk.length === 0) {
      if (round === 0) throw new Error(json.msg || "Tencent qfq payload empty");
      break;
    }
    for (const row of chunk) rows.set(row[0], row);
    const first = chunk[0][0];
    if (first <= minDate) break;
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    end = d.toISOString().slice(0, 10);
  }
  return [...rows.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

async function refreshEquityQfq(code, symbol, minDate) {
  const qfq = await fetchTencentQfqFull(symbol, minDate);
  const rows = ["date,open,high,low,close"];
  for (const row of qfq)
    rows.push([row[0], row[1], row[3], row[4], row[2]].join(","));
  await writeTextFile(
    path.join(SOURCE_ROOT, `price_${code}_qfq_tencent.csv`),
    `${rows.join("\n")}\n`,
  );
}

async function refreshBondNav() {
  const text = await fetchText(
    "https://fund.eastmoney.com/pingzhongdata/100018.js",
  );
  const match = text.match(/var Data_ACWorthTrend = (\[.*?\]);/s);
  if (!match) throw new Error("100018 Data_ACWorthTrend not found");
  const rows = ["date,acc_nav"];
  for (const item of JSON.parse(match[1])) {
    if (item[1] == null) continue;
    rows.push(`${new Date(item[0]).toISOString().slice(0, 10)},${item[1]}`);
  }
  await writeTextFile(
    path.join(SOURCE_ROOT, "nav_100018.csv"),
    `${rows.join("\n")}\n`,
  );
}

async function refreshFundSource(code) {
  const text = await fetchText(
    `https://fund.eastmoney.com/pingzhongdata/${code}.js`,
  );
  await writeTextFile(path.join(SOURCE_ROOT, `pingzhongdata_${code}.js`), text);
}

async function refreshSources() {
  const tasks = [
    ["^NDX", refreshNdx],
    ["USD/CNY", refreshFx],
    ["513100 qfq", () => refreshEquityQfq("513100", "sh513100", "2013-04-01")],
    ["159941 qfq", () => refreshEquityQfq("159941", "sz159941", "2015-06-01")],
    ["100018 NAV", refreshBondNav],
    ["513100 NAV", () => refreshFundSource("513100")],
  ];
  const results = [];
  for (const [name, fn] of tasks) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
    }
  }
  return results;
}

const refreshResults = REFRESH ? await refreshSources() : [];

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
      open: ndx.open * lastFx,
      high: ndx.high * lastFx,
      low: ndx.low * lastFx,
      close: ndx.close * lastFx,
      ndxClose: ndx.close,
      fx: lastFx,
      source: "proxy",
    });
  }
  return rows;
}

function latestOnOrBefore(rows, date) {
  let best = null;
  for (const row of rows) {
    if (row.date <= date) best = row;
    else break;
  }
  return best;
}

function stitchWithProxy(proxyRows, etfRows) {
  const firstEtf = etfRows[0];
  const anchor = latestOnOrBefore(proxyRows, firstEtf.date);
  if (!firstEtf || !anchor) return etfRows;
  const scale = firstEtf.close / anchor.close;
  const before = proxyRows
    .filter((row) => row.date < firstEtf.date)
    .map((row) => ({
      ...row,
      open: row.open * scale,
      high: row.high * scale,
      low: row.low * scale,
      close: row.close * scale,
      source: "proxy_scaled",
    }));
  const after = etfRows.map((row) => ({ ...row, source: "etf_qfq" }));
  return [...before, ...after].sort((a, b) => a.date.localeCompare(b.date));
}

function stitchBondWithProxy(proxyRows, bondRows, annualReturn = 0.03) {
  const firstBond = bondRows[0];
  if (!firstBond) return [];
  const before = proxyRows
    .filter((row) => row.date < firstBond.date)
    .map((row) => {
      const years =
        (new Date(`${firstBond.date}T00:00:00Z`) -
          new Date(`${row.date}T00:00:00Z`)) /
        (365.25 * 864e5);
      const close = firstBond.close / Math.pow(1 + annualReturn, years);
      return { date: row.date, close, source: "bond_proxy_3pct" };
    });
  return [
    ...before,
    ...bondRows.map((row) => ({ ...row, source: "100018_acc_nav" })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

const ndxRows = readOhlc(
  freshest(path.join(SOURCE_ROOT, "nasdaq100_index.csv")),
);
const fxRows = readFx(freshest(path.join(SOURCE_ROOT, "usdcny_fred.csv")));
const proxyRows = makeNdxCnyRows(ndxRows, fxRows).filter(
  (row) => row.date >= "1994-01-01",
);
const gtRows = readOhlc(
  freshest(path.join(SOURCE_ROOT, "price_513100_qfq_tencent.csv")),
);
const gfRows = readOhlc(
  freshest(path.join(SOURCE_ROOT, "price_159941_qfq_tencent.csv")),
);
const bondRows = readClose(
  freshest(path.join(SOURCE_ROOT, "nav_100018.csv")),
  "acc_nav",
);

const data = {
  generatedAt: new Date().toISOString(),
  refreshResults,
  defaults: {
    maLength: 200,
    bufferPct: 6,
    confirmDays: 15,
    highWeightPct: 60,
    lowWeightPct: 0,
    monthlyContribution: 1,
  },
  sources: {
    signal:
      "Selected ETF qfq close; pre-inception uses scaled ^NDX × USD/CNY proxy",
    equity: "513100 / 159941 qfq close with scaled proxy before inception",
    bond: "3% annual proxy before 100018 inception; 100018 accumulated NAV after inception",
  },
  ndx: ndxRows,
  fx: fxRows,
  proxy: proxyRows,
  equity: stitchWithProxy(proxyRows, gtRows),
  equities: [
    {
      code: "513100",
      name: "国泰纳指ETF",
      symbol: "sh513100",
      liveStart: gtRows[0]?.date,
      liveEnd: gtRows.at(-1)?.date,
      rows: stitchWithProxy(proxyRows, gtRows),
    },
    {
      code: "159941",
      name: "广发纳指ETF",
      symbol: "sz159941",
      liveStart: gfRows[0]?.date,
      liveEnd: gfRows.at(-1)?.date,
      rows: stitchWithProxy(proxyRows, gfRows),
    },
  ],
  bond: stitchBondWithProxy(proxyRows, bondRows, 0.03),
};

await writeTextFile(OUT, `window.STRATEGY_DATA = ${JSON.stringify(data)};\n`);
console.log(
  JSON.stringify(
    {
      output: OUT,
      generatedAt: data.generatedAt,
      rows: {
        ndx: data.ndx.length,
        fx: data.fx.length,
        equity: data.equity.length,
        equities: Object.fromEntries(
          data.equities.map((item) => [item.code, item.rows.length]),
        ),
        bond: data.bond.length,
      },
      refreshResults,
    },
    null,
    2,
  ),
);
