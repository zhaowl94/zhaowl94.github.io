import { defineConfig, devices } from "@playwright/test";

const standardProject = {
  testIgnore: [/file-compat\.spec\.mjs/, /visual\.spec\.mjs/],
};

const chromiumProject = {
  testIgnore: /visual\.spec\.mjs/,
};

export default defineConfig({
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    },
  },
  fullyParallel: true,
  outputDir: "test-results/playwright",
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: "test-results/playwright-report",
      },
    ],
  ],
  retries: 0,
  snapshotPathTemplate: "{testDir}/../snapshots/{arg}{ext}",
  testDir: "test/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run serve",
    reuseExistingServer: true,
    timeout: 30_000,
    url: "http://127.0.0.1:4173",
  },
  projects: [
    {
      name: "chromium",
      ...chromiumProject,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      ...standardProject,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      ...standardProject,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chromium",
      ...standardProject,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "chrome",
      ...standardProject,
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      name: "msedge",
      testIgnore: /visual\.spec\.mjs/,
      use: { ...devices["Desktop Edge"], channel: "msedge" },
    },
    {
      name: "visual",
      testMatch: /visual\.spec\.mjs/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { height: 1_000, width: 1_440 },
      },
    },
  ],
});
