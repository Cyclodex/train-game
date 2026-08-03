#!/usr/bin/env node
// Reproducible scenario screenshots for the ticket workflow.
//
//   npm run shot -- <scenarioId|#route> [more ...] [options]
//
// Loads a /test scenario in a real browser with the Debug overlay OFF (what a
// player actually sees) and the flat backdrop, lets traffic populate, and writes
// a tight PNG of just the road/rail tiles. Use it to attach a screenshot to a
// visual issue, and a before/after pair to a fix PR
// (see docs/TICKET_WORKFLOW.md → "Visual verification").
//
// The overlay is OFF BY DEFAULT because it paints OVER the thing most changes
// are about: the debug reservation tint and the cyan/amber driving-lines hide
// lane paint, terrain and depot art, so a shot taken with debug on can make a
// real change look like it did nothing. Pass `--debug` when the overlay itself
// is the subject (routing, lane centrelines, where a vehicle actually drives).
// The script does not merely assume the app's default — it READS the stage's
// current state and toggles the button until it matches what was asked for.
//
// An argument beginning with `#` is taken as a RAW HASH ROUTE rather than a
// scenario id, so anything the app can show can be photographed — the Ready
// card, a win overlay, the campaign screen — not just the /test stage:
//
//   npm run shot -- '#/play?mode=tycoon&board=dispatch' --label ready
//   npm run shot -- '#/campaign'
//
// Route shots differ in two ways, both because they are about CHROME, not the
// board: the stage-only BG/Debug/Cars controls are skipped (they do not exist
// outside /test — their absence is detected, not assumed), and the shot is the
// whole viewport rather than a tight clip around the tiles, since an overlay
// lives outside the tile bounding box.
//
// Options:
//   --out <dir>       output directory (default: screenshots/)
//   --label <name>    filename suffix, e.g. --label before  → roadoneway-before.png
//   --debug           show the debug overlay (driving-lines, reservation tint)
//   --no-debug        hide it — the default, accepted for compatibility
//   --backdrop        keep the themed backdrop (default: flat for clarity)
//   --send            click every fare pin before settling (Tycoon boards start
//                     with every train WAITING, so nothing on them moves — and
//                     states that only exist once trains are rolling, like a pin
//                     held by another train's block, are otherwise unshootable)
//   --start           click Start on a mode's Ready card, so the shot is of the
//                     mode RUNNING rather than of its briefing (network mode's
//                     passenger HUD, a crowd draining). No-op without a card.
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
import { launchChromium } from "./browser.mjs";

function parseArgs(argv) {
  const ids = [];
  const opt = {
    out: "screenshots",
    label: "",
    debug: false,
    backdrop: false,
    send: false,
    start: false,
    density: 60,
    wait: 4500,
    port: 5181,
    scale: 3,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--debug") opt.debug = true;
    else if (a === "--no-debug") opt.debug = false;
    else if (a === "--backdrop") opt.backdrop = true;
    else if (a === "--send") opt.send = true;
    else if (a === "--start") opt.start = true;
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
      "usage: npm run shot -- <scenarioId> [more ids] [--out dir] [--label before] [--debug]",
    );
  }
  return { ids, opt };
}

// `died` resolves if the spawned dev server exits. THE TRAP THIS CATCHES: with
// `--strictPort`, a server already on the port makes OURS exit immediately — but
// the port answers, so this would happily shoot whatever is running there. On a
// machine with several worktrees checked out that is a DIFFERENT CHECKOUT of this
// app, and the run then fails 30s later on `window.__game` with nothing to say
// why (or, worse, silently produces screenshots of somebody else's branch).
async function waitForServer(url, timeoutMs, died) {
  const deadline = Date.now() + timeoutMs;
  let ours = true;
  died?.then(() => {
    ours = false;
  });
  // Give the spawn long enough to fall over on a taken port BEFORE trusting the
  // first answer. Vite exits on `--strictPort` within a fraction of a second; a
  // healthy cold start takes several, so this costs nothing when the port is free
  // and is the whole difference between a clear message and a silent wrong shot.
  if (died) await Promise.race([died, sleep(1500)]);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        if (!ours) {
          throw new Error(
            `${url} is serving, but our dev server exited — the port is already ` +
              `taken (another worktree's \`npm run dev\`?). Pass --port <n> to use a free one.`,
          );
        }
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("--port")) throw e;
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
    // `detached` puts the npm launcher and the vite it spawns in their OWN
    // process group, so `shutdown` can take both. See there.
    { stdio: "ignore", shell: onWin, detached: !onWin },
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
        // THE SAME LEAK, ON POSIX. `npm run dev` is a launcher that spawns vite
        // as a child; SIGTERM to the launcher alone left vite holding the port,
        // so the very next run tripped the pre-flight check above and refused to
        // shoot anything. The negative pid signals the whole group.
        process.kill(-server.pid, "SIGTERM");
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
    await waitForServer(base, 60000, new Promise(res => server.once("exit", res)));
    browser = await launchChromium();
    const page = await browser.newPage({
      viewport: { width: 1500, height: 1200 },
      deviceScaleFactor: opt.scale,
    });

    for (const id of ids) {
      // `#…` = a raw hash route (any screen); anything else = a /test scenario.
      const isRoute = id.startsWith("#");
      await page.goto(isRoute ? `${base}/${id}` : `${base}/#/test/${id}`);
      // Generous wait: a cold Vite dev server compiles modules on first load,
      // which can take well over 8s before the stage sets window.__game. Screens
      // with no board (e.g. /campaign) never set it, so they settle on the load
      // state instead of timing out on a game that is never coming.
      const hasGame = !isRoute || id.includes("/play");
      if (hasGame) {
        await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
      } else {
        await page.waitForLoadState("networkidle").catch(() => {});
      }

      // Flat backdrop (unless --backdrop): click the 🌳 BG button. Stage-only
      // chrome from here down — detect it rather than assume it, so a route shot
      // outside /test skips what isn't there instead of failing on it.
      const bg = page.getByRole("button", { name: /BG/ });
      if (!opt.backdrop && (await bg.count())) {
        await bg.click();
      }
      // Debug overlay (the driving-lines): read the current state and toggle
      // the button so it ends up in the requested state (off unless --debug),
      // independent of the app's default. Absent outside /test, hence the count
      // — on a /play route there is no stage toggle, and `gameConfig.debug` is
      // false and NOT persisted, so those shots are debug-free by construction.
      const debugBtn = page.getByRole("button", { name: "Debug", exact: true });
      if (await debugBtn.count()) {
        const debugOn = await page.evaluate(
          () => !!document.querySelector(".test-stage.debug"),
        );
        if (debugOn !== opt.debug) await debugBtn.click();
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
      // A mode with a Ready card opens PAUSED behind it, so a plain shot is of
      // the card, not the game. --start clicks Start, which is the only way to
      // photograph a running mode (the passenger HUD filling, a crowd draining)
      // rather than its briefing. Harmless where there is no card.
      if (opt.start) {
        const startBtn = page.getByRole("button", { name: "Start", exact: true });
        if (await startBtn.count()) {
          await startBtn.click({ timeout: 2000 }).catch(() => {});
        }
      }

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

      // Tight clip = union bbox of the non-empty tiles, padded. A route shot is
      // about the CHROME (a Ready card, a win overlay, the campaign screen),
      // which lives outside the tile bounding box — so it takes the viewport.
      const clip = isRoute ? null : await page.evaluate(() => {
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
      // A route is not a filename: `#/play?mode=tycoon&board=dispatch` becomes
      // `play-mode-tycoon-board-dispatch`.
      const slug = isRoute
        ? id.replace(/^#\/?/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
        : id;
      const path = `${opt.out}/${slug}${suffix}.png`;
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
