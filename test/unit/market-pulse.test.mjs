import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const snapshot = JSON.parse(
  await readFile(path.join(root, "market-pulse/data/state.json"), "utf8"),
);
const generator = await readFile(
  path.join(root, "scripts/update-market-pulse-data.py"),
  "utf8",
);

test("Market Pulse publishes a deterministic and complete snapshot", () => {
  assert.equal(snapshot.method.model_used, false);
  assert.equal(snapshot.top10.length, 10);
  assert.equal(snapshot.indices.length, 2);
  assert.ok(snapshot.candidate_count >= 60);
  assert.ok(snapshot.universe_count >= snapshot.candidate_count);
  assert.ok(snapshot.sources.length >= 3);
});

test("Market Pulse public payload omits the raw quote and holdings universes", () => {
  assert.equal(Object.hasOwn(snapshot, "quotes"), false);
  assert.equal(Object.hasOwn(snapshot, "holdings"), false);
});

test("Market Pulse generator has no model client or secret dependency", () => {
  for (const forbidden of [
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "os.environ",
    "import openai",
  ]) {
    assert.equal(generator.includes(forbidden), false, forbidden);
  }
});
