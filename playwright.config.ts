import { defineConfig, devices } from "@playwright/test";
// @ts-expect-error - plain ESM helper shared with scripts/shoot.mjs + probe.mjs
import { findAnyChromium, pinnedChromiumMissing } from "./scripts/browser.mjs";

const PORT = 5180;
const baseURL = `http://localhost:${PORT}`;

// USE THE BROWSER THIS MACHINE HAS. The runner launches Chromium itself, so it
// never goes through `launchChromium` the way `npm run shot` / `npm run probe`
// do — and in a container that ships a Chromium of another revision (with the
// download CDN off the network policy) every one of the 29 e2e tests failed on
// "Executable doesn't exist" while the same browser drove the screenshots fine.
// Only consulted when the pinned build is genuinely absent, so a developer
// machine that ran `npm run browsers` is unaffected.
const fallbackChromium = pinnedChromiumMissing() ? findAnyChromium() : null;
if (fallbackChromium) console.log(`note  pinned Chromium missing; using ${fallbackChromium}`);

// End-to-end smoke test config. Playwright starts a real Vite dev server and
// drives a real Chromium so the GSAP-animated trains actually move (jsdom
// cannot render SVG motion paths).
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(fallbackChromium ? { launchOptions: { executablePath: fallbackChromium } } : {}),
      },
    },
  ],
});
