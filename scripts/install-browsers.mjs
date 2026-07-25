#!/usr/bin/env node
// Install the Playwright browser builds `npm run shot` / `npm run test:e2e` need,
// WITHOUT going through `playwright install`.
//
//   npm run browsers
//
// Why this exists: on some Windows machines `npx playwright install chromium`
// downloads the 149 MB zip in ~4s, prints "extracting archive", and then hangs
// forever in its out-of-process extractor — leaving a half-written browser dir
// (chrome.dll present, chrome.exe missing) and a held `__dirlock` that makes
// every retry hang too. The archive itself is fine: extracting the very same zip
// with the platform's own unzip takes under two seconds. So this script does the
// three steps the installer does — download, extract, write the
// INSTALLATION_COMPLETE marker — and skips the part that stalls.
//
// It is idempotent: an already-complete browser dir is left alone. Pass --force
// to re-download one anyway.

import { existsSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const require = createRequire(import.meta.url);
// browsers.json is not an exported subpath, so resolve the package root instead.
const pwRoot = join(require.resolve("playwright-core/package.json"), "..");
const { browsers } = require(join(pwRoot, "browsers.json"));

const CDN = "https://cdn.playwright.dev/dbazure/download/playwright/builds";
const force = process.argv.includes("--force");

// Playwright's own registry layout: <root>/<name>-<revision>/ with a marker file.
function browsersRoot() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA, "ms-playwright");
  if (process.platform === "darwin") return join(process.env.HOME, "Library", "Caches", "ms-playwright");
  return join(process.env.HOME, ".cache", "ms-playwright");
}

// The CDN path differs per browser family; only the ones we actually need.
function archiveFor(name, revision) {
  const win = process.platform === "win32";
  if (!win) throw new Error(`${name}: only win64 archives are mapped; run "npx playwright install" on this platform`);
  if (name === "chromium") return `${CDN}/chromium/${revision}/chromium-win64.zip`;
  if (name === "chromium-headless-shell") return `${CDN}/chromium/${revision}/chromium-headless-shell-win64.zip`;
  if (name === "winldd") return `${CDN}/winldd/${revision}/winldd-win64.zip`;
  throw new Error(`no archive mapping for ${name}`);
}

// Playwright stores chromium-headless-shell under an underscored directory name.
const dirName = (name, revision) => `${name.replace(/-/g, "_")}-${revision}`;

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
  return statSync(dest).size;
}

function extract(zip, dest) {
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command",
       `Expand-Archive -Path '${zip}' -DestinationPath '${dest}' -Force`],
      { stdio: "inherit" },
    );
  } else {
    execFileSync("unzip", ["-q", "-o", zip, "-d", dest], { stdio: "inherit" });
  }
}

async function install(name, revision) {
  const root = browsersRoot();
  const dir = join(root, dirName(name, revision));
  const marker = join(dir, "INSTALLATION_COMPLETE");
  if (existsSync(marker) && !force) {
    console.log(`ok       ${name} ${revision} (already installed)`);
    return;
  }
  const url = archiveFor(name, revision);
  const zip = join(tmpdir(), `pw-${name}-${revision}.zip`);
  console.log(`download ${name} ${revision}`);
  const bytes = await download(url, zip);
  console.log(`extract  ${name} ${revision} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  extract(zip, dir);
  writeFileSync(marker, "");
  rmSync(zip, { force: true });
  console.log(`ok       ${name} ${revision}`);
}

// chromium (full browser), its headless shell (what `chromium.launch()` uses when
// headless), and winldd (Windows dependency checker chromium refuses to start
// without). `installByDefault` omits winldd, so name the set explicitly.
const WANTED = ["chromium", "chromium-headless-shell", ...(process.platform === "win32" ? ["winldd"] : [])];

const targets = WANTED.map(name => {
  const entry = browsers.find(b => b.name === name);
  if (!entry) throw new Error(`playwright-core/browsers.json has no "${name}"`);
  return entry;
});

for (const { name, revision } of targets) await install(name, revision);
console.log("\nbrowsers ready — `npm run shot` and `npm run test:e2e` will work now.");
