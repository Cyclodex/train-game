import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { tycoonMode, STARTING_BALANCE } from "@/modes/tycoon";
import { sandboxMode } from "@/modes/sandbox";
import { TRACK_COST_PER_TILE } from "@/sim/economy";
import { createObjectiveTracker, emptyObservation } from "@/sim/objectives";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";
import { Position } from "@/types";
import type { RouteStep } from "@/tiles/routePlanner";

// game.buildRoute — the in-play buy (Tycoon phase 2). The order under test is
// the money-safety contract: affordability gate → applyEdits → spend, so a
// refused edit (occupied tile, or an unaffordable route) spends NOTHING, and a
// successful one charges exactly the NEW pieces (duplicates of connections a
// tile already carries are free — the gesture re-lays the anchor straight of
// the open end it grows from, and that must not cost a tile).

const L = Position.Left;
const R = Position.Right;

// The buildgap shape: a line stopping two tiles short of its station.
function gapLevel(): Level {
  return {
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    "2,1": expandKind("straight", 1),
    // 3,1 / 4,1: the gap
    "5,1": expandKind("straight", 1),
    "6,1": expandKind("depot", 3),
  };
}

const trains: TrainDef[] = [
  { id: "t1", x: 0, y: 1, type: "people", wagonIds: ["w1"] },
];

const colors = {
  depotColors: { "0,1": "blue", "6,1": "green" },
  trainColors: { t1: "green" },
};

// What the route gesture emits for closing the gap: the anchor straight of the
// open end (already present → free) plus the two genuinely new tiles.
const gapSteps: RouteStep[] = [
  { id: "2,1", a: L, b: R },
  { id: "3,1", a: L, b: R },
  { id: "4,1", a: L, b: R },
];

function tycoonGame(level: Level = gapLevel()) {
  return createGame(level, trains, 200, tycoonMode, 1, colors);
}

describe("terrain-priced building", () => {
  // The gap tiles carry ground: 3,1 is wood (x1.5), 4,1 is town (x2.5). The
  // anchor straight at 2,1 stays free regardless of its ground.
  function pricedLevel(): Level {
    const level = gapLevel();
    level["3,1"] = { connections: [], terrain: "forest" };
    level["4,1"] = { connections: [], terrain: "urban" };
    return level;
  }

  it("prices each piece by its ground, and the surcharge can price a route out", () => {
    // Wood + town = $4,000 — over the $3,000 generic purse, though the same
    // route on grass ($2,000) is comfortably affordable. The refusal must
    // spend nothing.
    const game = tycoonGame(pricedLevel());
    const expected = 1.5 * TRACK_COST_PER_TILE + 2.5 * TRACK_COST_PER_TILE;
    expect(game.buildCostOf(gapSteps)).toBe(expected);
    expect(game.buildRoute(gapSteps)).toEqual({ ok: false, blocked: [] });
    expect(game.money.balance).toBe(STARTING_BALANCE);
    expect(game.money.spent).toBe(0);
  });

  it("charges the wood surcharge, and undo hands back exactly what was paid", () => {
    const level = gapLevel();
    level["3,1"] = { connections: [], terrain: "forest" };
    const game = tycoonGame(level);
    const expected = 1.5 * TRACK_COST_PER_TILE + TRACK_COST_PER_TILE;
    expect(game.buildCostOf(gapSteps)).toBe(expected);
    expect(game.buildRoute(gapSteps)).toEqual({ ok: true, blocked: [] });
    expect(game.money.balance).toBe(STARTING_BALANCE - expected);

    // Undo reverses the purchase at the terrain-priced cost — the surcharge
    // comes back with the base rate, and the ground itself never moves.
    expect(game.undoBuild()).toEqual({ ok: true, blocked: [] });
    expect(game.money.balance).toBe(STARTING_BALANCE);
    expect(level["3,1"]?.terrain).toBe("forest");
    expect(level["3,1"]?.connections ?? []).toHaveLength(0);
  });

  it("keeps plain grass at the base rate", () => {
    const game = tycoonGame();
    expect(game.buildCostOf(gapSteps)).toBe(2 * TRACK_COST_PER_TILE);
  });
});

describe("game.buildRoute", () => {
  it("lays the route, charges only the NEW pieces, and the train delivers across it", () => {
    const level = gapLevel();
    const game = tycoonGame(level);
    expect(game.buildCostOf(gapSteps)).toBe(2 * TRACK_COST_PER_TILE);

    const res = game.buildRoute(gapSteps);
    expect(res).toEqual({ ok: true, blocked: [] });
    // Exactly the two gap tiles were charged — the anchor straight is a
    // duplicate of 2,1's existing connection and must be free.
    expect(game.money.balance).toBe(STARTING_BALANCE - 2 * TRACK_COST_PER_TILE);
    expect(game.money.spent).toBe(2 * TRACK_COST_PER_TILE);
    expect(level["3,1"].connections).toHaveLength(1);
    expect(level["4,1"].connections).toHaveLength(1);

    // The sim reads the level live: dispatch the waiting train and it crosses
    // the bought track to the matching depot.
    expect(game.dispatch("t1")).toBe(true);
    for (let i = 0; i < 600; i++) game.sim.step(0.1);
    expect(game.sim.trainTileId("t1")).toBe("6,1");
  });

  it("refuses an edit touching a tile a train occupies, and spends NOTHING", () => {
    const game = tycoonGame();
    // t1 is WAITING in its depot (Tycoon), occupying 0,1.
    const res = game.buildRoute([{ id: "0,1", a: L, b: R }]);
    expect(res.ok).toBe(false);
    expect(res.blocked).toEqual(["0,1"]);
    expect(game.money.balance).toBe(STARTING_BALANCE);
    expect(game.money.spent).toBe(0);
  });

  it("refuses an unaffordable route outright — nothing laid, nothing spent", () => {
    const level = gapLevel();
    const game = tycoonGame(level);
    // Four new tiles at 1000 each against a 3000 budget.
    const long: RouteStep[] = [
      { id: "2,0", a: L, b: R },
      { id: "3,0", a: L, b: R },
      { id: "4,0", a: L, b: R },
      { id: "5,0", a: L, b: R },
    ];
    expect(game.buildCostOf(long)).toBeGreaterThan(STARTING_BALANCE);
    const before = game.levelVersion.value;
    const res = game.buildRoute(long);
    expect(res.ok).toBe(false);
    expect(game.money.balance).toBe(STARTING_BALANCE);
    expect(level["3,0"]).toBeUndefined();
    expect(game.levelVersion.value).toBe(before);
  });

  it("re-laying existing track is free (a duplicate batch is a paid-for no-op)", () => {
    const game = tycoonGame();
    expect(game.buildRoute(gapSteps).ok).toBe(true);
    const after = game.money.balance;
    // The whole batch is now duplicates: cost 0, still ok, balance untouched.
    expect(game.buildCostOf(gapSteps)).toBe(0);
    expect(game.buildRoute(gapSteps).ok).toBe(true);
    expect(game.money.balance).toBe(after);
  });

  it("treats an empty batch as a free no-op (reachable via a 1-step U-turn)", () => {
    const game = tycoonGame();
    const before = game.levelVersion.value;
    expect(game.buildRoute([])).toEqual({ ok: true, blocked: [] });
    expect(game.money.balance).toBe(STARTING_BALANCE);
    expect(game.levelVersion.value).toBe(before);
  });

  it("builds free in a mode with no economy (Sandbox)", () => {
    const level = gapLevel();
    const game = createGame(level, trains, 200, sandboxMode, 1, colors);
    expect(game.money.enabled).toBe(false);
    expect(game.buildCostOf(gapSteps)).toBe(0);
    expect(game.buildRoute(gapSteps).ok).toBe(true);
    expect(level["3,1"].connections).toHaveLength(1);
  });

  it("reset() un-buys the track along with restoring the capital (no Retry exploit)", () => {
    const level = gapLevel();
    const game = tycoonGame(level);
    expect(game.buildRoute(gapSteps).ok).toBe(true);
    expect(level["3,1"]).toBeDefined();
    const version = game.levelVersion.value;
    game.reset();
    // The capital is back AND the bought track is gone — restoring one without
    // the other would let every Retry re-spend the same money.
    expect(game.money.balance).toBe(STARTING_BALANCE);
    expect(level["3,1"]).toBeUndefined();
    expect(level["4,1"]).toBeUndefined();
    // Untouched opening tiles survive the restore.
    expect(level["2,1"].connections).toHaveLength(1);
    expect(game.levelVersion.value).toBeGreaterThan(version); // views re-render
    // And the board is buyable again at full price.
    expect(game.buildCostOf(gapSteps)).toBe(2 * TRACK_COST_PER_TILE);
  });

  it("feeds the objective layer: tilesBuiltDelta accumulates into counters.tilesBuilt", () => {
    // The tracker half of the "buy ≥ N track pieces" star: deltas accumulate,
    // ticks without one leave the counter alone. (The game→tracker wiring runs
    // through the frame loop and is asserted end-to-end by the buildgap e2e.)
    const tracker = createObjectiveTracker({ deliveriesRequired: 99 });
    tracker.start();
    tracker.observe({ ...emptyObservation, tilesBuiltDelta: 2 }, 0.1);
    tracker.observe({ ...emptyObservation }, 0.1);
    tracker.observe({ ...emptyObservation, tilesBuiltDelta: 3 }, 0.1);
    expect(tracker.state().counters.tilesBuilt).toBe(5);
  });
});
