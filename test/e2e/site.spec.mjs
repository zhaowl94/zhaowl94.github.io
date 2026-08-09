import { expect, test } from "@playwright/test";

const toolRoutes = [
  "etf-premium",
  "ndx-valuation",
  "bubble-monitor",
  "strategy-monitor",
  "backtest-lab",
  "qdii-similarity",
];

test("home page presents the six-tool research desk", async ({ page }) => {
  await page.goto("/index.html");

  await expect(page).toHaveTitle("zhaowl94 · 市场研究工具台");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { level: 1, name: /把市场噪音/ }),
  ).toBeVisible();
  await expect(page.locator(".tool-card")).toHaveCount(6);
  await expect(page.locator(".project-list a")).toHaveCount(5);
  await expect(page.locator("#site-updated")).not.toContainText("正在读取");
});

test("every research tool is directly linked from home", async ({ page }) => {
  await page.goto("/index.html");
  for (const route of toolRoutes) {
    await expect(page.locator(`.tool-card[href="${route}/"]`)).toHaveCount(1);
  }
});

test("home page loads no third-party runtime resources or browser storage", async ({
  page,
}) => {
  await page.goto("/index.html");
  const state = await page.evaluate(() => ({
    cookie: document.cookie,
    localStorageLength: localStorage.length,
    resourceUrls: performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => url.startsWith("http")),
  }));
  expect(state.cookie).toBe("");
  expect(state.localStorageLength).toBe(0);
  expect(state.resourceUrls.length).toBeGreaterThan(0);
  expect(
    state.resourceUrls.every(
      (url) => new URL(url).origin === "http://127.0.0.1:4173",
    ),
  ).toBe(true);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
});

test("skip link moves keyboard focus to main content", async ({ page }) => {
  await page.goto("/index.html");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/u);
});

test("reduced motion disables meaningful transition duration", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/index.html");
  const duration = await page
    .locator(".button")
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001);
});

test("dark color scheme uses the research-desk dark token", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/index.html");
  const background = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--paper")
      .trim(),
  );
  expect(background).toBe("#101512");
});

test("404 page provides explicit exits without redirecting", async ({
  page,
}) => {
  await page.goto("/404.html");
  await expect(page).toHaveURL("/404.html");
  await expect(page).toHaveTitle("页面未找到 · zhaowl94");
  await expect(
    page.getByRole("heading", { level: 1, name: /研究路径/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "返回研究工具台" }),
  ).toHaveAttribute("href", "./index.html");
});

test("home and 404 pages load without console or script errors", async ({
  page,
}) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/index.html");
  await page.goto("/404.html");
  expect(errors).toEqual([]);
});
