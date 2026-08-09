import { expect, test } from "@playwright/test";

const tools = [
  ["/etf-premium/", "跨境 ETF 溢价温度计 · zhaowl94", /溢价不是情绪/],
  ["/ndx-valuation/", "NASDAQ-100 估值图 · zhaowl94", /纳指 100 估值图/],
  ["/bubble-monitor/", "NDX 100 泡沫监控 · zhaowl94", /NDX 100 泡沫监控/],
  [
    "/strategy-monitor/",
    "纳指 ETF 趋势策略监控 · zhaowl94",
    /纳指ETF趋势策略监控/,
  ],
  ["/backtest-lab/", "纳指动态配置回测台 · zhaowl94", /纳指动态配置回测台/],
  [
    "/qdii-similarity/",
    "QDII 基金相似度看板 · zhaowl94",
    /QDII 基金相似度看板/,
  ],
  [
    "/market-pulse/",
    "美股市场脉搏 · 无 LLM 规则快照 · zhaowl94",
    /美股市场脉搏/,
  ],
  [
    "/ndx100-dashboard/",
    "纳指 100 量化仪表盘 · zhaowl94",
    /纳指100 · 量化仪表盘/,
  ],
];

for (const [path, title, heading] of tools) {
  test(`${path} is integrated with hub navigation`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
    await expect(page.locator('.hub-nav a[href="../"]').first()).toBeVisible();
  });
}

test("published market snapshots render substantive data", async ({ page }) => {
  await page.goto("/qdii-similarity/");
  await expect(page.locator("#progress-pct")).toHaveText("100%");
  await expect(page.locator("#total-count")).toHaveText("729");
  await expect(page.locator("#funds-body tr[data-code]")).toHaveCount(729);

  await page.goto("/strategy-monitor/");
  await expect(page.locator("#dataStamp")).toContainText("数据生成");
  await expect(page.locator("#signalBadge")).not.toHaveText("--");

  await page.goto("/backtest-lab/");
  await expect(page.locator("#badge")).toContainText("数据生成");
  await expect(page.locator("#metrics")).not.toBeEmpty();

  await page.goto("/bubble-monitor/");
  await expect(page.locator("#status")).toContainText("已发布快照");

  await page.goto("/ndx-valuation/");
  await expect(page.locator("#summary")).not.toBeEmpty();

  await page.goto("/market-pulse/");
  await expect(page.locator("#rankingRows tr")).toHaveCount(10);
  await expect(page.locator("#indexCards .index-card")).toHaveCount(2);
  const coverage = await page.locator("#coverageCount").textContent();
  const [candidates, universe] = coverage.match(/\d+/gu).map(Number);
  expect(candidates).toBeGreaterThanOrEqual(60);
  expect(universe).toBeGreaterThanOrEqual(candidates);
  await expect(page.locator("#modelUsed")).toHaveText("不使用");

  await page.goto("/ndx100-dashboard/");
  await page.getByRole("button", { name: "刷新行情数据" }).click();
  await expect(page.locator("#chartsArea")).toBeVisible();
  await expect(page.locator("#metricCards .metric-card")).toHaveCount(8);
});

test("every tool exposes an appropriate refresh control", async ({ page }) => {
  const controls = [
    ["/etf-premium/", "刷新最新快照"],
    ["/ndx-valuation/", "更新数据"],
    ["/bubble-monitor/", "更新数据"],
    ["/strategy-monitor/", "刷新数据"],
    ["/backtest-lab/", "拉取最新数据"],
    ["/qdii-similarity/", "刷新最新快照"],
    ["/market-pulse/", "刷新最新快照"],
    ["/ndx100-dashboard/", "刷新行情数据"],
  ];
  for (const [path, name] of controls) {
    await page.goto(path);
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
});

test("static refresh controls reload the newest published files", async ({
  page,
}) => {
  await page.goto("/strategy-monitor/");
  await page.getByRole("button", { name: "刷新数据" }).click();
  await expect(page.locator("#refreshStatus")).toContainText(
    "已读取最新发布快照",
  );

  await page.goto("/backtest-lab/");
  await page.getByRole("button", { name: "拉取最新数据" }).click();
  await expect(page.locator("#refreshHint")).toContainText(
    "已读取最新发布快照",
  );

  await page.goto("/bubble-monitor/");
  await page.getByRole("button", { name: "更新数据" }).click();
  await expect(page.locator("#status")).toContainText("已发布快照");

  await page.goto("/qdii-similarity/");
  await page.getByRole("button", { name: "刷新最新快照" }).click();
  await expect(page.locator("#progress-pct")).toHaveText("100%");

  await page.goto("/market-pulse/");
  await page.getByRole("button", { name: /刷新最新快照/ }).click();
  await expect(page.locator("#load-status")).toContainText("已重新读取");
});
