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

// The per-platform paths from a registry directory to the browser binary, the
// layouts `playwright install` writes. SEVERAL per platform on purpose: the
// directory name changed across builds and a fallback that knows only one of
// them finds nothing on half the machines it is meant to rescue. Measured here —
// the pinned 1187 wants `chrome-win`, the installed 1234 ships `chrome-win64`,
// and the headless shell moved to `chrome-headless-shell-win64` with a renamed
// exe. Probe for the file; never assume the folder.
function binaryPaths(dir) {
  if (process.platform === "win32") {
    return [
      join(dir, "chrome-win64", "chrome.exe"),
      join(dir, "chrome-win", "chrome.exe"),
      join(dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      join(dir, "chrome-win", "headless_shell.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      join(dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      join(dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "chrome"),
      join(dir, "chrome-headless-shell-mac", "chrome-headless-shell"),
    ];
  }
  return [
    join(dir, "chrome-linux", "chrome"),
    join(dir, "chrome-linux", "headless_shell"),
    join(dir, "chrome-headless-shell-linux", "chrome-headless-shell"),
  ];
}

// Any Chromium in the registry root, whatever revision. Prefers the full browser
// over the headless shell: the shell cannot do everything a screenshot run asks
// of it, and both are usually present side by side.
//
// Exported because `playwright.config.ts` needs the same answer: the e2e runner
// launches browsers itself and never calls `launchChromium`, so without it
// `npm run test:e2e` fails 29 tests on "Executable doesn't exist" in exactly the
// container where `shot` and `probe` work fine.
// Every place a browser registry can live: an explicit override, then
// `PLAYWRIGHT_BROWSERS_PATH`, then the PLATFORM DEFAULT — which is the one this
// first shipped without, and it matters in both directions. A container sets the
// env var and ships an OLDER build; a developer machine sets nothing and has a
// NEWER one (measured here: chromium-1234 installed against a pinned 1187, so
// `npm run probe` died on "Executable doesn't exist" on a box with a perfectly
// good browser two directories away). Same helper, same mismatch, opposite sign.
function registryRoots() {
  const roots = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    roots.push(join(process.env.LOCALAPPDATA, "ms-playwright"));
  } else if (process.platform === "darwin" && process.env.HOME) {
    roots.push(join(process.env.HOME, "Library", "Caches", "ms-playwright"));
  } else if (process.env.HOME) {
    roots.push(join(process.env.HOME, ".cache", "ms-playwright"));
  }
  return roots.filter(r => existsSync(r));
}

export function findAnyChromium() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.CHROME_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  for (const root of registryRoots()) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    // Newest revision first: with several installed, the one closest to what the
    // code expects is the best guess, and a stale old build is the likelier dud.
    const rev = d => Number(d.slice(d.lastIndexOf("-") + 1)) || 0;
    const byRev = (a, b) => rev(b) - rev(a);
    const dirs = entries
      .filter(e => e.startsWith("chromium-"))
      .sort(byRev)
      .concat(entries.filter(e => e.startsWith("chromium_headless_shell-")).sort(byRev));
    for (const d of dirs) {
      for (const bin of binaryPaths(join(root, d))) {
        if (existsSync(bin)) return bin;
      }
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
