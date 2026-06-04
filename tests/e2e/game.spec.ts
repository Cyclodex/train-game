import { test, expect } from "@playwright/test";

test.describe("Train game", () => {
  test("boots, renders the level and runs trains without console errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => consoleErrors.push(err.message));

    await page.goto("/");

    // The 7x6 grid has 40 track tiles (two cells are intentionally empty).
    await expect(page.locator(".tile")).toHaveCount(40);

    // Both trains (the locomotives) are rendered.
    const locomotives = page.locator(".train-locomotive");
    await expect(locomotives).toHaveCount(2);

    // At least one intersection switch and one depot are present.
    await expect(page.locator(".switch-box").first()).toBeVisible();
    await expect(page.locator(".depot-building").first()).toBeVisible();

    // The train should physically leave its depot: GSAP writes an inline
    // transform with a pixel translate once movement starts.
    const train1 = page.locator("#train1");
    await expect
      .poll(async () => train1.evaluate(el => (el as HTMLElement).style.transform), {
        timeout: 10000,
      })
      .toMatch(/translate\([^)]*\d+px/);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });
});
