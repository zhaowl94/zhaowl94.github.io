import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("home works when opened directly from the filesystem", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await page.goto(pathToFileURL(path.join(projectRoot, "index.html")).href);
  await expect(
    page.getByRole("heading", { level: 1, name: /把遗留脚本变成/ }),
  ).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(5);

  const fontFamily = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  expect(fontFamily).toContain("Segoe UI");

  await page.getByRole("link", { name: "EN" }).click();
  await expect(page).toHaveURL(/\?lang=en$/u);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(errors).toEqual([]);
});

test("404 page also works as a direct file", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(projectRoot, "404.html")).href);
  await expect(page.locator(".error-code")).toHaveText("404");
  await expect(page.getByRole("link", { name: /返回首页/ })).toHaveAttribute(
    "href",
    "./index.html",
  );
});
