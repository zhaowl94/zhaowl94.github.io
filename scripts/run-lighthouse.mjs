import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import {
  chromeFlagsForEnvironment,
  isWslEnvironment,
  stopProcessAndWait,
} from "./lighthouse-runtime.mjs";
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
const chromeDebuggerTimeout = 30_000;
const confirmationSampleCount = 3;
const maximumLaunchLogCharacters = 4_000;
const chromeProfilePrefix = path.join(
  path.resolve(tmpdir()),
  "zhaowl94-lighthouse-",
);

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

async function getAvailablePort() {
  const portServer = createServer();

  await new Promise((resolve, reject) => {
    const handleError = (error) => reject(error);
    portServer.once("error", handleError);
    portServer.listen(0, "127.0.0.1", () => {
      portServer.off("error", handleError);
      resolve();
    });
  });

  const address = portServer.address();
  if (!address || typeof address === "string") {
    portServer.close();
    throw new Error("Could not reserve a Chromium debugging port.");
  }

  await new Promise((resolve, reject) => {
    portServer.close((error) => (error ? reject(error) : resolve()));
  });

  return address.port;
}

async function waitForChromeDebugger(childProcess, port, getSpawnError) {
  const deadline = Date.now() + chromeDebuggerTimeout;

  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError) {
      throw spawnError;
    }

    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      throw new Error(`Chromium exited before opening debugging port ${port}.`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // Chromium may still be binding its debugging port.
    }

    await delay(200);
  }

  throw new Error(`Timed out waiting for Chromium debugging port ${port}.`);
}

async function launchWslChrome(
  chromePath,
  chromeProfileDirectory,
  chromeFlags,
) {
  if (!chromePath) {
    throw new Error(
      "Playwright Chromium must be installed for Lighthouse inside WSL.",
    );
  }

  const port = await getAvailablePort();
  const childProcess = spawn(
    chromePath,
    [
      ...chromeLauncher.Launcher.defaultFlags(),
      "--disable-setuid-sandbox",
      ...chromeFlags,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${chromeProfileDirectory}`,
      "about:blank",
    ],
    {
      cwd: path.dirname(chromeProfileDirectory),
      detached: true,
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let spawnError;
  let stderrTail = "";

  childProcess.once("error", (error) => {
    spawnError = error;
  });
  childProcess.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-maximumLaunchLogCharacters);
  });

  const kill = () => {
    if (
      !childProcess.pid ||
      childProcess.exitCode !== null ||
      childProcess.signalCode !== null
    ) {
      return;
    }

    try {
      process.kill(-childProcess.pid, "SIGKILL");
    } catch {
      childProcess.kill("SIGKILL");
    }
  };

  try {
    await waitForChromeDebugger(childProcess, port, () => spawnError);
  } catch (error) {
    await stopProcessAndWait(childProcess, kill);
    const stderr = stderrTail.trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      stderr ? `${message}\nChromium stderr:\n${stderr}` : message,
      { cause: error },
    );
  }

  return {
    kill,
    pid: childProcess.pid,
    port,
    process: childProcess,
    remoteDebuggingPipes: null,
  };
}

async function launchChrome(chromePath, chromeProfileDirectory) {
  const chromeFlags = chromeFlagsForEnvironment();
  const isWsl = isWslEnvironment();

  try {
    if (isWsl) {
      return await launchWslChrome(
        chromePath,
        chromeProfileDirectory,
        chromeFlags,
      );
    }

    return await chromeLauncher.launch({
      chromeFlags,
      chromePath,
      logLevel: "error",
      userDataDir: chromeProfileDirectory,
    });
  } catch (error) {
    const errorLog = !isWsl
      ? await readFile(
          path.join(chromeProfileDirectory, "chrome-err.log"),
          "utf8",
        ).catch(() => "")
      : "";
    const boundedErrorLog = errorLog.trim().slice(-maximumLaunchLogCharacters);
    const originalMessage =
      error instanceof Error ? error.message : String(error);
    const diagnostics = [
      `Chromium launch failed: ${originalMessage}`,
      boundedErrorLog
        ? `Chromium stderr (last ${boundedErrorLog.length} characters):\n${boundedErrorLog}`
        : "Chromium stderr log was unavailable.",
    ].join("\n");

    await writeFile(
      path.join(reportDirectory, "chrome-launch-error.log"),
      `${diagnostics}\n`,
    );

    if (error instanceof Error) {
      error.message = diagnostics;
      throw error;
    }

    throw new Error(diagnostics, { cause: error });
  }
}

async function removeChromeProfile(chromeProfileDirectory) {
  if (
    path.dirname(chromeProfileDirectory) !==
      path.dirname(chromeProfilePrefix) ||
    !path
      .basename(chromeProfileDirectory)
      .startsWith(path.basename(chromeProfilePrefix))
  ) {
    throw new Error(
      `Refusing to clean unexpected Chrome profile: ${chromeProfileDirectory}`,
    );
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await rm(chromeProfileDirectory, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 250,
    });
    await delay(250);
  }

  await rm(chromeProfileDirectory, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 250,
  });
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

  const chromeProfileDirectory = await mkdtemp(chromeProfilePrefix);
  let server;
  let chrome;

  try {
    server = startServer();
    await waitForServer(server);

    const bundledChromium = chromium.executablePath();
    chrome = await launchChrome(
      existsSync(bundledChromium) ? bundledChromium : undefined,
      chromeProfileDirectory,
    );

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
    await stopProcessAndWait(chrome?.process, () => chrome?.kill());
    await stopProcessAndWait(server, () => server?.kill());
    try {
      await removeChromeProfile(chromeProfileDirectory);
    } catch (error) {
      console.warn(
        `Could not remove temporary Chrome profile: ${error.message}`,
      );
    }
  }
}

await main();
