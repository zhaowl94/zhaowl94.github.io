import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const requiredFiles = [
  ".nojekyll",
  "404.html",
  "assets/images/favicon.svg",
  "assets/images/social-preview.png",
  "assets/scripts/site.js",
  "assets/styles/site.css",
  "index.html",
  "robots.txt",
  "sitemap.xml",
];
const criticalFiles = [
  "index.html",
  "assets/styles/site.css",
  "assets/scripts/site.js",
  "assets/images/favicon.svg",
];
const projectOrder = [
  "ttjjCrawler",
  "ReadWechatMessage",
  "yuanshen",
  "html_sample",
  "ProcessSqlData-TS",
];
const criticalBudget = 200 * 1024;

function localReferences(html) {
  const references = [];
  const attributePattern = /\b(?:href|src)="([^"]+)"/gu;

  for (const match of html.matchAll(attributePattern)) {
    const reference = match[1];
    if (
      reference.startsWith("#") ||
      reference.startsWith("http://") ||
      reference.startsWith("https://") ||
      reference.startsWith("data:")
    ) {
      continue;
    }

    const withoutFragment = reference.split("#", 1)[0].split("?", 1)[0];
    if (withoutFragment) {
      references.push(decodeURIComponent(withoutFragment));
    }
  }

  return references;
}

async function assertRequiredFiles() {
  for (const relativePath of requiredFiles) {
    await access(path.join(projectRoot, relativePath));
  }
}

async function assertLocalReferences(relativePage) {
  const absolutePage = path.join(projectRoot, relativePage);
  const html = await readFile(absolutePage, "utf8");

  for (const reference of localReferences(html)) {
    await access(path.resolve(path.dirname(absolutePage), reference));
  }

  return html;
}

function assertProjectOrder(html) {
  let previousPosition = -1;

  for (const project of projectOrder) {
    const position = html.indexOf(`<h3>${project}</h3>`);
    if (position < 0 || position <= previousPosition) {
      throw new Error(`Project order is invalid at ${project}.`);
    }
    previousPosition = position;
  }
}

function assertSafeMarkup(indexHtml, notFoundHtml, browserScript) {
  const combinedHtml = `${indexHtml}\n${notFoundHtml}`;
  const forbiddenMarkup = [
    [/<form\b/iu, "forms"],
    [/<iframe\b/iu, "iframes"],
    [/\btarget="_blank"/iu, "forced new tabs"],
    [/<script[^>]+src="https?:/iu, "remote scripts"],
    [/<link[^>]+href="https?:[^>]+stylesheet/iu, "remote stylesheets"],
  ];

  for (const [pattern, label] of forbiddenMarkup) {
    if (pattern.test(combinedHtml)) {
      throw new Error(`Public HTML unexpectedly contains ${label}.`);
    }
  }

  const forbiddenBrowserApis = [
    "document.cookie",
    "localStorage",
    "sessionStorage",
    "XMLHttpRequest",
    "WebSocket",
    "fetch(",
  ];

  for (const api of forbiddenBrowserApis) {
    if (browserScript.includes(api)) {
      throw new Error(`Browser script unexpectedly uses ${api}.`);
    }
  }

  if ((indexHtml.match(/class="project-card/gu) ?? []).length !== 5) {
    throw new Error("The home page must contain exactly five project cards.");
  }

  if (!indexHtml.includes('content="index, follow"')) {
    throw new Error("The home page must remain indexable.");
  }

  if (!notFoundHtml.includes('content="noindex, follow"')) {
    throw new Error("The 404 page must remain excluded from search results.");
  }
}

function assertStructuredData(html) {
  const match = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/u,
  );

  if (!match) {
    throw new Error("The home page is missing JSON-LD structured data.");
  }

  const structuredData = JSON.parse(match[1]);
  if (
    structuredData["@type"] !== "ProfilePage" ||
    structuredData.hasPart?.itemListElement?.length !== 5
  ) {
    throw new Error("JSON-LD does not describe the five-project profile.");
  }
}

async function criticalPayloadSize() {
  let total = 0;

  for (const relativePath of criticalFiles) {
    total += (await stat(path.join(projectRoot, relativePath))).size;
  }

  if (total > criticalBudget) {
    throw new Error(
      `Critical payload ${total} bytes exceeds ${criticalBudget} bytes.`,
    );
  }

  return total;
}

await assertRequiredFiles();
const [indexHtml, notFoundHtml, browserScript, robots, sitemap] =
  await Promise.all([
    assertLocalReferences("index.html"),
    assertLocalReferences("404.html"),
    readFile(path.join(projectRoot, "assets/scripts/site.js"), "utf8"),
    readFile(path.join(projectRoot, "robots.txt"), "utf8"),
    readFile(path.join(projectRoot, "sitemap.xml"), "utf8"),
  ]);

assertProjectOrder(indexHtml);
assertSafeMarkup(indexHtml, notFoundHtml, browserScript);
assertStructuredData(indexHtml);

if (
  !robots.includes("https://zhaowl94.github.io/sitemap.xml") ||
  !sitemap.includes("<loc>https://zhaowl94.github.io/</loc>")
) {
  throw new Error("robots.txt and sitemap.xml are not aligned.");
}

const payload = await criticalPayloadSize();
console.log(
  `Static checks passed: ${requiredFiles.length} required files, ` +
    `5 ordered projects, ${payload} critical bytes.`,
);
