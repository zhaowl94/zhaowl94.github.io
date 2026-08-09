import { expect, test } from "@playwright/test";

test("desktop tool grid keeps the featured dashboard full width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/index.html");
  await expect(page.locator(".tool-card")).toHaveCount(7);
  const featured = await page
    .locator(".tool-card-featured")
    .evaluate((element) => getComputedStyle(element).gridColumn);
  expect(featured).toBe("1 / -1");
  const pulse = await page
    .locator(".tool-card-pulse")
    .evaluate((element) => getComputedStyle(element).gridColumn);
  expect(pulse).toBe("1 / -1");
});

test("mobile tool grid collapses to one column without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/index.html");
  const layout = await page.evaluate(() => ({
    columns: getComputedStyle(
      document.querySelector(".tool-grid"),
    ).gridTemplateColumns.split(" ").length,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.columns).toBe(1);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test("dark theme keeps cards and text visibly distinct", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/index.html");
  const colors = await page
    .locator(".tool-card")
    .first()
    .evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      foreground: getComputedStyle(element).color,
    }));
  expect(colors.background).not.toBe(colors.foreground);
});

test("not-found panel remains centered and visible", async ({ page }) => {
  await page.goto("/404.html");
  await expect(page.locator(".not-found")).toBeVisible();
  await expect(page.locator(".error-code")).toHaveText("404");
});
