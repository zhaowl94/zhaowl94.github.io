import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Axe can exceed the default timeout during a cold Firefox start on Windows CI.
test.describe.configure({ timeout: 60_000 });

const pages = [
  "/index.html?lang=zh",
  "/index.html?lang=en",
  "/404.html?lang=zh",
  "/404.html?lang=en",
];

for (const path of pages) {
  test(`${path} has no automated accessibility violations`, async ({
    page,
  }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

test("home remains usable at 400 percent zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("/index.html");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "4";
  });

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(5);
});

test("home and not-found pages do not overflow at 320 CSS pixels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });

  for (const path of ["/index.html?lang=zh", "/404.html?lang=en"]) {
    await page.goto(path);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});

test("forced colors preserve visible interactive controls", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/index.html");

  await expect(page.getByRole("link", { name: /查看项目/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "EN" })).toBeVisible();
});
