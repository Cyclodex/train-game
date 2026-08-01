#!/usr/bin/env node
// Render-level audit of every /test scenario, in a real browser.
//
//   npm run probe                 # all scenarios
//   npm run probe -- turnlanes    # just these
//
// `npm run test:unit` proves the SIMULATION behaves; `npm run shot` gives you a
// picture to judge by eye. This sits between them: it loads each scenario in a
// real browser and asserts the things that are cheap to check mechanically but
// tedious (and unreliable) to check by looking — across all 68 maps rather than
// the handful anyone will actually open.
//
// Checks, per scenario:
//   layout    every tile renders in the grid cell its coordinate names. Catches
//             anything that displaces the board (a stray grid ITEM shifted every
//             tile by one cell per train until 2026-07, on /play too).
//   mismatch  no tile paints the red lane-count-mismatch surface.
//   console   no console errors while loading and running.
//   arrows    every lane-drop merge arrow points FORWARD along its road and leans
//             TOWARD the lanes that survive. Getting this backwards is a recurring
//             bug (`Math.sign(laneOff)` broke it wherever a closing lane sat
//             exactly on the centreline), and it is nearly invisible by eye — the
//             arrows are small and a wrong one still looks like an arrow.
//
// Exits non-zero on any failure, so it can gate a change the way the unit tests do.

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChromium } from "./browser.mjs";

const TILE = 200;

function parseArgs(argv) {
  const ids = [];
  const opt = { port: 5182, settle: 900 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opt.port = Number(argv[++i]);
    else if (a === "--settle") opt.settle = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    else ids.push(a);
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

// Runs in the page. Returns the findings for the scenario currently loaded.
function auditInPage(TILE_UNITS) {
  const grid = document.querySelector(".level");
  if (!grid) return { fatal: "no .level element" };
  const gr = grid.getBoundingClientRect();
  const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  const tiles = Array.from(grid.children).filter(k => k.classList.contains("level-tile"));

  // The board is scaled by the camera when a world is bigger than the window, so
  // the grid pitch is read off a rendered tile rather than assumed to be the
  // native 200px — otherwise every check below just measures the zoom level.
  const pitch = tiles.length ? tiles[0].getBoundingClientRect().width : 0;
  const tile = pitch > 1 ? pitch : 200;

  // layout: gridCells is emitted row-major, so DOM index i must sit at
  // (i % cols, floor(i / cols)).
  const misplaced = [];
  tiles.forEach((t, i) => {
    const r = t.getBoundingClientRect();
    const col = Math.round((r.left - gr.left) / tile);
    const row = Math.round((r.top - gr.top) / tile);
    const wantCol = i % cols;
    const wantRow = Math.floor(i / cols);
    if (col !== wantCol || row !== wantRow) {
      misplaced.push(`index ${i} wanted (${wantCol},${wantRow}) rendered at (${col},${row})`);
    }
  });

  // arrows: a merge arrow lives inside a tile's SVG, in that tile's local
  // coordinates. Its road runs port-to-port, so the arrow's forward component
  // must match the direction of travel and its lateral component must point at
  // the surviving lanes. Both are read off the shaft: the shaft is drawn
  // tail -> head, head being the pointy end.
  const arrowFaults = [];
  tiles.forEach((t, i) => {
    const shafts = t.querySelectorAll(".road-drop-arrow-shaft");
    const at = `tile (${i % cols},${Math.floor(i / cols)})`;
    // A junction is never a reducer: its arms are sized independently and it
    // paints its own width transitions. A lane-drop gore or merge arrow on a
    // junction tile means the drop logic mistook the junction's opposite-port
    // pairs for an ordinary straight edge and drew a Sperrfläche across the
    // middle of the crossroads.
    const kind = (t.firstElementChild?.getAttribute("class") || "").match(/tile-kind--([a-z-]+)/)?.[1] ?? "";
    if (/cross|junction/.test(kind)) {
      const gores = t.querySelectorAll(".road-gore-border").length;
      if (gores || shafts.length) {
        arrowFaults.push(
          `${at}: lane-drop marking painted on a ${kind} tile (${gores} gore(s), ${shafts.length} arrow(s))`,
        );
      }
    }
    if (!shafts.length) return;
    for (const s of shafts) {
      const n = (s.getAttribute("d") || "").match(/-?\d+\.?\d*/g)?.map(Number);
      if (!n || n.length < 4) continue;
      const [x0, y0, x1, y1] = n;
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
        arrowFaults.push(`${at}: degenerate arrow`);
        continue;
      }
      // Which axis is the road? The longer component of the shaft is forward,
      // since the lean is only ever a fraction of a lane.
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const forward = horizontal ? Math.sign(dx) : Math.sign(dy);
      const lateral = horizontal ? Math.sign(dy) : Math.sign(dx);
      if (lateral === 0) {
        arrowFaults.push(`${at}: arrow has no lean, so it names no merge direction`);
        continue;
      }
      // The surviving lanes are on the side the road KEEPS. Find them from the
      // painted surface: the tile's road polygon is widest where all lanes are
      // present, so use the tile centre as the reference instead — an arrow must
      // lean toward the centre line of its own carriageway, never off the road.
      // In tile-local coordinates the carriageway centre is TILE/2 on the lateral
      // axis; leaning toward it means the lateral sign points at the centre.
      // Path data is in the tile's own SVG viewBox (always TILE units), which the
      // CSS scale does not touch — so this uses TILE, not the measured pitch.
      const lateralPos = horizontal ? (y0 + y1) / 2 : (x0 + x1) / 2;
      const towardCentre = Math.sign(TILE_UNITS / 2 - lateralPos);
      // A one-way road's lanes are all on one side of the tile centre, so
      // "toward the centre" is the merge direction there too: it is the side the
      // through lanes sit on. Only flag a clear contradiction.
      if (towardCentre !== 0 && lateral !== towardCentre) {
        arrowFaults.push(
          `${at}: merge arrow leans AWAY from the surviving lanes ` +
            `(lateral ${lateral > 0 ? "+" : "-"}, centre is ${towardCentre > 0 ? "+" : "-"})`,
        );
      }
      if (forward === 0) arrowFaults.push(`${at}: merge arrow has no forward direction`);
    }
  });

  return {
    tiles: tiles.length,
    filled: tiles.filter(t => t.firstElementChild).length,
    misplaced,
    mismatch: grid.querySelectorAll(".road-surface--mismatch").length,
    arrowFaults,
  };
}

// Drag the board to each extreme and check the matching world edge comes flush
// with the viewport. Skipped when the board already fits — there is nothing to
// reach. Uses the real mouse so the pointer handlers see genuine movementX/Y.
async function checkCameraReach(page) {
  const vpSel = ".world-viewport, .stage-viewport";
  const box = await page.evaluate(sel => {
    const vp = document.querySelector(sel);
    const lvl = document.querySelector(".level");
    if (!vp || !lvl) return null;
    const v = vp.getBoundingClientRect();
    const l = lvl.getBoundingClientRect();
    return {
      overflows: l.width > v.width + 2 || l.height > v.height + 2,
      cx: v.left + v.width / 2,
      cy: v.top + v.height / 2,
      w: v.width,
      h: v.height,
    };
  }, vpSel);
  if (!box || !box.overflows) return [];

  // Drag from the viewport centre toward one edge, in steps, then read the gap.
  const dragTo = async (dx, dy) => {
    await page.mouse.move(box.cx, box.cy);
    await page.mouse.down();
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(box.cx + dx * (i + 1) * 0.08, box.cy + dy * (i + 1) * 0.08);
    }
    await page.mouse.up();
  };
  const gaps = () =>
    page.evaluate(sel => {
      const v = document.querySelector(sel).getBoundingClientRect();
      const l = document.querySelector(".level").getBoundingClientRect();
      return {
        bottom: l.bottom - v.bottom,
        right: l.right - v.right,
        top: v.top - l.top,
        left: v.left - l.left,
      };
    }, vpSel);

  const faults = [];
  const SLACK = 4; // the board's 1px border plus rounding
  // Drag UP/LEFT moves the view toward the bottom/right of the world.
  await dragTo(-box.w * 3, -box.h * 3);
  const far = await gaps();
  if (far.bottom > SLACK) faults.push(`${Math.round(far.bottom)}px of world below the viewport is unreachable`);
  if (far.right > SLACK) faults.push(`${Math.round(far.right)}px of world right of the viewport is unreachable`);
  await dragTo(box.w * 3, box.h * 3);
  const near = await gaps();
  if (near.top > SLACK) faults.push(`${Math.round(near.top)}px of world above the viewport is unreachable`);
  if (near.left > SLACK) faults.push(`${Math.round(near.left)}px of world left of the viewport is unreachable`);
  return faults;
}

async function main() {
  const { ids: only, opt } = parseArgs(process.argv.slice(2));
  const base = `http://localhost:${opt.port}`;
  const onWin = process.platform === "win32";
  const server = spawn(
    onWin ? "npm.cmd" : "npm",
    ["run", "dev", "--", "--port", String(opt.port), "--strictPort"],
    // Own process group, so the vite the npm launcher spawns dies with it — see
    // `shutdown`, and the same note in shoot.mjs.
    { stdio: "ignore", shell: onWin, detached: !onWin },
  );
  const shutdown = () => {
    try {
      // `npm run dev` LAUNCHES vite; signalling the launcher alone orphans the
      // server, which then holds the port against the next run.
      if (onWin) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-server.pid, "SIGTERM");
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
  let failures = 0;
  try {
    await waitForServer(base, 60000);
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

    const consoleErrors = [];
    page.on("console", m => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    page.on("pageerror", e => consoleErrors.push(String(e).slice(0, 200)));

    // The registry is the source of truth for what exists, so walk the picker
    // rather than duplicating the list here — which also proves every node of the
    // drill-down actually navigates somewhere.
    const linksOn = async hash => {
      await page.goto(`${base}/#${hash}`);
      await page
        .waitForFunction(() => document.querySelectorAll("a[href*='#/test/']").length > 0, null, {
          timeout: 15000,
        })
        .catch(() => {});
      return page.evaluate(() =>
        [...new Set([...document.querySelectorAll("a[href*='#/test/']")].map(a =>
          a.getAttribute("href").split("#")[1],
        ))],
      );
    };
    let ids = only;
    if (!ids.length) {
      const found = new Set();
      for (const domain of await linksOn("/test")) {
        for (const category of await linksOn(domain)) {
          for (const scenario of await linksOn(category)) {
            const parts = scenario.split("/").filter(Boolean); // test/domain/category/id
            if (parts.length >= 4) found.add(parts[3]);
          }
        }
      }
      ids = [...found];
    }

    console.log(`probing ${ids.length} scenario(s)\n`);
    for (const id of ids) {
      consoleErrors.length = 0;
      await page.goto(`${base}/#/test/${id}`);
      await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(opt.settle);
      const r = await page.evaluate(auditInPage, TILE);

      // camera: on a board bigger than the window, every edge of the world must
      // be reachable by panning. This is invisible to unit tests — the clamp
      // maths is right in isolation; what broke it was `viewportSize` being a
      // CACHED computed reading non-reactive `$refs`, so it clamped against the
      // whole window and left the bottom of a big world unreachable by exactly
      // the chrome's height.
      const cameraFaults = await checkCameraReach(page);

      const problems = [];
      if (r.fatal) problems.push(r.fatal);
      for (const c of cameraFaults) problems.push(`camera: ${c}`);
      for (const m of r.misplaced ?? []) problems.push(`layout: ${m}`);
      if (r.mismatch) problems.push(`mismatch: ${r.mismatch} tile(s) paint the red lane-count mismatch`);
      for (const a of r.arrowFaults ?? []) problems.push(`arrows: ${a}`);
      for (const e of consoleErrors) problems.push(`console: ${e}`);

      if (problems.length) {
        failures++;
        console.log(`FAIL ${id}`);
        for (const p of problems) console.log(`     ${p}`);
      } else {
        console.log(`ok   ${id}  (${r.filled}/${r.tiles} tiles)`);
      }
    }
  } finally {
    if (browser) await browser.close();
    shutdown();
  }

  console.log(failures ? `\n${failures} scenario(s) with problems` : "\nall scenarios clean");
  process.exit(failures ? 1 : 0);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
