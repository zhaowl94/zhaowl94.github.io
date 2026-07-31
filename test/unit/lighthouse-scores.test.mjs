import assert from "node:assert/strict";
import test from "node:test";
import {
  collectScoreSamples,
  median,
  medianScores,
  scoresMeetThresholds,
} from "../../scripts/lighthouse-scores.mjs";

const thresholds = {
  accessibility: 0.95,
  "best-practices": 0.95,
  performance: 0.95,
  seo: 0.95,
};

test("calculates odd and even medians", () => {
  assert.equal(median([0.93, 0.99, 0.97]), 0.97);
  assert.equal(median([0.9, 1, 0.94, 0.98]), 0.96);
});

test("does not mutate the source array when calculating a median", () => {
  const values = [0.99, 0.93, 0.97];
  median(values);
  assert.deepEqual(values, [0.99, 0.93, 0.97]);
});

test("rejects missing and non-finite median samples", () => {
  assert.throws(() => median([]), TypeError);
  assert.throws(() => median([1, Number.NaN]), TypeError);
});

test("calculates a median for every requested category", () => {
  assert.deepEqual(
    medianScores(
      [
        { accessibility: 1, performance: 0.9 },
        { accessibility: 0.98, performance: 0.98 },
        { accessibility: 0.99, performance: 0.97 },
      ],
      ["accessibility", "performance"],
    ),
    { accessibility: 0.99, performance: 0.97 },
  );
});

test("accepts scores at the threshold and rejects missing categories", () => {
  assert.equal(scoresMeetThresholds(thresholds, thresholds), true);
  assert.equal(scoresMeetThresholds({ accessibility: 1 }, thresholds), false);
});

test("a passing first sample avoids confirmation runs", async () => {
  let calls = 0;
  const result = await collectScoreSamples(async () => {
    calls += 1;
    return {
      accessibility: 1,
      "best-practices": 1,
      performance: 0.99,
      seo: 1,
    };
  }, thresholds);

  assert.equal(calls, 1);
  assert.equal(result.samples.length, 1);
  assert.equal(result.scores.performance, 0.99);
});

test("an initial miss collects three samples and evaluates the median", async () => {
  const performances = [0.94, 0.99, 0.98];
  const result = await collectScoreSamples(
    async (sampleNumber) => ({
      accessibility: 1,
      "best-practices": 1,
      performance: performances[sampleNumber - 1],
      seo: 1,
    }),
    thresholds,
  );

  assert.equal(result.samples.length, 3);
  assert.equal(result.scores.performance, 0.98);
  assert.equal(scoresMeetThresholds(result.scores, thresholds), true);
});

test("a persistent performance regression remains below the budget", async () => {
  const result = await collectScoreSamples(
    async () => ({
      accessibility: 1,
      "best-practices": 1,
      performance: 0.9,
      seo: 1,
    }),
    thresholds,
  );

  assert.equal(result.samples.length, 3);
  assert.equal(result.scores.performance, 0.9);
  assert.equal(scoresMeetThresholds(result.scores, thresholds), false);
});
