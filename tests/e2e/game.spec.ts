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
        const game = (window as any).__game;
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

  test("no two trains ever occupy the same tile (path reservation)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".train-locomotive")).toHaveCount(2);

    const headTiles = () =>
      page.evaluate(() => {
        const game = (window as any).__game;
        return Object.keys(game.sim.trains).map((id: string) =>
          game.sim.trainTileId(id)
        ) as string[];
      });

    // Sample repeatedly while the game runs: the two trains must never share a
    // tile (reservation protects the path through junctions).
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(300);
      const tiles = await headTiles();
      expect(new Set(tiles).size).toBe(tiles.length);
    }
  });

  test("signals are drawn and a manual hold turns a signal to Stop", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".signal").first()).toBeVisible();

    const result = await page.evaluate(() => {
      const game = (window as any).__game;
      const tileId = game.signalTiles[0] as string;
      const exitPort = 1; // any port; a manual hold forces Stop regardless
      game.toggleHold(tileId, exitPort);
      return { aspect: game.sim.signalAspect(tileId, exitPort) as string };
    });
    expect(result.aspect).toBe("stop");
  });
});

test.describe("Level editor", () => {
  test("paints a connected line and plays it", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => consoleErrors.push(err.message));

    await page.goto("/#/editor");
    await expect(page.locator(".toolbar")).toBeVisible();

    const cell = (coord: string) =>
      page.locator(`.editor-cell[data-coord="${coord}"]`);

    // Track tool is default: paint a horizontal line.
    for (const c of ["1,1", "2,1", "3,1"]) await cell(c).click();
    // Cap both ends with depots.
    await page.getByRole("button", { name: "Depot" }).click();
    await cell("0,1").click();
    await cell("4,1").click();

    // The level should validate and Play should be enabled.
    await expect(page.locator(".status")).toHaveText(/valid/);
    const play = page.getByRole("button", { name: /Play this/ });
    await expect(play).toBeEnabled();
    await play.click();

    // We land on the play view running OUR level: 5 tiles (3 track + 2 depots),
    // not the 40-tile default — proving the editor->play handoff.
    await expect(page.locator(".train-locomotive").first()).toBeVisible();
    await expect(page.locator(".tile")).toHaveCount(5);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("random map generates a valid playable level", async ({ page }) => {
    await page.goto("/#/editor");
    await page.getByRole("button", { name: /Random/ }).click();
    await expect(page.locator(".status")).toHaveText(/valid/);
    await expect(page.locator(".depot-building").first()).toBeVisible();
  });
});
