#!/usr/bin/env node
// Reproducible scenario screenshots for the ticket workflow.
//
//   npm run shot -- <scenarioId> [<scenarioId> ...] [options]
//
// Loads a /test scenario in a real browser with the Debug overlay on (the cyan
// car / amber bus driving-lines) and the flat backdrop, lets traffic populate,
// and writes a tight PNG of just the road/rail tiles. Use it to attach a
// screenshot to a visual issue, and a before/after pair to a fix PR
// (see docs/TICKET_WORKFLOW.md → "Visual verification").
//
// Options:
//   --out <dir>       output directory (default: screenshots/)
//   --label <name>    filename suffix, e.g. --label before  → roadoneway-before.png
//   --no-debug        hide the debug overlay (paint/markings only)
//   --backdrop        keep the themed backdrop (default: flat for clarity)
//   --send            click every fare pin before settling (Tycoon boards start
//                     with every train WAITING, so nothing on them moves — and
//                     states that only exist once trains are rolling, like a pin
//                     held by another train's block, are otherwise unshootable)
//   --density <0-100> car density % (default: 60)
//   --wait <ms>       settle time before the shot (default: 4500)
//   --port <n>        dev-server port (default: 5181)
//   --scale <n>       deviceScaleFactor (default: 3)
//
// Examples:
//   npm run shot -- roadonewaylanes --label before
//   npm run shot -- busmegacross mixedcross --out screenshots/issue-18

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

function parseArgs(argv) {
  const ids = [];
  const opt = {
    out: "screenshots",
    label: "",
    debug: true,
    backdrop: false,
    send: false,
    density: 60,
    wait: 4500,
    port: 5181,
    scale: 3,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-debug") opt.debug = false;
    else if (a === "--backdrop") opt.backdrop = true;
    else if (a === "--send") opt.send = true;
    else if (a === "--out") opt.out = argv[++i];
    else if (a === "--label") opt.label = argv[++i];
    else if (a === "--density") opt.density = Number(argv[++i]);
    else if (a === "--wait") opt.wait = Number(argv[++i]);
    else if (a === "--port") opt.port = Number(argv[++i]);
    else if (a === "--scale") opt.scale = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    else ids.push(a);
  }
  if (!ids.length) {
    throw new Error(
      "usage: npm run shot -- <scenarioId> [more ids] [--out dir] [--label before] [--no-debug]",
    );
  }
  return { ids, opt };
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`dev server did not start at ${url} within ${timeoutMs}ms`);
}

// Is anything already answering on our port? `--strictPort` stops Vite sharing a
// port, but it does NOT stop us from photographing a server that is not ours:
// waitForServer accepts any 200, so an orphaned dev server left behind by an
// earlier run — quite possibly from a different worktree, with a different
// checkout of the scenarios — would be shot instead, silently, and the pictures
// would look plausible. Refuse loudly rather than lie.
async function portInUse(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { ids, opt } = parseArgs(process.argv.slice(2));
  mkdirSync(opt.out, { recursive: true });
  const base = `http://localhost:${opt.port}`;

  if (await portInUse(base)) {
    throw new Error(
      `something is already serving ${base} — it is not the server this script ` +
        `started, so the shots would be of someone else's checkout. Stop it ` +
        `(it is usually an orphaned dev server from an earlier run) or pass --port <n>.`,
    );
  }

  // Start a dedicated dev server (strict port so we never hit a stale one).
  // On Windows the npm launcher is `npm.cmd`; spawning bare "npm" there ENOENTs.
  // On Windows the npm launcher is `npm.cmd`, and Node ≥18 requires shell:true to
  // spawn a `.cmd` (bare "npm" ENOENTs, npm.cmd without a shell EINVALs).
  const onWin = process.platform === "win32";
  const server = spawn(
    onWin ? "npm.cmd" : "npm",
    ["run", "dev", "--", "--port", String(opt.port), "--strictPort"],
    { stdio: "ignore", shell: onWin },
  );
  const shutdown = () => {
    try {
      if (onWin) {
        // `shell: true` means what we actually spawned is cmd.exe, and killing
        // THAT leaves the vite process it launched running — an orphan holding
        // the port, which the next run would have silently photographed (see the
        // pre-flight check above; it exists because this leak went unnoticed for
        // a day). /T takes the whole tree with it.
        spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        server.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  };
  process.on("exit", shutdown);
  process.on("SIGINT", () => {
    shutdown();
    process.exit(1);
  });

  let browser;
  try {
    await waitForServer(base, 60000);
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1500, height: 1200 },
      deviceScaleFactor: opt.scale,
    });

    for (const id of ids) {
      await page.goto(`${base}/#/test/${id}`);
      // Generous wait: a cold Vite dev server compiles modules on first load,
      // which can take well over 8s before the stage sets window.__game.
      await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });

      // Flat backdrop (unless --backdrop): click the 🌳 BG button.
      if (!opt.backdrop) {
        await page.getByRole("button", { name: /BG/ }).click();
      }
      // Debug overlay (the driving-lines): read the current state and toggle
      // the button so it ends up in the requested state (on unless --no-debug),
      // independent of the app's default.
      const debugOn = await page.evaluate(
        () => !!document.querySelector(".test-stage.debug"),
      );
      if (debugOn !== opt.debug) {
        await page.getByRole("button", { name: "Debug", exact: true }).click();
      }
      // Density via the Cars slider (v-model.number).
      const slider = page.locator(".stage-cars-range");
      if (await slider.count()) {
        await slider.fill(String(opt.density));
        await slider.dispatchEvent("input");
      }

      // Tycoon boards open with every train WAITING behind its fare pin, so a
      // plain shot of one is a still life. --send clicks every pin — that click
      // IS the dispatch verb — so the settle window below catches the board in
      // motion, including states that only exist once trains are rolling (a pin
      // held by another train's reserved block). Pair it with a short --wait:
      // 4.5s is long enough for a small board to finish its runs and go quiet.
      if (opt.send) {
        const pins = page.locator(".fare-pin");
        for (let i = 0, n = await pins.count(); i < n; i++) {
          // A pin can vanish between the count and the click (its train parks),
          // and one that is already gone is not an error worth failing a shot for.
          await pins
            .nth(i)
            .click({ force: true, timeout: 2000 })
            .catch(() => {});
        }
      }

      // Grow the viewport to fit the whole board BEFORE settling. A screenshot
      // clip cannot reach outside the viewport, so a tall map (e.g. an 8-row
      // scenario at 200px/tile) would otherwise be silently cropped — and the
      // cropped-off part is often where cars spawn, so the shot looks empty too.
      const needed = await page.evaluate(() => ({
        w: Math.ceil(document.documentElement.scrollWidth),
        h: Math.ceil(document.documentElement.scrollHeight),
      }));
      const MAX = 4000; // keep deviceScaleFactor×size within reason
      await page.setViewportSize({
        width: Math.min(MAX, Math.max(1500, needed.w)),
        height: Math.min(MAX, Math.max(1200, needed.h)),
      });

      await page.waitForTimeout(opt.wait);

      // Tight clip = union bbox of the non-empty tiles, padded.
      const clip = await page.evaluate(() => {
        const tiles = Array.from(document.querySelectorAll(".tile-component"));
        if (!tiles.length) return null;
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity;
        for (const t of tiles) {
          const r = t.getBoundingClientRect();
          x0 = Math.min(x0, r.left);
          y0 = Math.min(y0, r.top);
          x1 = Math.max(x1, r.right);
          y1 = Math.max(y1, r.bottom);
        }
        const p = 8;
        return {
          x: Math.max(0, x0 - p),
          y: Math.max(0, y0 - p),
          width: x1 - x0 + p * 2,
          height: y1 - y0 + p * 2,
        };
      });

      const suffix = opt.label ? `-${opt.label}` : "";
      const path = `${opt.out}/${id}${suffix}.png`;
      await page.screenshot({ path, clip: clip ?? undefined });
      console.log(`shot: ${path}`);
    }
  } finally {
    if (browser) await browser.close();
    shutdown();
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
