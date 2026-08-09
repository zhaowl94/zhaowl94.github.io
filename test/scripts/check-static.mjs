import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const existingResearchRoutes = [
  "etf-premium",
  "ndx-valuation",
  "bubble-monitor",
  "strategy-monitor",
  "backtest-lab",
  "qdii-similarity",
  "market-pulse",
];
const researchRoutes = [...existingResearchRoutes, "ndx100-dashboard"];
const gameRoutes = [
  "doudizhu",
  "guandan",
  "tank-battle",
  "auction-king",
  "cultivation",
];
const publicRoutes = [...researchRoutes, ...gameRoutes];
const requiredFiles = [
  ".nojekyll",
  "404.html",
  "assets/images/favicon.svg",
  "assets/images/social-preview.png",
  "assets/scripts/site.js",
  "assets/styles/site.css",
  "assets/styles/tool-shell.css",
  "data/tool-status.json",
  "index.html",
  "robots.txt",
  "sitemap.xml",
  ...existingResearchRoutes.flatMap((route) => [
    `${route}/index.html`,
    `${route}/app.js`,
    `${route}/styles.css`,
  ]),
  "ndx100-dashboard/index.html",
  "ndx100-dashboard/app.js",
  "ndx100-dashboard/style.css",
  "ndx100-dashboard/vendor/echarts.min.js",
  "ndx100-dashboard/data/meta.json",
  "ndx100-dashboard/data/quotes.json",
  "doudizhu/index.html",
  "guandan/index.html",
  "guandan/game.js",
  "guandan/ui.js",
  "guandan/style.css",
  "tank-battle/index.html",
  "auction-king/index.html",
  "cultivation/index.html",
  "etf-premium/data/dashboard.json",
  "etf-premium/vendor/chart.umd.min.js",
  "ndx-valuation/data.js",
  "bubble-monitor/bubble_data.json",
  "strategy-monitor/strategy_data.js",
  "backtest-lab/backtest_lab_data.js",
  "qdii-similarity/data/dashboard.json",
  "market-pulse/data/state.json",
];
const criticalFiles = [
  "index.html",
  "assets/styles/site.css",
  "assets/scripts/site.js",
  "assets/images/favicon.svg",
];
const criticalBudget = 250 * 1024;

function localReferences(html) {
  const references = [];
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/gu)) {
    const reference = match[1];
    if (
      reference.startsWith("#") ||
      reference.startsWith("http://") ||
      reference.startsWith("https://") ||
      reference.startsWith("data:")
    )
      continue;
    const withoutFragment = reference.split("#", 1)[0].split("?", 1)[0];
    if (withoutFragment) references.push(decodeURIComponent(withoutFragment));
  }
  return references;
}

async function assertRequiredFiles() {
  for (const relativePath of requiredFiles)
    await access(path.join(projectRoot, relativePath));
}

async function assertLocalReferences(relativePage) {
  const absolutePage = path.join(projectRoot, relativePage);
  const html = await readFile(absolutePage, "utf8");
  for (const reference of localReferences(html)) {
    await access(path.resolve(path.dirname(absolutePage), reference));
  }
  return html;
}

function assertSafeRuntimeMarkup(pages) {
  const combinedHtml = pages.join("\n");
  const forbidden = [
    [/<iframe\b/iu, "iframes"],
    [/\btarget="_blank"/iu, "forced new tabs"],
    [/<script[^>]+src="https?:/iu, "remote scripts"],
    [/<link[^>]+href="https?:[^>]+stylesheet/iu, "remote stylesheets"],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(combinedHtml))
      throw new Error(`Public HTML unexpectedly contains ${label}.`);
  }
}

function assertHomeStructure(html) {
  if ((html.match(/class="tool-card(?:\s|"|$)/gu) ?? []).length !== 8) {
    throw new Error("The home page must contain exactly eight research cards.");
  }
  if ((html.match(/class="game-card(?:\s|"|$)/gu) ?? []).length !== 5) {
    throw new Error("The home page must contain exactly five game cards.");
  }
  for (const route of publicRoutes) {
    if (!html.includes(`href="${route}/"`))
      throw new Error(`Home page is missing ${route}/.`);
  }
  if (!html.includes('content="index, follow"'))
    throw new Error("The home page must remain indexable.");
}

function assertStructuredData(html) {
  const match = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/u,
  );
  if (!match)
    throw new Error("The home page is missing JSON-LD structured data.");
  const data = JSON.parse(match[1]);
  if (
    data["@type"] !== "CollectionPage" ||
    data.mainEntity?.numberOfItems !== 13 ||
    data.mainEntity?.itemListElement?.length !== 13
  ) {
    throw new Error("JSON-LD does not describe the 13-page collection.");
  }
}

async function criticalPayloadSize() {
  let total = 0;
  for (const relativePath of criticalFiles)
    total += (await stat(path.join(projectRoot, relativePath))).size;
  if (total > criticalBudget)
    throw new Error(
      `Critical payload ${total} bytes exceeds ${criticalBudget} bytes.`,
    );
  return total;
}

await assertRequiredFiles();
const pagePaths = [
  "index.html",
  "404.html",
  ...publicRoutes.map((route) => `${route}/index.html`),
];
const pages = await Promise.all(pagePaths.map(assertLocalReferences));
const [indexHtml, notFoundHtml] = pages;
const [robots, sitemap] = await Promise.all([
  readFile(path.join(projectRoot, "robots.txt"), "utf8"),
  readFile(path.join(projectRoot, "sitemap.xml"), "utf8"),
]);

assertSafeRuntimeMarkup(pages);
assertHomeStructure(indexHtml);
assertStructuredData(indexHtml);
if (!notFoundHtml.includes('content="noindex, follow"'))
  throw new Error("The 404 page must remain noindex.");
if (!robots.includes("https://zhaowl94.github.io/sitemap.xml"))
  throw new Error("robots.txt is missing the sitemap.");
for (const route of ["", ...publicRoutes.map((item) => `${item}/`)]) {
  if (!sitemap.includes(`<loc>https://zhaowl94.github.io/${route}</loc>`))
    throw new Error(`sitemap.xml is missing /${route}`);
}

const payload = await criticalPayloadSize();
console.log(
  `Static checks passed: ${researchRoutes.length} research tools, ${gameRoutes.length} games, ${requiredFiles.length} required files, ${payload} critical bytes.`,
);
