import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });

test("home exposes all tool and project links without JavaScript", async ({
  page,
}) => {
  await page.goto("/index.html");
  await expect(
    page.getByRole("heading", { level: 1, name: /把市场噪音/ }),
  ).toBeVisible();
  await expect(page.locator(".tool-card")).toHaveCount(6);
  await expect(page.locator(".project-list a")).toHaveCount(5);
  await expect(page.locator(".noscript-note")).toBeVisible();
});

test("not-found page exposes an explicit return path without JavaScript", async ({
  page,
}) => {
  await page.goto("/404.html");
  await expect(page.locator(".error-code")).toHaveText("404");
  await expect(
    page.locator('a.button-primary[href="./index.html"]'),
  ).toBeVisible();
});
