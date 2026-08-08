import { expect, test } from "@playwright/test";

test("ETF premium dashboard loads its complete published snapshot", async ({
  page,
}) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/etf-premium/");

  await expect(page).toHaveTitle("跨境 ETF 溢价温度计 · zhaowl94");
  await expect(
    page.getByRole("heading", { level: 1, name: /溢价不是情绪/ }),
  ).toBeVisible();
  await expect(page.locator("#update-indicator")).toContainText(
    "静态快照已就绪",
  );
  await expect(page.locator("#metric-count")).toHaveText("16");
  await expect(page.locator("#ranking-body tr[data-code]")).toHaveCount(16);
  await expect(page.locator("#premium-chart")).toBeVisible();
  await expect(page.locator("#selected-summary")).toHaveText("已选 16 只");
  expect(errors).toEqual([]);
});

test("dashboard filters products without external runtime requests or storage", async ({
  page,
}) => {
  await page.goto("/etf-premium/");
  await expect(page.locator("#update-indicator")).toContainText(
    "静态快照已就绪",
  );

  await page.getByRole("button", { name: "标普 500" }).click();
  await expect(page.locator("#metric-count")).toHaveText("4");
  await expect(page.locator("#ranking-body tr[data-code]")).toHaveCount(4);

  await page.getByPlaceholder("输入代码或名称").fill("513500");
  await expect(page.locator("#ranking-body tr[data-code]")).toHaveCount(1);

  const runtimeState = await page.evaluate(() => ({
    cookie: document.cookie,
    localStorageLength: localStorage.length,
    resourceUrls: performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => url.startsWith("http")),
  }));

  expect(runtimeState.cookie).toBe("");
  expect(runtimeState.localStorageLength).toBe(0);
  expect(runtimeState.resourceUrls).not.toHaveLength(0);
  expect(
    runtimeState.resourceUrls.every(
      (url) => new URL(url).origin === "http://127.0.0.1:4173",
    ),
  ).toBe(true);
});
