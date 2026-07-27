import { test, expect, Page } from "@playwright/test";

// The campaign shell, driven through the real UI: locked list → play level 1 →
// win → "Next" → level 2, and the list updated behind you.
//
// Progress lives in localStorage under the objective store's own keys, and each
// Playwright test gets a fresh context, so every test here starts at zero
// without any explicit clearing.

async function winCurrentLevel(page: Page) {
  const start = page.getByRole("button", { name: "Start", exact: true });
  if (await start.count()) await start.click();
  await page.evaluate(() => {
    (window as any).__game.speed.value = 4;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__game.objective.phase), {
      timeout: 45000,
      intervals: [500],
    })
    .toBe("won");
}

test.describe("Campaign", () => {
  test("locks every level behind the one before it", async ({ page }) => {
    await page.goto("/#/campaign");

    const rows = page.locator("[data-level-id]");
    await expect(rows).toHaveCount(3);
    // Level 1 is a button (playable); the rest are inert divs until cleared.
    await expect(page.locator("button[data-level-id]")).toHaveCount(1);
    await expect(page.locator(".campaign-row--locked")).toHaveCount(2);
    await expect(page.getByText("★ 0 / 9")).toBeVisible();
  });

  test("plays level 1, offers the next one, and unlocks it", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/#/campaign");

    // Open level 1 from the list. It must carry its OWN mode in the query:
    // PlayView ignores the scenario's modeId and would otherwise fall back to
    // whatever mode was last played.
    await page.locator("button[data-level-id]").first().click();
    await expect.poll(() => page.url()).toContain("board=objectives");
    await expect.poll(() => page.url()).toContain("mode=puzzle");

    await winCurrentLevel(page);

    // The win card leads on, by name.
    const next = page.getByRole("button", { name: /^Next: Mind the Gap/ });
    await expect(next).toBeVisible();
    await next.click();

    // ...to the next board, in ITS mode.
    await expect.poll(() => page.url()).toContain("board=buildgap");
    await expect.poll(() => page.url()).toContain("mode=tycoon");
    await expect
      .poll(() => page.evaluate(() => (window as any).__game.mode.id))
      .toBe("tycoon");

    // And the list has moved on with us: level 2 playable, level 3 still shut,
    // level 1 showing what it scored.
    await page.goto("/#/campaign");
    await expect(page.locator("button[data-level-id]")).toHaveCount(2);
    await expect(page.locator(".campaign-row--locked")).toHaveCount(1);
    await expect(page.locator(".campaign-pip--on").first()).toBeVisible();
  });

  test("offers no next level off the campaign", async ({ page }) => {
    // A /test board is not a campaign level, so the win card must not pretend
    // there is somewhere to go.
    await page.goto("/#/play?mode=puzzle&board=straight");
    await winCurrentLevel(page);
    await expect(page.getByRole("button", { name: /^Next:/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
