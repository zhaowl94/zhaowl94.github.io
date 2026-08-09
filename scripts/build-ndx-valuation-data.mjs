import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptsDirectory, "..");
const source = path.join(
  scriptsDirectory,
  "research-data",
  "nasdaq100_index.csv",
);
const output = path.join(siteRoot, "ndx-valuation", "data.js");

const lines = fs
  .readFileSync(source, "utf8")
  .replace(/^\uFEFF/u, "")
  .trim()
  .split(/\r?\n/u);
const headers = lines
  .shift()
  .split(",")
  .map((value) => value.trim().toLowerCase());
const dateIndex = headers.indexOf("date");
const closeIndex = headers.indexOf("close");
if (dateIndex < 0 || closeIndex < 0)
  throw new Error("NDX CSV needs date and close columns");

const rows = lines
  .map((line) => line.split(","))
  .map((parts) => ({
    date: parts[dateIndex],
    close: Number(parts[closeIndex]),
  }))
  .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
  .sort((left, right) => left.date.localeCompare(right.date));

if (rows.length < 260)
  throw new Error(`NDX history is too short: ${rows.length}`);
const payload = {
  generatedAt: new Date().toISOString(),
  dates: rows.map((row) => row.date),
  closes: rows.map((row) => row.close),
};
fs.writeFileSync(
  output,
  `window.RAW_NDX = ${JSON.stringify(payload)};\n`,
  "utf8",
);
console.log(
  JSON.stringify({ output, rows: rows.length, lastDate: rows.at(-1).date }),
);
