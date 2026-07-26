import { describe, it, expect } from "vitest";
import { createGame, TrainDef, assessGridlock, GridlockSample } from "@/game";
import { tycoonMode, STARTING_BALANCE } from "@/modes/tycoon";
import { TRACK_COST_PER_TILE } from "@/sim/economy";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";
import { Position } from "@/types";
import type { RouteStep } from "@/tiles/routePlanner";

// game.bulldoze — the undo half of the build verb.
//
// It exists because a first level had no way back from a misdrag: with no
// refund and no bankruptcy state, one fumbled gesture silently soft-locked the
// board into Retry. The contract has one sharp edge worth guarding hard — a
// refund must never pay for track the player did not buy, or the authored rail
// on any board becomes a cash machine.

const L = Position.Left;
const R = Position.Right;
const T = Position.Top;
const B = Position.Bottom;

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

const gapSteps: RouteStep[] = [
  { id: "2,1", a: L, b: R },
  { id: "3,1", a: L, b: R },
  { id: "4,1", a: L, b: R },
];

function tycoonGame(level: Level = gapLevel()) {
  return createGame(level, trains, 200, tycoonMode, 1, colors);
}

describe("game.bulldoze", () => {
  it("refunds a bought piece in full and takes the track away", () => {
    const level = gapLevel();
    const game = tycoonGame(level);
    game.buildRoute(gapSteps);
    const afterBuild = game.money.balance;
    expect(afterBuild).toBe(STARTING_BALANCE - 2 * TRACK_COST_PER_TILE);

    expect(game.refundOf("3,1")).toBe(TRACK_COST_PER_TILE);
    expect(game.bulldoze("3,1")).toEqual({ ok: true, blocked: [] });

    expect(game.money.balance).toBe(afterBuild + TRACK_COST_PER_TILE);
    expect(level["3,1"]).toBeUndefined(); // nothing else on the cell — it goes
  });

  it("NEVER refunds track the player did not buy", () => {
    // The money-printing exploit this set exists to prevent: every board ships
    // with authored rail, and paying it out would make bulldozing free income.
    const level = gapLevel();
    const game = tycoonGame(level);
    const before = game.money.balance;

    expect(game.refundOf("1,1")).toBe(0); // authored, never purchased
    expect(game.bulldoze("1,1")).toEqual({ ok: true, blocked: [] });

    expect(game.money.balance).toBe(before); // removed, but not a penny paid
    expect(level["1,1"]).toBeUndefined();
  });

  it("pays back each piece exactly once, however often it is rebuilt", () => {
    const level = gapLevel();
    const game = tycoonGame(level);
    game.buildRoute(gapSteps);
    const afterBuild = game.money.balance;

    game.bulldoze("3,1");
    game.bulldoze("3,1"); // second call has nothing left to refund
    expect(game.money.balance).toBe(afterBuild + TRACK_COST_PER_TILE);

    // Rebuild and re-bulldoze: net zero, no ratchet.
    game.buildRoute([{ id: "3,1", a: L, b: R }]);
    expect(game.money.balance).toBe(afterBuild);
    game.bulldoze("3,1");
    expect(game.money.balance).toBe(afterBuild + TRACK_COST_PER_TILE);
  });

  it("refuses a tile a train is standing on or has reserved", () => {
    // The same guard as building, and the answer to the question additive-only
    // edits were deferred over: a reserved block cannot run through a deleted
    // tile, because the tile refuses to be deleted.
    const level = gapLevel();
    const game = tycoonGame(level);
    game.buildRoute(gapSteps);
    game.dispatch("t1");
    for (let i = 0; i < 40; i++) game.sim.step(0.1);

    const here = game.sim.trainTileId("t1");
    const balance = game.money.balance;
    const res = game.bulldoze(here);
    expect(res.ok).toBe(false);
    expect(res.blocked).toContain(here);
    expect(level[here].connections.length).toBeGreaterThan(0); // still there
    expect(game.money.balance).toBe(balance); // and nothing paid out
  });

  it("refuses a depot — it is the level's furniture, not the player's track", () => {
    const level = gapLevel();
    const game = tycoonGame(level);
    expect(game.bulldoze("0,1").ok).toBe(false);
    expect(level["0,1"].role).toBe("depot");
  });

  // NOTE: "bulldozing decrements tilesBuilt, so a `buy >= N pieces` star cannot
  // be farmed by build/bulldoze cycling" is asserted in the e2e, not here: the
  // counter reaches the objective through the per-frame observation diff, and a
  // headless game runs no frames. Testing it here would mean bypassing the very
  // path that carries it.

  it("leaves no switch arm pointing at a connection it just removed", () => {
    // Removal is the case additive edits never had. `connectionsToExitPort`
    // answers NULL for an arm whose exit is gone, which stops a train dead on
    // the tile — the mirror image of the new-junction trap.
    const level: Level = {
      "0,1": expandKind("depot", 1),
      "1,1": expandKind("straight", 1),
      "2,1": expandKind("straight", 1),
      "3,1": expandKind("depot", 3),
      "2,2": expandKind("depot"), // faces Top, under the junction-to-be
    };
    const game = createGame(level, trains, 200, tycoonMode, 1, {
      depotColors: { "0,1": "blue", "3,1": "green", "2,2": "red" },
      trainColors: { t1: "green" },
    });

    // Make 2,1 a T-junction by buying the southern branch...
    game.buildRoute([{ id: "2,1", a: L, b: B }]);
    expect(Object.keys(game.switches)).toContain("2,1");

    // ...then take it away again. The arms must go with it, or the tile keeps
    // an arm aimed south at track that no longer exists.
    game.bulldoze("2,1");
    const arms = game.switches["2,1"];
    expect(arms).toBeUndefined();
  });

  it("keeps the ground when it removes the rails", () => {
    // Bulldozing track must not erase the terrain under it: the cell survives
    // as ground-only rather than being deleted outright.
    const level = gapLevel();
    level["3,1"] = { connections: [], terrain: "forest" };
    const game = tycoonGame(level);
    game.buildRoute(gapSteps);
    game.bulldoze("3,1");

    expect(level["3,1"]).toBeDefined();
    expect(level["3,1"].connections).toEqual([]);
    expect(level["3,1"].terrain).toBe("forest");
  });

  it("is free and harmless in a mode with no ledger", () => {
    // Sandbox builds free; bulldozing there must not throw looking for money.
    const level = gapLevel();
    const game = createGame(level, trains, 200, tycoonMode, 1, colors);
    game.buildRoute(gapSteps);
    expect(() => game.bulldoze("4,1")).not.toThrow();
    expect(game.refundOf("9,9")).toBe(0); // a tile that does not exist
    expect(game.bulldoze("9,9")).toEqual({ ok: true, blocked: [] });
  });
});

describe("assessGridlock", () => {
  // The decision is a pure function precisely so it can be tested without a
  // frame loop. It had to be: the first attempt to verify this in a browser
  // was worthless, because a HIDDEN pane runs no requestAnimationFrame, so the
  // game loop never ticked and three motionless trains meant nothing at all.
  const moving = (over: Partial<GridlockSample> = {}): GridlockSample => ({
    state: "running",
    velocity: 0.4,
    ...over,
  });
  const halted = (over: Partial<GridlockSample> = {}): GridlockSample => ({
    state: "running",
    velocity: 0,
    ...over,
  });

  it("is not jammed while anything is still moving", () => {
    expect(
      assessGridlock([moving(), halted({ block: { reason: "reservation" } })])
        .jammed
    ).toBe(false);
  });

  it("calls it a DEADLOCK when the stopped trains are waiting on each other", () => {
    const res = assessGridlock([
      halted({ block: { reason: "reservation" } }),
      halted({ block: { reason: "occupancy" } }),
    ]);
    expect(res.jammed).toBe(true);
    expect(res.reason).toBe("deadlock");
  });

  it("calls it a DEAD END when a stopped train has no block at all", () => {
    // The case that matters most and is easiest to miss: the sim records a
    // block only when `mayCross` refuses, so a train that has simply run out of
    // rails carries no block record. That is the half-built route — the exact
    // mistake bulldoze exists to undo — and it must still raise the nudge.
    const res = assessGridlock([halted()]);
    expect(res.jammed).toBe(true);
    expect(res.reason).toBe("dead-end");
  });

  it("ignores trains waiting for dispatch, and parked ones", () => {
    // A station full of undispatched trains is the player's turn, not a jam.
    expect(assessGridlock([halted({ state: "waiting" })]).jammed).toBe(false);
    expect(assessGridlock([halted({ state: "parked" })]).jammed).toBe(false);
    expect(assessGridlock([]).jammed).toBe(false);
  });

  it("never blames the player for holding their own signal", () => {
    // Holding a signal is playing. A held train counts as neither stuck nor
    // active — otherwise holding the only other train would report the whole
    // railway as gridlocked.
    expect(
      assessGridlock([
        moving(),
        halted({ block: { reason: "signal-hold" } }),
      ]).jammed
    ).toBe(false);
    expect(
      assessGridlock([halted({ block: { reason: "signal-hold" } })]).jammed
    ).toBe(false);
  });
});

describe("gridlock detection", () => {
  const twoTrains: TrainDef[] = [
    { id: "a", x: 0, y: 1, type: "people", wagonIds: ["w1"] },
    { id: "b", x: 6, y: 1, type: "people", wagonIds: ["w2"] },
  ];

  function headOn() {
    // A single line with a depot at each end and a train in each, both aimed at
    // the other's station: whoever reserves first wins, the other waits. Enough
    // to exercise the detector's "held by the network" branch.
    const level: Level = {
      "0,1": expandKind("depot", 1),
      "1,1": expandKind("straight", 1),
      "2,1": expandKind("straight", 1),
      "3,1": expandKind("straight", 1),
      "4,1": expandKind("straight", 1),
      "5,1": expandKind("straight", 1),
      "6,1": expandKind("depot", 3),
    };
    return createGame(level, twoTrains, 200, tycoonMode, 1, {
      depotColors: { "0,1": "blue", "6,1": "green" },
      trainColors: { a: "green", b: "blue" },
    });
  }

  it("does not cry gridlock while trains are still in their stations", () => {
    // Waiting for dispatch is the player's turn, not a jam.
    const game = headOn();
    for (let i = 0; i < 200; i++) game.sim.step(0.1);
    expect(game.gridlock.stuck).toBe(false);
  });

  it("does not cry gridlock the instant a train stops", () => {
    // A train braking for a signal it is about to be given is normal. The
    // threshold is what stops the nudge crying wolf at every junction.
    const game = headOn();
    game.dispatch("a");
    game.dispatch("b");
    for (let i = 0; i < 5; i++) game.sim.step(0.1);
    expect(game.gridlock.stuck).toBe(false);
  });
});
