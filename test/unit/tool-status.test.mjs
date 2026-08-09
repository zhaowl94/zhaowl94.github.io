import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const status = JSON.parse(
  await readFile(path.join(root, "data/tool-status.json"), "utf8"),
);
const siteScript = await readFile(
  path.join(root, "assets/scripts/site.js"),
  "utf8",
);

test("home status enumerates the six public tools", () => {
  assert.deepEqual(Object.keys(status.tools).sort(), [
    "backtest-lab",
    "bubble-monitor",
    "etf-premium",
    "ndx-valuation",
    "qdii-similarity",
    "strategy-monitor",
  ]);
});

test("home status has a valid publication timestamp", () => {
  assert.equal(Number.isNaN(new Date(status.generatedAt).getTime()), false);
});

test("home script does not persist or identify visitors", () => {
  for (const forbidden of [
    "document.cookie",
    "localStorage",
    "sessionStorage",
    "WebSocket",
  ]) {
    assert.equal(siteScript.includes(forbidden), false);
  }
});
