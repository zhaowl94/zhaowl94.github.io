import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { collectScoreSamples } from "./lighthouse-scores.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const testResultsDirectory = path.join(projectRoot, "test-results");
const reportDirectory = path.join(testResultsDirectory, "lighthouse");
const serverScript = path.join(
  projectRoot,
  "node_modules",
  "http-server",
  "bin",
  "http-server",
);
const baseUrl = "http://127.0.0.1:4173";
const pages = [
  { name: "home-zh", path: "/index.html?lang=zh" },
  { name: "home-en", path: "/index.html?lang=en" },
];
const thresholds = {
  accessibility: 0.95,
  "best-practices": 0.95,
  performance: 0.95,
  seo: 0.95,
};
const auditTimeout = 90_000;
const confirmationSampleCount = 3;

function startServer() {
  return spawn(
    process.execPath,
    [serverScript, projectRoot, "-p", "4173", "-c-1", "--silent"],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
}

async function waitForServer(server) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Static server exited before becoming ready (code ${server.exitCode}).`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/index.html`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server may still be binding its port.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }

  throw new Error("Timed out while waiting for the Lighthouse test server.");
}

async function runAudit(url, chromePort) {
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(`Lighthouse audit timed out after ${auditTimeout}ms: ${url}`),
      );
    }, auditTimeout);
  });
  let result;

  try {
    result = await Promise.race([
      lighthouse(url, {
        logLevel: "error",
        onlyCategories: Object.keys(thresholds),
        output: ["html", "json"],
        port: chromePort,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!result) {
    throw new Error(`Lighthouse did not return a report for ${url}.`);
  }

  return result;
}

function scoresFor(lhr) {
  return Object.fromEntries(
    Object.keys(thresholds).map((category) => [
      category,
      lhr.categories[category]?.score ?? 0,
    ]),
  );
}

async function runAndSaveAudit(url, chromePort, name, sampleNumber) {
  console.log(`${url}: starting Lighthouse sample ${sampleNumber}`);
  const result = await runAudit(url, chromePort);
  const [htmlReport, jsonReport] = result.report;
  const suffix = sampleNumber === 1 ? "" : `.sample-${sampleNumber}`;

  await Promise.all([
    writeFile(
      path.join(reportDirectory, `${name}${suffix}.report.html`),
      htmlReport,
    ),
    writeFile(
      path.join(reportDirectory, `${name}${suffix}.report.json`),
      jsonReport,
    ),
  ]);

  return scoresFor(result.lhr);
}

async function main() {
  if (
    path.dirname(reportDirectory) !== testResultsDirectory ||
    path.basename(reportDirectory) !== "lighthouse"
  ) {
    throw new Error(`Refusing to clean unexpected path: ${reportDirectory}`);
  }

  await rm(reportDirectory, { force: true, recursive: true });
  await mkdir(reportDirectory, { recursive: true });

  const server = startServer();
  const chromeProfileDirectory = path.join(
    reportDirectory,
    `chrome-profile-${process.pid}`,
  );
  let chrome;

  try {
    await waitForServer(server);
    await mkdir(chromeProfileDirectory, { recursive: true });

    const bundledChromium = chromium.executablePath();
    chrome = await chromeLauncher.launch({
      chromeFlags: ["--headless=new", "--disable-gpu"],
      chromePath: existsSync(bundledChromium) ? bundledChromium : undefined,
      logLevel: "error",
      userDataDir: chromeProfileDirectory,
    });

    const summary = {};
    const failures = [];

    for (const page of pages) {
      const url = `${baseUrl}${page.path}`;
      const { samples, scores } = await collectScoreSamples(
        (sampleNumber) =>
          runAndSaveAudit(url, chrome.port, page.name, sampleNumber),
        thresholds,
        confirmationSampleCount,
      );
      summary[page.path] = { samples, scores };

      for (const [category, minimum] of Object.entries(thresholds)) {
        if (scores[category] < minimum) {
          failures.push(
            `${page.path}: ${category} ${scores[category].toFixed(2)} < ${minimum.toFixed(2)}`,
          );
        }
      }
    }

    await writeFile(
      path.join(reportDirectory, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );

    for (const [pagePath, { samples, scores }] of Object.entries(summary)) {
      const formatted = Object.entries(scores)
        .map(([category, score]) => `${category}=${score.toFixed(2)}`)
        .join(", ");
      const sampleNote =
        samples.length === 1
          ? ""
          : `; median of ${samples.length} samples (${samples
              .map((sample) => sample.performance.toFixed(2))
              .join(", ")} performance)`;
      console.log(`${pagePath}: ${formatted}${sampleNote}`);
    }

    if (failures.length > 0) {
      throw new Error(`Lighthouse budgets failed:\n${failures.join("\n")}`);
    }
  } finally {
    chrome?.kill();
    server.kill();
    await delay(250);
    try {
      await rm(chromeProfileDirectory, {
        force: true,
        maxRetries: 10,
        recursive: true,
        retryDelay: 250,
      });
    } catch (error) {
      console.warn(
        `Could not remove temporary Chrome profile: ${error.message}`,
      );
    }
  }
}

await main();
