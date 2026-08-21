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

    // From the west entry the Right arm (ActiveIntersection.Right = 2) exits
    // Bottom, which is the green depot the train belongs to. Select it by
    // `data-arm`, not by position: the arms are painted in STACKING order (the
    // set one last, so a ghost cannot slice it in half), which is not the
    // authored Left/Straight/Right order.
    await west.locator('[data-arm="2"] .switch-hit').first().dispatchEvent("click");

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

  // The other half of the gesture. At REST a fan draws ONE arrow — the route it
  // is set to — so that arrow is the only target on the tile; clicking it used
  // to be a no-op, which made a resting switch look inert. It now steps on to
  // the next reachable arm, the same as clicking that arm would have.
  test("clicking the arrow already set steps the switch on", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(err.message));

    await page.goto("/#/test/switch-fan");
    await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });

    // The north fan (Position.Top is 0) — no train is due on it, so it is at
    // rest with exactly one arrow drawn.
    const north = page.locator('.switch-fan[data-entry="0"]');
    await expect(north.locator(".switch-arm")).toHaveCount(1);
    const set = () =>
      page.evaluate(() => (window.__game as LiveGame).switches["2,1"][0]);
    const before = await set();

    // Click the SET arrow itself (it is the one drawn, hence the only target).
    await north.locator(".switch-hit").first().dispatchEvent("click");
    await expect.poll(set).not.toBe(before);
    // Still a reachable arm of the cross — cycling never lands on a hole.
    expect([0, 1, 2]).toContain(await set());

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
