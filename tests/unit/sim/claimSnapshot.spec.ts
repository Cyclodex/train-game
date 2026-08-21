import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { sandboxMode } from "@/modes/sandbox";
import { scenarioById } from "@/levels/test/index";
import { TestScenario } from "@/levels/test/scenario";
import { Level } from "@/tiles/model";

// `claimSnapshot()` exists ONLY to answer, in one pass, what `reservedBy` and
// `occupiedBy` answer one tile at a time — the crossing gate and the render
// mirrors ask about hundreds of tiles per tick and used to pay a full train
// scan for each (docs/PERFORMANCE.md). That makes its whole contract an
// EQUIVALENCE, and this is the test of it: for every tile of every board, over
// a run long enough to put trains on curves, in depots, over crossings and
// holding reservations, the snapshot must say exactly what the per-tile queries
// say — including the flyover level precedence, which is why `flyover` is in
// the board list.
//
// If this ever fails, the snapshot is not a faster spelling of the queries any
// more and every caller that swapped one for the other is quietly wrong.

// Sampling is deliberately sparse. The comparison calls the very queries the
// snapshot exists to replace, so it costs trains x tiles PER SAMPLED TILE — on
// the 1120-tile stress board a dense sweep is minutes of work and blows the
// suite's hang guard on a busy machine. The equivalence is structural, not
// statistical: a handful of samples spread across a run that puts trains on
// curves, in depots and holding blocks tests it as well as hundreds do.
// `warmup` is not padding: the states worth comparing only exist once trains
// are out of their depots and holding blocks, and the vacuity guard at the end
// of each case fails outright on a run that never got there (it caught exactly
// that on the first cut of the stress-board row).
const BOARDS: {
  id: string;
  ticks: number;
  warmup: number;
  every: number;
  noTraffic?: boolean;
}[] = [
  { id: "demoworld", ticks: 600, warmup: 0, every: 50 },
  { id: "flyover", ticks: 600, warmup: 0, every: 50 },
  { id: "crossing", ticks: 600, warmup: 0, every: 50 },
  { id: "signals", ticks: 600, warmup: 0, every: 50 },
  // The stress board earns its place — it is the one the callers were optimised
  // for — and runs here with the ROADS EMPTY. That is not a shortcut: a claim
  // is a TRAIN's, cars never make one, so the traffic contributes nothing to
  // what this test compares while costing ~50x the tick (docs/PERFORMANCE.md).
  // What matters — 1120 tiles and eight trains — is untouched.
  { id: "perfworld", ticks: 360, warmup: 120, every: 60, noTraffic: true },
];

function trainDefsOf(s: TestScenario): TrainDef[] {
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

function clone(level: Level): Level {
  return JSON.parse(JSON.stringify(level));
}

describe("claimSnapshot agrees with the per-tile queries", () => {
  for (const { id: boardId, ticks, warmup, every, noTraffic } of BOARDS) {
    it(`${boardId}: every tile, at every sampled tick`, () => {
      const s = scenarioById(boardId);
      expect(s, `scenario ${boardId} missing`).toBeTruthy();
      const scenario = s!;
      const game = createGame(
        clone(scenario.level),
        trainDefsOf(scenario),
        200,
        sandboxMode,
        1,
        scenario.colors,
        noTraffic ? { maxCars: 0 } : scenario.traffic,
        `claimsnap:${boardId}`,
      );
      game.startObjective();
      const tiles = Object.keys(scenario.level);

      // Sample repeatedly rather than once: a snapshot that happened to agree on
      // an empty board proves nothing, and the interesting states (a train
      // straddling two tiles, a block reserved ahead, a consist inside a depot)
      // each last only a few ticks.
      let sawOccupied = false;
      let sawReserved = false;
      for (let tick = 0; tick < ticks; tick++) {
        game.advance(1 / 60);
        if (tick < warmup || tick % every !== 0) continue;
        const snap = game.sim.claimSnapshot();
        for (const id of tiles) {
          expect(snap.occupied.get(id), `occupied@${id} tick ${tick}`).toBe(
            game.sim.occupiedBy(id),
          );
          expect(snap.reserved.get(id), `reserved@${id} tick ${tick}`).toBe(
            game.sim.reservedBy(id),
          );
        }
        if (snap.occupied.size > 0) sawOccupied = true;
        if (snap.reserved.size > 0) sawReserved = true;
      }
      // The equivalence above is vacuous if nothing was ever claimed.
      expect(sawOccupied, "no tile was ever occupied — the test proved nothing").toBe(true);
      expect(sawReserved, "no tile was ever reserved — the test proved nothing").toBe(true);
    });
  }
});

// The point of the snapshot is that the WORLD TICK stops asking per tile. That
// is a performance property, so nothing else in the suite would notice it being
// lost: re-introduce a `sim.occupiedBy(id)` inside the road sim's crossing gate
// and every test still passes, while the tick quietly goes quadratic in
// cars x trains again (it was ~630 calls a tick and about a quarter of the tick
// before this — docs/PERFORMANCE.md).
//
// So it is pinned here. The budget is deliberately loose: this guards against a
// per-tile POLL coming back, not against a handful of honest one-off queries.
describe("the world tick does not poll occupancy per tile", () => {
  it("perfworld: a tick asks the per-tile queries a bounded number of times", () => {
    const scenario = scenarioById("perfworld")!;
    const game = createGame(
      clone(scenario.level),
      trainDefsOf(scenario),
      200,
      sandboxMode,
      1,
      scenario.colors,
      scenario.traffic,
      "claimsnap:budget",
    );
    game.startObjective();
    // Enough to put cars on the roads and trains out of their depots — the
    // gate is only called for a car that is driving. `fillFast` (which the
    // rendered game and this one both use) packs the entries within a fraction
    // of a second, so this does not need to be a long run.
    for (let i = 0; i < 90; i++) game.advance(1 / 60);

    const sim = game.sim as unknown as {
      reservedBy(id: string): string | undefined;
      occupiedBy(id: string): string | undefined;
    };
    const origReserved = sim.reservedBy.bind(sim);
    const origOccupied = sim.occupiedBy.bind(sim);
    let calls = 0;
    sim.reservedBy = id => {
      calls++;
      return origReserved(id);
    };
    sim.occupiedBy = id => {
      calls++;
      return origOccupied(id);
    };
    const TICKS = 30;
    for (let i = 0; i < TICKS; i++) game.advance(1 / 60);
    sim.reservedBy = origReserved;
    sim.occupiedBy = origOccupied;

    const perTick = calls / TICKS;
    // The board has 1120 tiles and runs ~100 vehicles here; polling would be in
    // the hundreds per tick. Ten is roomy for genuine one-off lookups.
    expect(perTick, `per-tile occupancy queries per tick: ${perTick}`).toBeLessThan(10);
  });
});
