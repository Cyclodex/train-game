import { defineConfig, devices } from "@playwright/test";

const PORT = 5180;
const baseURL = `http://localhost:${PORT}`;

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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
