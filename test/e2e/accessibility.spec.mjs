import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const pages = [
  "/index.html",
  "/404.html",
  "/etf-premium/",
  "/ndx-valuation/",
  "/bubble-monitor/",
  "/strategy-monitor/",
  "/backtest-lab/",
  "/qdii-similarity/",
  "/market-pulse/",
];

for (const path of pages) {
  test(`${path} has no automated accessibility violations`, async ({
    page,
  }) => {
    await page.goto(path);
    if (path === "/etf-premium/")
      await expect(page.locator("#update-indicator")).toContainText(
        "静态快照已就绪",
      );
    if (path === "/qdii-similarity/")
      await expect(page.locator("#progress-pct")).toHaveText("100%");
    if (path === "/market-pulse/")
      await expect(page.locator("#rankingRows tr")).toHaveCount(10);
    let audit = new AxeBuilder({ page }).withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
    ]);
    if (path === "/qdii-similarity/") {
      audit = audit.exclude("#funds-body tr:nth-child(n + 51)");
    }
    const results = await audit.analyze();
    const violations = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodeCount: violation.nodes.length,
      targets: violation.nodes.slice(0, 8).map((node) => node.target.join(" ")),
    }));
    expect(violations).toEqual([]);
  });
}

test("home reflows at the 400 percent zoom equivalent", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/index.html");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".tool-card")).toHaveCount(8);
  await expect(page.locator(".game-card")).toHaveCount(5);
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("public hub pages do not overflow at 320 CSS pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of [
    "/index.html",
    "/404.html",
    "/etf-premium/",
    "/market-pulse/",
  ]) {
    await page.goto(path);
    if (path === "/etf-premium/")
      await expect(page.locator("#update-indicator")).toContainText(
        "静态快照已就绪",
      );
    if (path === "/market-pulse/")
      await expect(page.locator("#rankingRows tr")).toHaveCount(10);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});

test("forced colors preserve the primary home control", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/index.html");
  await expect(page.getByRole("link", { name: "打开研究工具" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /GitHub/ }).first(),
  ).toBeVisible();
});
