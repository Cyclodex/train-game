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

  test("trains advance tile to tile under the simulation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".train-locomotive")).toHaveCount(2);

    // Read each train's tile coordinate straight from the live simulation.
    const readPositions = () =>
      page.evaluate(() => {
        const game = (document.getElementById("app") as any).__vue_app__
          ._instance.proxy.game;
        const ids = Object.keys(game.sim.trains);
        return Object.fromEntries(
          ids.map(id => [id, game.sim.trainTileId(id)])
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

  test("a train held at a red signal never advances past it", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".train-locomotive")).toHaveCount(2);

    // Put a red signal on train1's current tile (blocks it from leaving).
    const heldTile = await page.evaluate(() => {
      const game = (document.getElementById("app") as any).__vue_app__._instance
        .proxy.game;
      game.paused.value = true;
      const tile = game.sim.trainTileId("train1");
      game.signals[tile] = "red";
      game.paused.value = false;
      return tile as string;
    });

    const tileOf = () =>
      page.evaluate(
        () =>
          (document.getElementById("app") as any).__vue_app__._instance.proxy
            .game.sim.trainTileId("train1") as string
      );

    // It may roll to the tile boundary, but it must never cross onto a new tile.
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(400);
      expect(await tileOf()).toBe(heldTile);
    }
  });
});
