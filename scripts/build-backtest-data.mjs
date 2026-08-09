import fs from "node:fs";
import path from "node:path";

const HERE = path
  .dirname(new URL(import.meta.url).pathname)
  .replace(/^\/([A-Za-z]:)/, "$1");
const SITE_ROOT = path.resolve(HERE, "..");
const SOURCE_ROOT = path.join(HERE, "research-data");
const OUT = path.join(SITE_ROOT, "backtest-lab", "backtest_lab_data.js");
const REFRESH = process.argv.includes("--refresh");

function normalizeDate(raw) {
  const parts = String(raw).trim().split(/[/-]/);
  if (parts.length !== 3) return String(raw).trim();
  return `${parts[0].padStart(4, "0")}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",");
  return lines
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",");
      const row = {};
      headers.forEach((header, index) => {
        row[header] = parts[index];
      });
      if (row.date) row.date = normalizeDate(row.date);
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
        [row.open, row.high, row.low, row.close].every(Number.isFinite),
    );
}

function readClose(file, valueCol) {
  return readCsv(file)
    .map((row) => ({ date: row.date, close: Number(row[valueCol]) }))
    .filter((row) => row.date && Number.isFinite(row.close));
}

function extendCloseWithProxy(baseRows, proxyRows) {
  const rows = baseRows.map((row) => ({ ...row }));
  if (rows.length < 2 || proxyRows.length < 2) return rows;
  const proxyByDate = new Map(proxyRows.map((row) => [row.date, row]));
  let last = rows.at(-1);
  let lastProxy = proxyByDate.get(last.date);
  if (!lastProxy) return rows;
  for (const proxy of proxyRows.filter((row) => row.date > last.date)) {
    const ratio = proxy.close / lastProxy.close;
    last = { date: proxy.date, close: last.close * ratio };
    rows.push(last);
    lastProxy = proxy;
  }
  return rows;
}

function readFundJs(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const match = text.match(/var Data_ACWorthTrend = (\[.*?\]);/s);
  if (!match) throw new Error(`Data_ACWorthTrend not found in ${file}`);
  return JSON.parse(match[1])
    .filter((row) => row[1] != null)
    .map((row) => ({
      date: new Date(row[0]).toISOString().slice(0, 10),
      close: Number(row[1]),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return await res.text();
}

async function refreshSources() {
  const nowSec = Math.floor(Date.now() / 1000);
  const ndxUrl = `https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?period1=497021400&period2=${nowSec}&interval=1d&events=history`;
  const ndxJson = JSON.parse(await fetchText(ndxUrl));
  const result = ndxJson.chart.result[0];
  const quote = result.indicators.quote[0];
  const ndxRows = ["date,open,high,low,close"];
  for (let i = 0; i < result.timestamp.length; i++) {
    const close = quote.close[i];
    if (close == null) continue;
    const date = new Date(result.timestamp[i] * 1000)
      .toISOString()
      .slice(0, 10);
    ndxRows.push(
      [date, quote.open[i], quote.high[i], quote.low[i], close].join(","),
    );
  }
  fs.writeFileSync(
    path.join(SOURCE_ROOT, "nasdaq100_index.csv"),
    ndxRows.join("\n") + "\n",
    "utf8",
  );

  try {
    const qfq = await fetchTencentQfqFull("sh513100", "2013-05-01");
    const qfqRows = ["date,open,high,low,close"];
    for (const r of qfq) qfqRows.push([r[0], r[1], r[3], r[4], r[2]].join(","));
    fs.writeFileSync(
      path.join(SOURCE_ROOT, "price_513100_qfq_tencent.csv"),
      qfqRows.join("\n") + "\n",
      "utf8",
    );
  } catch (error) {
    console.warn(`513100场内价格刷新失败，保留本地旧数据：${error.message}`);
  }

  const js513100 = await fetchText(
    "https://fund.eastmoney.com/pingzhongdata/513100.js",
  );
  fs.writeFileSync(
    path.join(SOURCE_ROOT, "pingzhongdata_513100.js"),
    js513100,
    "utf8",
  );

  const js100018 = await fetchText(
    "https://fund.eastmoney.com/pingzhongdata/100018.js",
  );
  const match = js100018.match(/var Data_ACWorthTrend = (\[.*?\]);/s);
  if (match) {
    const rows = JSON.parse(match[1]).map((r) => {
      const date = new Date(r[0]).toISOString().slice(0, 10);
      return `${date},${r[1]}`;
    });
    fs.writeFileSync(
      path.join(SOURCE_ROOT, "nav_100018.csv"),
      "date,acc_nav\n" + rows.join("\n") + "\n",
      "utf8",
    );
  }
}

async function fetchTencentQfqFull(symbol, minDate) {
  const rows = new Map();
  let end = new Date().toISOString().slice(0, 10);
  for (let round = 0; round < 12; round++) {
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

if (REFRESH) {
  await refreshSources();
}

const ndxPriceRows = readOhlc(path.join(SOURCE_ROOT, "nasdaq100_index.csv"));
const cnyReturnRows = extendCloseWithProxy(
  readClose(
    path.join(SOURCE_ROOT, "ndx_synthetic_cny_total_return_inception.csv"),
    "cny_total_return_index",
  ),
  ndxPriceRows,
);

const data = {
  generatedAt: new Date().toISOString(),
  datasets: {
    inceptionCny: {
      label: "全周期：人民币计价纳指100收益 + 4%债券代理",
      equityLabel: "人民币计价纳指100全收益/代理",
      bondLabel: "4%年化债券代理",
      equity: cnyReturnRows,
      signals: {
        ndxPrice: { label: "^NDX价格信号", rows: ndxPriceRows },
        cnyTotalReturn: { label: "人民币全收益信号", rows: cnyReturnRows },
      },
      bondProxyAnnualReturn: 0.04,
    },
    liveQfq: {
      label: "实盘：513100场内前复权收益 + 富国天利A",
      equityLabel: "513100场内前复权价格",
      bondLabel: "100018 富国天利A累计净值",
      equity: readOhlc(path.join(SOURCE_ROOT, "price_513100_qfq_tencent.csv")),
      bond: readClose(path.join(SOURCE_ROOT, "nav_100018.csv"), "acc_nav"),
      signals: {
        ndxPrice: {
          label: "^NDX价格信号",
          rows: readOhlc(path.join(SOURCE_ROOT, "nasdaq100_index.csv")),
        },
        nav513100: {
          label: "513100基金净值信号",
          rows: readFundJs(path.join(SOURCE_ROOT, "pingzhongdata_513100.js")),
        },
        qfqPrice: {
          label: "513100场内前复权信号",
          rows: readOhlc(
            path.join(SOURCE_ROOT, "price_513100_qfq_tencent.csv"),
          ),
        },
      },
    },
  },
};

fs.writeFileSync(
  OUT,
  `window.BACKTEST_DATA = ${JSON.stringify(data)};\n`,
  "utf8",
);
console.log(
  JSON.stringify(
    {
      output: OUT,
      generatedAt: data.generatedAt,
      inceptionRows: data.datasets.inceptionCny.equity.length,
      liveRows: data.datasets.liveQfq.equity.length,
    },
    null,
    2,
  ),
);
