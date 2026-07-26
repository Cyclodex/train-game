import { test, expect } from "@playwright/test";

// `Window.__game` is globally declared as `unknown` (tests/e2e/scenarios.spec.ts),
// so narrow it here rather than redeclaring the property.
interface LiveGame {
  switches: Record<string, Record<number, number>>;
  deliveries: { value: number };
  sim: { trainTileId(id: string): string };
}

// The junction switch fan, driven the way a player drives it. The unit suite
// pins the fan's geometry (tests/unit/tiles/switchFan.spec.ts) and the registry
// suite validates the map; what only a real browser can show is that pointing at
// a junction opens it, clicking a drawn arrow throws the points to THAT exit,
// and the train then follows it.
//
// `switch-fan` is an all-pairs 4-way cross authored to start pointing north
// (yellow) with a green train, so doing nothing parks it wrong. One click on the
// west fan's downward arrow is the whole fix — and the "one" matters: the widget
// this replaced could only cycle.
test.describe("junction switch fan", () => {
  test("open a junction, click an arm, the train goes that way", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(err.message));

    await page.goto("/#/test/switch-fan");
    await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });

    // Four switchable entries on the cross. AT REST each draws exactly one
    // arrow — the route it is set to — so the tile reads as "here is how this
    // junction routes" instead of becoming twelve overlapping curves.
    await expect(page.locator(".switch-fan")).toHaveCount(4);
    await expect(page.locator(".switch-arm")).toHaveCount(4);
    await expect(page.locator(".switch-arm.is-on")).toHaveCount(4);

    // Pointing at the west fan (Position.Left is 3) opens its alternatives —
    // the cross offers three exits from every entry.
    const west = page.locator('.switch-fan[data-entry="3"]');
    await expect(west).toHaveCount(1);
    await west.locator(".switch-hit").first().dispatchEvent("pointerover");
    await expect(west.locator(".switch-arm")).toHaveCount(3);

    // Arms are always ordered Left, Straight, Right; from the west entry the
    // Right arm exits Bottom, which is the green depot the train belongs to.
    await west.locator(".switch-hit").nth(2).dispatchEvent("click");

    // Position.Left is 3; ActiveIntersection.Right is 2.
    await expect
      .poll(() => page.evaluate(() => (window.__game as LiveGame).switches["2,1"][3]))
      .toBe(2);

    // And the train actually goes there and parks (a colour match, so it does
    // not bounce). The board is five tiles wide at about a tile a second.
    await expect
      .poll(() => page.evaluate(() => (window.__game as LiveGame).deliveries.value), {
        timeout: 25000,
      })
      .toBe(1);
    expect(
      await page.evaluate(() => (window.__game as LiveGame).sim.trainTileId("train1"))
    ).toBe("2,2");

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
