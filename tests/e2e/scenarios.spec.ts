import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __scenarioIds?: string[];
    __game?: unknown;
  }
}

// Render sweep over the feature-test world: every /test scenario must boot and
// paint without throwing. This is the robust, non-flaky form of "visual
// regression" — it catches a scenario that validates structurally (covered by
// the unit suite) yet crashes at render time in a Vue component, or floods the
// console with errors.
//
// It is deliberately NOT a pixel diff: cross-machine font / antialiasing
// differences make screenshot diffing flaky, and a flaky gate is worse than no
// gate (it trains people to ignore red). For pixel-level review, take an
// intentional before/after with `npm run shot -- <id>` locally instead.
//
// Not wired into the fast CI (lint + type-check + unit) — like the other e2e it
// needs a real browser (`npx playwright install chromium` once); run it with
// `npm run test:e2e`.
test.describe("feature test world renders", () => {
  test("every scenario boots, paints tiles and logs no console errors", async ({
    page,
  }) => {
    test.setTimeout(180_000); // a full sweep visits every registered scenario

    const errors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
    });
    page.on("pageerror", err => errors.push(`[pageerror] ${err.message}`));

    // The dev build exposes the flat scenario-id list on window so tooling can
    // enumerate every scenario without importing the app graph (see main.ts).
    await page.goto("/#/test");
    const ids = await page.evaluate(async () => {
      for (let i = 0; i < 50 && !window.__scenarioIds; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      return window.__scenarioIds ?? [];
    });
    expect(ids.length, "window.__scenarioIds was empty").toBeGreaterThan(0);

    const blank: string[] = [];
    for (const id of ids) {
      await page.goto(`/#/test/${id}`);
      // TestStage publishes the live game once it has created the simulation.
      await page.waitForFunction(() => !!window.__game, null, { timeout: 8000 });
      const tiles = await page.locator(".tile-component").count();
      if (tiles === 0) blank.push(id);
    }

    expect(blank, `scenarios that rendered no tiles: ${blank.join(", ")}`).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
