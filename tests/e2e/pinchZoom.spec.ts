import { test, expect, type Page } from "@playwright/test";

// Pinch-zoom on the board, driven through Chromium's real touch pipeline
// (CDP `Input.dispatchTouchEvent`) rather than synthetic events. That is the
// point of doing it here rather than only in tests/unit/cameraController.spec.ts:
// the unit test proves the maths, this proves the wiring — that the gesture
// survives `touch-action`, arrives as `pointerType: "touch"`, reaches the
// viewport's listener, and moves the board that the player actually sees.
//
// A phone has neither a scroll wheel nor a middle mouse button, so before this
// the only way to zoom on a touchscreen was the −/+ buttons.

test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

// The camera writes `scale(z) translate(...)` onto `.level`; that number IS the
// zoom, and reading it needs no HUD control to be on screen.
async function boardScale(page: Page, sel = ".level"): Promise<number> {
  const t = await page.locator(sel).getAttribute("style");
  const m = /scale\(([-\d.]+)\)/.exec(t ?? "");
  expect(m, `no scale() in the board transform: ${t}`).not.toBeNull();
  return Number(m![1]);
}

// Two fingers, moved together over `steps` frames from `from` px apart to `to`
// px apart, centred on `centre` (and optionally drifting by `drift`).
async function pinch(
  page: Page,
  centre: { x: number; y: number },
  from: number,
  to: number,
  drift = { x: 0, y: 0 },
  steps = 8,
) {
  const cdp = await page.context().newCDPSession(page);
  const points = (gap: number, off: { x: number; y: number }) => [
    { x: centre.x + off.x - gap / 2, y: centre.y + off.y, id: 1 },
    { x: centre.x + off.x + gap / 2, y: centre.y + off.y, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(from, { x: 0, y: 0 }),
  });
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(from + (to - from) * k, { x: drift.x * k, y: drift.y * k }),
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function openStage(page: Page) {
  // A world far bigger than a phone screen, so there is something to zoom into.
  await page.goto("/#/test/streets/lanes/roadlanemerge");
  await page.waitForSelector(".stage-viewport .level");
  await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game);
}

test.describe("pinch-zoom on a touchscreen", () => {
  test("spreading two fingers zooms the board in", async ({ page }) => {
    await openStage(page);
    const box = (await page.locator(".stage-viewport").boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const before = await boardScale(page);
    await pinch(page, centre, 80, 260);
    const after = await boardScale(page);

    expect(after, `zoom went ${before} -> ${after}`).toBeGreaterThan(before * 1.5);
  });

  test("closing two fingers zooms the board out", async ({ page }) => {
    await openStage(page);
    const box = (await page.locator(".stage-viewport").boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await pinch(page, centre, 80, 300); // in first, so there is room to come back
    const before = await boardScale(page);
    await pinch(page, centre, 300, 90);
    const after = await boardScale(page);

    expect(after, `zoom went ${before} -> ${after}`).toBeLessThan(before);
  });

  test("the world point between the fingers stays between the fingers", async ({ page }) => {
    // The invariant that makes a pinch feel attached to the board instead of
    // sliding away from it. Read in world coordinates straight off the camera
    // transform, which is the only thing the renderer actually uses.
    await openStage(page);
    const box = (await page.locator(".stage-viewport").boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Viewport-local, the frame the camera works in.
    const local = { x: box.width / 2, y: box.height / 2 };

    const read = async () => {
      const style = (await page.locator(".level").getAttribute("style")) ?? "";
      const s = /scale\(([-\d.]+)\)\s*translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(style);
      expect(s, `unreadable transform: ${style}`).not.toBeNull();
      const zoom = Number(s![1]);
      // `cameraTransform` emits translate(-x, -y), so negate to get the camera.
      return { zoom, x: -Number(s![2]), y: -Number(s![3]) };
    };

    const a = await read();
    const worldBefore = { x: a.x + local.x / a.zoom, y: a.y + local.y / a.zoom };
    await pinch(page, centre, 90, 240);
    const b = await read();
    const worldAfter = { x: b.x + local.x / b.zoom, y: b.y + local.y / b.zoom };

    expect(b.zoom).toBeGreaterThan(a.zoom);
    // A few px of slack: the gesture is dispatched in integer screen px and the
    // camera clamps against the world's edges.
    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(12);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(12);
  });

  test("a pinch releases the board instead of leaving it stuck panning", async ({ page }) => {
    await openStage(page);
    const box = (await page.locator(".stage-viewport").boundingBox())!;
    await pinch(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 80, 220);
    // `--panning` suppresses every tile click while it is on; a gesture that
    // never released it would leave the board looking alive and answering
    // nothing.
    await expect(page.locator(".stage-viewport")).not.toHaveClass(/--panning/);
  });

  test("the play board pinches too", async ({ page }) => {
    // Same controller, but PlayView's own wiring — worth its own case because
    // that view gates the pan on the build tool, and a pinch has to outrank it.
    await page.goto("/#/play?board=demoworld");
    await page.waitForSelector(".world-viewport .level");
    // A mode opens on its Ready card, and that overlay covers the whole board —
    // a pinch dispatched through it never reaches the viewport at all. Dismiss
    // it, or this test measures the overlay instead of the camera.
    const start = page.getByRole("button", { name: "Start", exact: true });
    if (await start.count()) await start.click();
    await expect(page.locator(".game-overlay")).toHaveCount(0);

    const box = (await page.locator(".world-viewport").boundingBox())!;
    const before = await boardScale(page);
    await pinch(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 80, 260);
    expect(await boardScale(page)).toBeGreaterThan(before);
  });

  test("the editor pinches without drawing track", async ({ page }) => {
    // The hardest gate of the three, and the one this feature exists for: in the
    // editor a single pointer belongs to the connect tool and NEVER pans, so
    // before this there was no way at all to move the board on a touchscreen —
    // no middle button, no space bar, no wheel. The camera hears about the second
    // finger only because the view hands it every pointer and lets the controller
    // decide.
    //
    // The "drew nothing" half cannot fail today (the edge zones bind mouse
    // events, which a `touch-action: none` surface never synthesises, so touch
    // does not reach them); it is here for the day they move to pointer events,
    // which they must before the drawing tools work by touch at all.
    await page.goto("/#/editor");
    await page.waitForSelector(".editor-grid .editor-cell");
    const rails = () => page.locator(".editor-cell .tile").count();

    const laidBefore = await rails();
    const before = await boardScale(page, ".editor-grid");
    const box = (await page.locator(".world-viewport").boundingBox())!;
    await pinch(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 80, 240);

    expect(await boardScale(page, ".editor-grid")).toBeGreaterThan(before);
    expect(await rails(), "the pinch drew track").toBe(laidBefore);
  });
});
