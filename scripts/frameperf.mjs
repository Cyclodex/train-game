#!/usr/bin/env node
// THE FRAME RATE A PLAYER ACTUALLY SEES.
//
//   node scripts/frameperf.mjs [--board perfcity] [--seconds 20] [--density 60]
//
// The headless bench (tests/unit/perf/) times `game.advance()` — the MODEL's
// share of a tick, and nothing else. That is the right meter for simulation
// work, and it is blind to half the game: the render mirrors, the DOM writes and
// Vue's re-renders all live in `frame()`, which the bench never calls. This
// measures the other half, in the only place it exists — a real browser.
//
// IT LAUNCHES A VISIBLE WINDOW ON PURPOSE. A hidden or background tab is not a
// slower version of the same thing: Chrome pauses `requestAnimationFrame`
// outright and deprioritises the whole renderer, so a measurement taken there is
// not a measurement of this game (docs/KNOWHOW.md → PERF BENCH). Leave the
// window on top and the machine alone while it runs.
//
// What it reports, per run:
//   fps        — from the intervals between animation frames. THE number: it is
//                what "smooth" means, and it is capped by the display (60 here),
//                so a game with room to spare reads 60 however fast it is.
//   frame ms   — time spent inside the game's own rAF callback (sim + mirrors +
//                DOM writes). This is the headroom number, and the one that
//                still moves once fps has hit the display cap.
//   long       — share of frames whose INTERVAL exceeded 20ms / 33ms, i.e. the
//                stutter a player notices rather than an average they do not.
//
// Compare variants the way docs/PERFORMANCE.md insists: alternate them back to
// back, three reps each, and look for separation between the groups. A single
// before/after pair on this machine measures the machine.

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChromium } from "./browser.mjs";

function parseArgs(argv) {
  const opt = {
    board: "perfcity",
    seconds: 20,
    warmup: 8,
    density: 60,
    port: 5183,
    label: "",
    json: false,
    profile: false,
    // ABLATIONS — the way to find out what a frame is actually paying for.
    // Each one removes ONE layer and re-measures; the gap is that layer's bill.
    //   sim      — pause the world, keep drawing it (renders a static scene)
    //   cars     — hide every road vehicle (paint + patch of the busiest layer)
    //   tiles    — hide the whole board (leaves the HUD: is it the world at all?)
    //   nomirror — keep the world drawn but stop the reactive mirrors updating
    ablate: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--board") opt.board = argv[++i];
    else if (a === "--seconds") opt.seconds = Number(argv[++i]);
    else if (a === "--warmup") opt.warmup = Number(argv[++i]);
    else if (a === "--density") opt.density = Number(argv[++i]);
    else if (a === "--port") opt.port = Number(argv[++i]);
    else if (a === "--label") opt.label = argv[++i];
    else if (a === "--json") opt.json = true;
    else if (a === "--profile") opt.profile = true;
    else if (a === "--ablate") opt.ablate = argv[++i];
    else throw new Error(`unknown option: ${a}`);
  }
  return opt;
}

async function portInUse(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

// Same trap `shoot.mjs` documents: with --strictPort a server already on the
// port makes OURS exit, but the port still answers — so we would happily measure
// somebody else's checkout. Refuse instead.
async function waitForServer(url, timeoutMs, died) {
  const deadline = Date.now() + timeoutMs;
  let ours = true;
  died?.then(() => {
    ours = false;
  });
  if (died) await Promise.race([died, sleep(1500)]);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        if (!ours) {
          throw new Error(
            `${url} is serving, but our dev server exited — the port is taken. Pass --port <n>.`,
          );
        }
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("--port")) throw e;
    }
    await sleep(300);
  }
  throw new Error(`dev server did not start at ${url} within ${timeoutMs}ms`);
}

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const base = `http://localhost:${opt.port}`;
  if (await portInUse(base)) {
    throw new Error(`something already serves ${base} — stop it or pass --port <n>.`);
  }

  const onWin = process.platform === "win32";
  const server = spawn(
    onWin ? "npm.cmd" : "npm",
    ["run", "dev", "--", "--port", String(opt.port), "--strictPort"],
    { stdio: "ignore", shell: onWin, detached: !onWin },
  );
  const shutdown = () => {
    try {
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
  try {
    await waitForServer(base, 60000, new Promise(res => server.once("exit", res)));
    // headless:false — see the header. The measurement is meaningless otherwise.
    browser = await launchChromium({ headless: false });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

    // Wrap rAF BEFORE any app code runs, so the game's own loop is the thing
    // being timed rather than a wrapper installed halfway through a session.
    await page.addInitScript(() => {
      const w = window;
      w.__fp = { cb: [], ts: [] };
      const orig = w.requestAnimationFrame.bind(w);
      w.requestAnimationFrame = cb =>
        orig(t => {
          const s = performance.now();
          cb(t);
          w.__fp.cb.push(performance.now() - s);
          w.__fp.ts.push(t);
        });
    });

    await page.goto(`${base}/#/play?board=${opt.board}`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
    // Traffic density, and past any Ready card — a board sitting on its briefing
    // renders a frozen world and would measure nothing.
    await page.evaluate(async d => {
      const cfg = (await import("/src/gameConfig.ts")).gameConfig;
      cfg.maxCars = d;
      window.__game.startObjective();
    }, opt.density);

    await sleep(opt.warmup * 1000);

    if (opt.ablate) {
      await page.evaluate(which => {
        const css = (sel, rule) => {
          const el = document.createElement("style");
          el.textContent = `${sel} { ${rule} }`;
          document.head.appendChild(el);
        };
        if (which === "sim") window.__game.paused.value = true;
        if (which === "cars") css(".road-car", "display: none !important");
        if (which === "tiles") css(".grid, .board, .world", "display: none !important");
        if (which === "nomirror") {
          // Freeze the reactive mirrors without touching the sim: Vue then has
          // nothing to re-render, while the world still steps and the sprites
          // still get their inline transforms.
          const g = window.__game;
          for (const k of ["signalAspects", "reservations", "occupied", "stationQueues"]) {
            Object.defineProperty(g, k, { value: Object.freeze({}), configurable: true });
          }
        }
      }, opt.ablate);
      await sleep(2000);
    }

    // The BROWSER's own split of the frame, which a JS profiler cannot give:
    // script vs style recalculation vs layout. On a page whose world is tens of
    // thousands of SVG nodes this is the number that decides whether the fix is
    // "write less JS" or "stop putting the world in the DOM".
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const metricsBefore = await cdp.send("Performance.getMetrics");

    const state = await page.evaluate(() => {
      window.__fp.cb.length = 0;
      window.__fp.ts.length = 0;
      return {
        visibility: document.visibilityState,
        nodes: document.querySelectorAll("*").length,
      };
    });
    // WHERE the frame goes, sampled by the JS Self-Profiling API. Only usable
    // because the dev server sends `Document-Policy: js-profiling`
    // (vite.config.ts) and because this window is VISIBLE — in a throttled tab
    // the profiler barely samples at all and ~90% of its samples come back
    // unattributed, which reads as "nothing is slow".
    if (opt.profile) {
      await page.evaluate(async () => {
        window.__prof = new Profiler({ sampleInterval: 1, maxBufferSize: 900000 });
      });
    }

    await sleep(opt.seconds * 1000);
    const raw = await page.evaluate(() => ({
      cb: window.__fp.cb.slice(),
      ts: window.__fp.ts.slice(),
      cars: document.querySelectorAll(".road-car").length,
    }));

    const metricsAfter = await cdp.send("Performance.getMetrics");
    const metricVal = (m, name) => m.metrics.find(x => x.name === name)?.value ?? 0;
    const delta = name => metricVal(metricsAfter, name) - metricVal(metricsBefore, name);
    const wall = delta("Timestamp") || opt.seconds;
    const share = name => (delta(name) / (wall || 1)) * 100;
    const budget = {
      wallSec: +wall.toFixed(1),
      scriptPct: +share("ScriptDuration").toFixed(1),
      stylePct: +share("RecalcStyleDuration").toFixed(1),
      layoutPct: +share("LayoutDuration").toFixed(1),
      taskPct: +share("TaskDuration").toFixed(1),
    };

    let profile = null;
    if (opt.profile) {
      profile = await page.evaluate(async () => {
        const trace = await window.__prof.stop();
        // SELF time per frame: the leaf of each sample's stack. Aggregating the
        // leaf (rather than the whole stack) is what separates "this function is
        // slow" from "this function is on the path to something slow".
        const counts = new Map();
        let unattributed = 0;
        for (const s of trace.samples) {
          if (s.stackId === undefined) {
            unattributed++;
            continue;
          }
          const f = trace.frames[trace.stacks[s.stackId].frameId];
          const res = f.resourceId !== undefined ? String(trace.resources[f.resourceId]) : "";
          const file = res.split("/").pop()?.split("?")[0] ?? "";
          const key = `${f.name || "(anon)"} [${file}:${f.line ?? "?"}]`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const total = trace.samples.length;
        return {
          total,
          unattributedPct: (unattributed / (total || 1)) * 100,
          top: [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 24)
            .map(([name, n]) => ({ name, pct: (n / (total || 1)) * 100 })),
        };
      });
    }

    const gaps = [];
    for (let i = 1; i < raw.ts.length; i++) gaps.push(raw.ts[i] - raw.ts[i - 1]);
    const span = raw.ts.length > 1 ? raw.ts[raw.ts.length - 1] - raw.ts[0] : 0;
    const fps = span > 0 ? ((raw.ts.length - 1) / span) * 1000 : 0;
    const cbSorted = [...raw.cb].sort((a, b) => a - b);
    const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    const over = (a, ms) => (a.filter(v => v > ms).length / (a.length || 1)) * 100;

    const out = {
      label: opt.label,
      board: opt.board,
      visibility: state.visibility,
      frames: raw.ts.length,
      fps: +fps.toFixed(1),
      frameMsMean: +mean(raw.cb).toFixed(2),
      frameMsP50: +pct(cbSorted, 0.5).toFixed(2),
      frameMsP95: +pct(cbSorted, 0.95).toFixed(2),
      longOver20Pct: +over(gaps, 20).toFixed(1),
      longOver33Pct: +over(gaps, 33).toFixed(1),
      cars: raw.cars,
      domNodes: state.nodes,
      ablate: opt.ablate || null,
      ...budget,
    };

    if (opt.json) {
      console.log(JSON.stringify(out));
    } else {
      const tag = opt.label ? ` [${opt.label}]` : "";
      console.log(`\n== ${opt.board}${tag} — ${opt.seconds}s in a VISIBLE window ==`);
      if (out.visibility !== "visible") {
        console.log(`  !! visibilityState=${out.visibility} — the window was not visible,`);
        console.log(`     so rAF was throttled. These numbers are not real.`);
      }
      console.log(`  fps              ${out.fps}   (${out.frames} frames)`);
      console.log(`  frame ms  mean   ${out.frameMsMean}   p50 ${out.frameMsP50}   p95 ${out.frameMsP95}`);
      console.log(`  long frames      ${out.longOver20Pct}% over 20ms, ${out.longOver33Pct}% over 33ms`);
      console.log(`  cars on screen   ${out.cars}      DOM nodes ${out.domNodes}`);
      console.log(`  browser split    script ${out.scriptPct}%  style ${out.stylePct}%  ` +
        `layout ${out.layoutPct}%  (all tasks ${out.taskPct}% of wall)`);
      if (profile) {
        console.log(`\n  -- self time, ${profile.total} samples ` +
          `(${profile.unattributedPct.toFixed(1)}% unattributed) --`);
        for (const row of profile.top) {
          console.log(`  ${row.pct.toFixed(1).padStart(5)}%  ${row.name}`);
        }
      }
    }
  } finally {
    await browser?.close();
    shutdown();
  }
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
