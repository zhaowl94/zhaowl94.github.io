import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });

test("home keeps both languages and all project evidence without JavaScript", async ({
  page,
}) => {
  await page.goto("/index.html?lang=en");

  await expect(page.locator(".language-switch")).toBeHidden();
  await expect(page.locator('h1 [data-lang-content="zh"]')).toBeVisible();
  await expect(page.locator('h1 [data-lang-content="en"]')).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(5);
  await expect(page.locator(".project-body h3")).toHaveText([
    "ttjjCrawler",
    "ReadWechatMessage",
    "yuanshen",
    "html_sample",
    "ProcessSqlData-TS",
  ]);
  await expect(page.locator(".noscript-note")).toBeVisible();
});

test("not-found page exposes an explicit return path without JavaScript", async ({
  page,
}) => {
  await page.goto("/404.html?lang=en");

  await expect(page.locator(".language-switch")).toBeHidden();
  await expect(page.locator('h1 [data-lang-content="zh"]')).toBeVisible();
  await expect(page.locator('h1 [data-lang-content="en"]')).toBeVisible();
  await expect(
    page.locator('a.button-primary[href="./index.html"]'),
  ).toBeVisible();
});
