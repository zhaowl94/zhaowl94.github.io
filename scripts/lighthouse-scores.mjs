export function median(values) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new TypeError("Median requires a non-empty array of finite numbers.");
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }

  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function medianScores(samples, categories) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new TypeError("At least one Lighthouse score sample is required.");
  }

  return Object.fromEntries(
    categories.map((category) => [
      category,
      median(samples.map((sample) => sample[category] ?? 0)),
    ]),
  );
}

export function scoresMeetThresholds(scores, thresholds) {
  return Object.entries(thresholds).every(
    ([category, minimum]) =>
      Number.isFinite(scores[category]) && scores[category] >= minimum,
  );
}

export async function collectScoreSamples(
  collectSample,
  thresholds,
  confirmationSampleCount = 3,
) {
  if (
    typeof collectSample !== "function" ||
    !Number.isInteger(confirmationSampleCount) ||
    confirmationSampleCount < 1
  ) {
    throw new TypeError(
      "A collector and a positive sample count are required.",
    );
  }

  const samples = [await collectSample(1)];

  if (!scoresMeetThresholds(samples[0], thresholds)) {
    for (
      let sampleNumber = 2;
      sampleNumber <= confirmationSampleCount;
      sampleNumber += 1
    ) {
      samples.push(await collectSample(sampleNumber));
    }
  }

  return {
    samples,
    scores: medianScores(samples, Object.keys(thresholds)),
  };
}
