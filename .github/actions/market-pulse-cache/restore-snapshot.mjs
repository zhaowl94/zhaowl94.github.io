import { readFile, writeFile } from "node:fs/promises";

const snapshotPath = "market-pulse/data/state.json";
const cacheKey = process.env.MARKET_PULSE_CACHE_KEY;
const publishedUrl = new URL(snapshotPath, "https://zhaowl94.github.io/");
publishedUrl.searchParams.set("t", Date.now());

function getTimestamps(text) {
  const snapshot = JSON.parse(text);
  const market = Date.parse(snapshot.session?.market_timestamp);
  const generated = Date.parse(snapshot.generated_at);
  if (!Number.isFinite(market) || !Number.isFinite(generated)) {
    throw new Error("Invalid Market Pulse snapshot timestamps");
  }
  return { market, generated };
}

async function readPublishedSnapshot() {
  try {
    const response = await fetch(publishedUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return { text, ...getTimestamps(text) };
  } catch (error) {
    if (!cacheKey) {
      throw new Error(
        "Market Pulse cache missed and the published snapshot could not be read",
        {
          cause: error,
        },
      );
    }
    console.warn(
      `Could not read the published snapshot (${error.message}). Using cache ${cacheKey}.`,
    );
    return null;
  }
}

const local = getTimestamps(await readFile(snapshotPath, "utf8"));
const published = await readPublishedSnapshot();
const usePublished =
  published &&
  (published.market > local.market ||
    (published.market === local.market &&
      published.generated > local.generated));
if (usePublished) await writeFile(snapshotPath, published.text, "utf8");

const selected = usePublished ? published : local;
const source = usePublished ? "published site" : cacheKey || "checkout";
console.log(
  `Market Pulse snapshot from ${source}. ` +
    `Market time ${new Date(selected.market).toISOString()}, generated ${new Date(selected.generated).toISOString()}`,
);
