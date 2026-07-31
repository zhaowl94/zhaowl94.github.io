import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const publicFiles = ["index.html", "404.html", "robots.txt", "sitemap.xml"];
const maximumAttempts = 3;
const deploymentOrigin = "https://zhaowl94.github.io";

function collectUrls(content) {
  const urls = new Set();
  const patterns = [
    /\b(?:href|content)="(https:\/\/[^"]+)"/gu,
    /<loc>(https:\/\/[^<]+)<\/loc>/gu,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      urls.add(match[1]);
    }
  }

  return urls;
}

async function checkUrl(url) {
  let finalError;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      let response = await fetch(url, {
        headers: { "user-agent": "zhaowl94-portfolio-link-check/1.0" },
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
      });

      if (response.status === 403 || response.status === 405) {
        response = await fetch(url, {
          headers: {
            range: "bytes=0-0",
            "user-agent": "zhaowl94-portfolio-link-check/1.0",
          },
          redirect: "follow",
          signal: controller.signal,
        });
      }

      if (response.status >= 200 && response.status < 400) {
        return response.status;
      }

      finalError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      finalError = error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maximumAttempts) {
      await delay(attempt * 750);
    }
  }

  throw new Error(`${url}: ${finalError?.message ?? "request failed"}`);
}

function localDeploymentPath(url) {
  const parsedUrl = new URL(url);

  if (
    parsedUrl.origin !== deploymentOrigin ||
    parsedUrl.pathname.startsWith("/html_sample/")
  ) {
    return null;
  }

  const relativePath =
    parsedUrl.pathname === "/"
      ? "index.html"
      : decodeURIComponent(parsedUrl.pathname.slice(1));
  return path.join(projectRoot, relativePath);
}

const contents = await Promise.all(
  publicFiles.map((file) => readFile(path.join(projectRoot, file), "utf8")),
);
const urls = new Set(contents.flatMap((content) => [...collectUrls(content)]));
const failures = [];

for (const url of [...urls].sort()) {
  try {
    const localPath = localDeploymentPath(url);
    if (localPath) {
      await access(localPath);
      console.log(`LOCAL ${url}`);
      continue;
    }

    const status = await checkUrl(url);
    console.log(`${status} ${url}`);
  } catch (error) {
    failures.push(error.message);
  }
}

if (failures.length > 0) {
  throw new Error(`External link checks failed:\n${failures.join("\n")}`);
}

console.log(`External link checks passed: ${urls.size} URLs.`);
