import { expect, test } from "@playwright/test";

const expectedProjects = [
  "ttjjCrawler",
  "ReadWechatMessage",
  "yuanshen",
  "html_sample",
  "ProcessSqlData-TS",
];

test("Chinese home page presents the agreed portfolio structure", async ({
  page,
}) => {
  await page.goto("/index.html");

  await expect(page).toHaveTitle("zhaowl94 · 可验证、可迁移的开源工具");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /把遗留脚本变成/,
    }),
  ).toBeVisible();
  await expect(page.locator(".capability-card")).toHaveCount(3);
  await expect(page.locator(".project-card")).toHaveCount(5);
  await expect(page.locator(".principle-grid article")).toHaveCount(3);
});

test("projects remain in the approved evidence-first order", async ({
  page,
}) => {
  await page.goto("/index.html");

  await expect(page.locator(".project-body h3")).toHaveText(expectedProjects);
  await expect(page.locator(".project-card").first()).toContainText("v1.0.0");
  await expect(page.locator(".project-card").last()).toContainText(
    "迁移与安全框架",
  );
});

test("English is shareable and updates metadata without storage", async ({
  page,
}) => {
  await page.goto("/index.html");
  await page.getByRole("link", { name: "EN" }).click();

  await expect(page).toHaveURL(/\?lang=en$/u);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle(
    "zhaowl94 · Verifiable, portable open-source tools",
  );
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /Turning legacy scripts/,
    }),
  ).toBeVisible();
  await expect(page.getByText("把遗留脚本变成", { exact: false })).toBeHidden();
  await expect(page.evaluate(() => document.cookie)).resolves.toBe("");
  await expect(page.evaluate(() => localStorage.length)).resolves.toBe(0);
});

test("browser history restores language state", async ({ page }) => {
  await page.goto("/index.html?lang=zh");
  await page.getByRole("link", { name: "EN" }).click();
  await page.getByRole("link", { name: "中" }).click();
  await page.goBack();

  await expect(page).toHaveURL(/\?lang=en$/u);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("the page loads no third-party runtime resources", async ({ page }) => {
  await page.goto("/index.html");

  const resourceUrls = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => url.startsWith("http")),
  );

  expect(resourceUrls).not.toHaveLength(0);
  expect(
    resourceUrls.every(
      (url) => new URL(url).origin === "http://127.0.0.1:4173",
    ),
  ).toBe(true);
  await expect(page.locator("form, iframe")).toHaveCount(0);
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
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
});

test("dark color scheme uses the dark paper token", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/index.html");

  const backgroundColor = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--paper")
      .trim(),
  );
  expect(backgroundColor).toBe("#121210");
});

test("404 page never redirects and provides explicit exits", async ({
  page,
}) => {
  await page.goto("/404.html?lang=en");

  await expect(page).toHaveURL("/404.html?lang=en");
  await expect(page).toHaveTitle("Page not found · zhaowl94");
  await expect(
    page.getByRole("heading", { level: 1, name: "This path ends here." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Return home/ })).toHaveAttribute(
    "href",
    "./index.html",
  );
});

test("home and 404 pages load without console or script errors", async ({
  page,
}) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/index.html");
  await page.goto("/404.html");
  expect(errors).toEqual([]);
});
