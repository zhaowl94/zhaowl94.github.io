import { expect, test } from "@playwright/test";

const games = [
  ["/doudizhu/", "斗地主 · zhaowl94 小游戏", "开始游戏"],
  ["/guandan/", "掼蛋 · zhaowl94 小游戏", "开始游戏"],
  ["/tank-battle/", "坦克大战 · zhaowl94 小游戏", "按 ENTER 开始游戏"],
  ["/auction-king/", "竞拍之王 · zhaowl94 小游戏", "开始游戏"],
  ["/cultivation/", "凡人修仙传 · 问道凡尘 · zhaowl94 小游戏", "开 始 问 道"],
];

for (const [path, title, startText] of games) {
  test(`${path} loads as a standalone game with a home exit`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(
      page.getByText(startText, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "返回 zhaowl94 主页" }),
    ).toHaveAttribute("href", "../");
    expect(errors).toEqual([]);
  });
}

test("card games can start a local match", async ({ page }) => {
  await page.goto("/doudizhu/");
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.locator("#start-screen")).toBeHidden();
  await expect(page.locator("#hand .card").first()).toBeVisible();

  await page.goto("/guandan/");
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.locator("#player0-hand .card").first()).toBeVisible();
});

test("tank battle starts from the keyboard", async ({ page }) => {
  await page.goto("/tank-battle/");
  await page.keyboard.press("Enter");
  await expect(page.locator("#menuScreen")).toHaveClass(/hidden/u);
});

test("auction and cultivation enter their first playable screens", async ({
  page,
}) => {
  await page.goto("/auction-king/");
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.locator("#auction-stage")).toBeVisible();

  await page.goto("/cultivation/");
  await page.getByRole("button", { name: "开 始 问 道" }).click();
  await expect(page.locator("#screen-origin")).toHaveClass(/active/u);
});
