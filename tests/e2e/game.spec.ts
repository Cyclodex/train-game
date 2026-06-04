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
    // transform with a pixel translate (translate3d/matrix while moving) once
    // movement starts.
    const train1 = page.locator("#train1");
    await expect
      .poll(async () => train1.evaluate(el => (el as HTMLElement).style.transform), {
        timeout: 10000,
      })
      .toMatch(/translate3d\(|matrix\(|\d+px/);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("trains advance past their starting tile (timeline onComplete fires)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".train-locomotive")).toHaveCount(2);

    // Read each train's tile coordinate straight from the live Vue state.
    const readPositions = () =>
      page.evaluate(() => {
        const trains = (document.getElementById("app") as any).__vue_app__
          ._instance.proxy.trains;
        return Object.fromEntries(
          Object.keys(trains).map(id => [id, `${trains[id].x},${trains[id].y}`])
        ) as Record<string, string>;
      });

    const start = await readPositions();

    // Tile-to-tile movement is driven by the depot-exit animation's onComplete
    // callback. If the GSAP timeline is stored in reactive (proxied) state the
    // callback never fires and the train stays on its starting tile forever.
    await expect
      .poll(
        async () => {
          const now = await readPositions();
          return Object.keys(start).some(id => now[id] !== start[id]);
        },
        { timeout: 15000, intervals: [500] }
      )
      .toBe(true);
  });
});
