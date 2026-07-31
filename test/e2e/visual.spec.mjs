import { expect, test } from "@playwright/test";

test("portfolio light theme", async ({ page }) => {
  await page.goto("/index.html?lang=zh");
  await expect(page).toHaveScreenshot("portfolio-light.png", {
    fullPage: true,
  });
});

test("portfolio dark theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/index.html?lang=en");
  await expect(page).toHaveScreenshot("portfolio-dark.png", {
    fullPage: true,
  });
});

test("portfolio mobile layout", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 390 });
  await page.goto("/index.html?lang=zh");
  await expect(page).toHaveScreenshot("portfolio-mobile.png", {
    fullPage: true,
  });
});

test("not-found page", async ({ page }) => {
  await page.goto("/404.html?lang=en");
  await expect(page).toHaveScreenshot("not-found.png", {
    fullPage: true,
  });
});
