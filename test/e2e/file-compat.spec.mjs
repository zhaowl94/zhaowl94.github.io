import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("home remains useful when opened directly from the filesystem", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(pathToFileURL(path.join(projectRoot, "index.html")).href);
  await expect(
    page.getByRole("heading", { level: 1, name: /把市场噪音/ }),
  ).toBeVisible();
  await expect(page.locator(".tool-card")).toHaveCount(8);
  await expect(page.locator(".game-card")).toHaveCount(5);
  await expect(page.locator("#site-updated")).toContainText("直接打开模式");
  expect(errors).toEqual([]);
});

test("404 page also works as a direct file", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(projectRoot, "404.html")).href);
  await expect(page.locator(".error-code")).toHaveText("404");
  await expect(
    page.getByRole("link", { name: "返回研究工具台" }),
  ).toHaveAttribute("href", "./index.html");
});
