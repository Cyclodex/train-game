// Launch the Chromium that this machine actually has.
//
// `chromium.launch()` only looks for the ONE build its own version pins, in the
// registry directory. That is right on a developer machine — `npm run browsers`
// puts it there — and wrong in a container that ships a browser it did not
// install: a cloud session comes with `PLAYWRIGHT_BROWSERS_PATH` pointing at a
// preinstalled Chromium of some other revision, and the CDN the installer would
// download the pinned one from is off the network policy. The result was
// `npm run shot` and `npm run probe` — the two commands CLAUDE.md requires for
// any visual change — failing with "Executable doesn't exist", advising a
// download that cannot happen, on a box with a perfectly good browser on it.
//
// So: try the pinned build first, and only if it is missing fall back to one
// that is present. The fallback is always REPORTED, never silent — a screenshot
// taken with a different browser build is a fact worth knowing when you are
// comparing pixels.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

// The per-platform path from a registry directory to the browser binary, the
// same layout `playwright install` writes.
function binaryPaths(dir) {
  if (process.platform === "win32") {
    return [join(dir, "chrome-win", "chrome.exe")];
  }
  if (process.platform === "darwin") {
    return [
      join(dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      join(dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "chrome"),
    ];
  }
  return [join(dir, "chrome-linux", "chrome"), join(dir, "chrome-linux", "headless_shell")];
}

// Any Chromium in the registry root, whatever revision. Prefers the full browser
// over the headless shell: the shell cannot do everything a screenshot run asks
// of it, and both are usually present side by side.
//
// Exported because `playwright.config.ts` needs the same answer: the e2e runner
// launches browsers itself and never calls `launchChromium`, so without it
// `npm run test:e2e` fails 29 tests on "Executable doesn't exist" in exactly the
// container where `shot` and `probe` work fine.
export function findAnyChromium() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.CHROME_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return null;
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  const dirs = entries
    .filter(e => e.startsWith("chromium-"))
    .concat(entries.filter(e => e.startsWith("chromium_headless_shell-")));
  for (const d of dirs) {
    for (const bin of binaryPaths(join(root, d))) {
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

// Is the build playwright-core pins actually installed? Cheap enough to ask
// before launching, which is what the e2e config needs — it cannot catch a
// failure and retry the way `launchChromium` does.
export function pinnedChromiumMissing() {
  try {
    return !existsSync(chromium.executablePath());
  } catch {
    return true;
  }
}

export async function launchChromium(options = {}) {
  try {
    return await chromium.launch(options);
  } catch (err) {
    const fallback = findAnyChromium();
    if (!fallback) throw err;
    console.log(`note     pinned Chromium missing; using ${fallback}`);
    return await chromium.launch({ ...options, executablePath: fallback });
  }
}
