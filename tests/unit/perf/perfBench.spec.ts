import { describe, it, expect } from "vitest";
import { performance } from "node:perf_hooks";
import { createGame, TrainDef } from "@/game";
import { sandboxMode } from "@/modes/sandbox";
import { citizensMode } from "@/modes/citizens";
import { GameMode } from "@/modes/types";
import { scenarioById } from "@/levels/test/index";
import { TestScenario } from "@/levels/test/scenario";
import { Level } from "@/tiles/model";
import { createRoadSim, TrafficConfig } from "@/sim/road";

// THE PERF BENCH — measurement, not verification. It times the headless world
// tick (`game.advance`) on the stress board (/test/perfworld) and the road sim
// alone at rising car counts, and PRINTS the numbers; the one assertion is a
// formality. Opt-in, because a benchmark in CI is noise that costs minutes:
//
//   PowerShell:  $env:PERF='1'; npx vitest run tests/unit/perf/perfBench.spec.ts
//   bash:        PERF=1 npx vitest run tests/unit/perf/perfBench.spec.ts
//
// Interpreting the output: a 60fps frame budget is 16.7ms, and the sim tick is
// only the MODEL's share of it — rendering (DOM writes, Vue mirrors) comes on
// top in a browser. A tick average above ~4ms here is a red flag; the browser
// column of the same story is measured separately (see the perf report).
//
// The loops yield to the event loop every few hundred ticks: vitest's worker
// RPC has a hardcoded 60s timeout that a long synchronous loop starves (see
// tests/unit/setup.ts) — a bench that runs minutes MUST breathe.
const PERF = !!process.env.PERF;
const itPerf = PERF ? it : it.skip;

const TICK = 1 / 60;

function buildTrainDefs(s: TestScenario): TrainDef[] {
  return Object.values(s.trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
    destinations: (t.routeDestinations ?? []).map(d => d.to),
    ...(t.line?.length ? { line: t.line } : {}),
    spawnAtSec: t.spawnAtSec,
  }));
}

function cloneLevel(level: Level): Level {
  return JSON.parse(JSON.stringify(level));
}

interface WindowStat {
  at: number; // sim-seconds at window end
  avg: number;
  p95: number;
  max: number;
  note: string;
}

// Run `step(dt)` for `seconds` sim-seconds, timing every tick; report stats per
// `windowSec` window. `note()` labels each window (e.g. the live car count).
async function bench(
  step: (dt: number) => void,
  seconds: number,
  windowSec: number,
  note: () => string,
): Promise<WindowStat[]> {
  const out: WindowStat[] = [];
  const perWindow = Math.round(windowSec / TICK);
  let durations: number[] = [];
  let ticks = 0;
  const total = Math.round(seconds / TICK);
  for (let i = 0; i < total; i++) {
    const t0 = performance.now();
    step(TICK);
    durations.push(performance.now() - t0);
    ticks++;
    if (ticks % 300 === 0) await new Promise(r => setImmediate(r));
    if (durations.length >= perWindow) {
      const sorted = [...durations].sort((a, b) => a - b);
      out.push({
        at: Math.round((i + 1) * TICK),
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        p95: sorted[Math.floor(sorted.length * 0.95)],
        max: sorted[sorted.length - 1],
        note: note(),
      });
      durations = [];
    }
  }
  return out;
}

function print(label: string, stats: WindowStat[]): void {
  console.log(`\n== ${label} ==`);
  console.log("  simT   avg ms   p95 ms   max ms   state");
  for (const w of stats) {
    console.log(
      `  ${String(w.at).padStart(4)}s` +
        `  ${w.avg.toFixed(3).padStart(7)}` +
        `  ${w.p95.toFixed(3).padStart(7)}` +
        `  ${w.max.toFixed(2).padStart(7)}` +
        `   ${w.note}`,
    );
  }
}

function gameFor(scenarioId: string, traffic?: TrafficConfig | null, mode?: GameMode) {
  const s = scenarioById(scenarioId);
  if (!s) throw new Error(`no scenario ${scenarioId}`);
  const game = createGame(
    cloneLevel(s.level),
    buildTrainDefs(s),
    200,
    mode ?? sandboxMode,
    1,
    s.colors,
    traffic === null ? undefined : (traffic ?? s.traffic),
    `perf:${scenarioId}`,
  );
  // What PlayView does on mount: put the authored bus lines in service and
  // start the objective, so the citizen/bus layers actually run headless.
  for (const stops of s.busLines ?? []) game.buyBus(game.createLine(stops));
  game.startObjective();
  return game;
}

describe("perf bench (PERF=1 to run)", () => {
  itPerf(
    "game.advance on demoworld (baseline, authored traffic)",
    async () => {
      const game = gameFor("demoworld");
      print(
        "demoworld 20x14 — 3 trains, maxCars 26",
        await bench(dt => game.advance(dt), 90, 15, () => ""),
      );
      expect(true).toBe(true);
    },
    600_000,
  );

  itPerf(
    "game.advance on perfworld, trains only (roads empty)",
    async () => {
      const game = gameFor("perfworld", { maxCars: 0 });
      print(
        "perfworld 40x28 — 8 trains, 0 cars",
        await bench(dt => game.advance(dt), 90, 15, () => ""),
      );
      expect(true).toBe(true);
    },
    600_000,
  );

  itPerf(
    "game.advance on perfworld, authored traffic (fills to 160 cars)",
    async () => {
      const game = gameFor("perfworld");
      print(
        "perfworld 40x28 — 8 trains, filling to maxCars 160",
        await bench(dt => game.advance(dt), 150, 15, () => ""),
      );
      expect(true).toBe(true);
    },
    600_000,
  );

  itPerf(
    "game.advance on perfcity (everything at once, citizens mode)",
    async () => {
      const game = gameFor("perfcity", undefined, citizensMode);
      print(
        "perfcity 40x28 — 7 trains, 2 bus lines, 4 towns, maxCars 140",
        await bench(dt => game.advance(dt), 150, 15, () => ""),
      );
      expect(true).toBe(true);
    },
    600_000,
  );

  itPerf(
    "attribution: what the crossing gate costs the road step",
    async () => {
      // HISTORY, and the shape of the win. The road sim asks "is this tile
      // closed?" per route tile per car per tick. That predicate used to be
      // `sim.reservedBy(id) || sim.occupiedBy(id)` — two full scans over the
      // trains, `occupiedBy` rebuilding each one's body claim keys — so the gate
      // alone measured ~630 calls and ~3.5ms a tick, about a quarter of the
      // whole tick. It is now one `claimSnapshot()` per tick behind a Set
      // (2026-08-22); the per-tile counters below should read ~0, and
      // `tests/unit/sim/claimSnapshot.spec.ts` is what fails if polling returns.
      const game = gameFor("perfworld");
      const sim = game.sim as unknown as {
        reservedBy(id: string): string | undefined;
        occupiedBy(id: string): string | undefined;
        claimSnapshot(): unknown;
      };
      const counts = { perTile: 0, snapshots: 0, snapshotMs: 0 };
      const origR = sim.reservedBy.bind(sim);
      const origO = sim.occupiedBy.bind(sim);
      const origS = sim.claimSnapshot.bind(sim);
      sim.reservedBy = id => {
        counts.perTile++;
        return origR(id);
      };
      sim.occupiedBy = id => {
        counts.perTile++;
        return origO(id);
      };
      sim.claimSnapshot = () => {
        const t = performance.now();
        const r = origS();
        counts.snapshotMs += performance.now() - t;
        counts.snapshots++;
        return r;
      };
      const stats = await bench(dt => game.advance(dt), 60, 15, () => "");
      print("perfworld with traffic — total tick while instrumented", stats);
      const ticks = 60 * 60;
      console.log(
        `  crossing gate: ${counts.perTile} per-tile queries ` +
          `(${(counts.perTile / ticks).toFixed(2)}/tick), ` +
          `${counts.snapshots} snapshots costing ${counts.snapshotMs.toFixed(0)}ms ` +
          `= ${(counts.snapshotMs / ticks).toFixed(3)}ms/tick`,
      );
      expect(true).toBe(true);
    },
    600_000,
  );

  itPerf(
    "road sim alone on perfworld at rising car caps",
    async () => {
      const s = scenarioById("perfworld");
      if (!s) throw new Error("no perfworld");
      for (const cap of [50, 100, 200, 400]) {
        const level = cloneLevel(s.level);
        let w = 0;
        let h = 0;
        for (const id of Object.keys(level)) {
          const [x, y] = id.split(",").map(Number);
          w = Math.max(w, x + 1);
          h = Math.max(h, y + 1);
        }
        const road = createRoadSim({
          level,
          width: w,
          height: h,
          seed: 7,
          maxCars: cap,
          fillFast: true,
          mix: s.traffic?.mix,
        });
        const open = () => false;
        print(
          `roadSim only, cap ${cap} (fillFast, crossings open)`,
          await bench(
            dt => road.step(dt, open),
            60,
            15,
            () => `${road.sample().length} cars live`,
          ),
        );
      }
      expect(true).toBe(true);
    },
    600_000,
  );
});
