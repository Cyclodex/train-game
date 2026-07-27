import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { tycoonMode, STARTING_BALANCE } from "@/modes/tycoon";
import { sandboxMode } from "@/modes/sandbox";
import { CLEARING_COST_PER_TILE, TRACK_COST_PER_TILE } from "@/sim/economy";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";
import { Position } from "@/types";
import type { RouteStep } from "@/tiles/routePlanner";

// game.undoBuild — reversing a PURCHASE, as opposed to removing a RAILWAY.
//
// These were one verb once (bulldoze, refunding in full), and that is why the
// price felt wrong: it had to double as the escape hatch for a MISDRAG, which
// is an input error rather than a world event. Splitting them lets each price
// be truthful — undo costs nothing because nothing happened, and demolition
// costs a fee because somebody has to pull the rails up.
//
// The contract worth guarding: undo must not become a full-refund bulldoze
// wearing a different hat. Only the LAST gesture is ever undoable, and the
// window closes on the next thing the PLAYER does.

const L = Position.Left;
const R = Position.Right;
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
  { id: "2,1", a: L, b: R }, // the anchor straight — already there, free
  { id: "3,1", a: L, b: R },
  { id: "4,1", a: L, b: R },
];

function tycoonGame(level: Level = gapLevel()) {
  return createGame(level, trains, 200, tycoonMode, 1, colors);
}

describe("game.undoBuild", () => {
  it("takes the rails back and returns every penny, with no fee", () => {
    const level = gapLevel();
    const game = tycoonGame(level);
    game.buildRoute(gapSteps);
    expect(game.money.balance).toBe(STARTING_BALANCE - 2 * TRACK_COST_PER_TILE);

    expect(game.undoValue()).toBe(2 * TRACK_COST_PER_TILE);
    expect(game.undoBuild()).toEqual({ ok: true, blocked: [] });

    // Full price back — and note it is NOT `afterBuild - fee`: this is the
    // whole difference between undoing a purchase and demolishing a railway.
    expect(game.money.balance).toBe(STARTING_BALANCE);
    expect(level["3,1"]).toBeUndefined();
    expect(level["4,1"]).toBeUndefined();
  });

  it("un-counts the purchase, so a fumbled drag costs no goal either", () => {
    // The pieces were never really bought, so both the money and the piece
    // count go back. This is what lets "Under budget" survive a misdrag while
    // still refusing to survive an over-build the player KEPT (bulldozing
    // leaves `trackSpent` where it was — see bulldoze.spec.ts).
    const game = tycoonGame();
    game.buildRoute(gapSteps);
    expect(game.money.trackSpent).toBe(2 * TRACK_COST_PER_TILE);

    game.undoBuild();
    expect(game.money.trackSpent).toBe(0);
    expect(game.money.taxPerYear).toBe(0);
  });

  it("only ever takes back the LAST gesture", () => {
    // Otherwise it is a full-refund bulldoze with extra steps, and the realism
    // problem walks straight back in.
    const game = tycoonGame();
    game.buildRoute([{ id: "3,1", a: L, b: R }]);
    game.buildRoute([{ id: "4,1", a: L, b: R }]);
    expect(game.undoValue()).toBe(TRACK_COST_PER_TILE);

    game.undoBuild();
    expect(game.money.balance).toBe(STARTING_BALANCE - TRACK_COST_PER_TILE);
    // The first gesture is gone for good; taking it out now is a demolition.
    expect(game.canUndoBuild()).toBe(false);
    expect(game.undoValue()).toBe(0);
  });

  it("charges nothing for the free duplicate steps a gesture re-lays", () => {
    // The anchor straight of the open end is already there, so it was never
    // charged — undo must not pay it back either.
    const game = tycoonGame();
    game.buildRoute(gapSteps); // 3 steps, 2 of them new
    expect(game.undoValue()).toBe(2 * TRACK_COST_PER_TILE);
    game.undoBuild();
    // The anchor tile keeps its authored rail; only the bought pieces went.
    expect(gapLevel()["2,1"].connections.length).toBe(1);
    expect(game.money.balance).toBe(STARTING_BALANCE);
  });

  it("is not clobbered by a gesture that lays nothing chargeable", () => {
    // Bit for real, and only in the browser. A gesture can buy NOTHING — the
    // Esc-finish whose terminus duplicates rail the tile already carries is the
    // common case, and it fires straight after every real gesture. Recording
    // that as "the last purchase" replaced a live window with an empty one, and
    // the undo control vanished the instant the player let go of the drag.
    const game = tycoonGame();
    game.buildRoute(gapSteps);
    expect(game.undoValue()).toBe(2 * TRACK_COST_PER_TILE);

    // A batch of pure duplicates: legal, free, and a no-op.
    const res = game.buildRoute([{ id: "3,1", a: L, b: R }]);
    expect(res.ok).toBe(true);
    expect(game.undoable.value).toEqual({
      pieces: 2,
      value: 2 * TRACK_COST_PER_TILE,
    });
    game.undoBuild();
    expect(game.money.balance).toBe(STARTING_BALANCE);
  });

  describe("the window closes on what the PLAYER does, never on a clock", () => {
    // Deliberately not time-based: a window that closes on its own is an
    // invisible timer, and being free of one is the reason undo beat a timed
    // grace period in the first place.
    it("stays open however long the world runs", () => {
      const game = tycoonGame();
      game.startObjective();
      game.buildRoute(gapSteps);
      for (let i = 0; i < 200; i++) game.advance(0.5); // 100 seconds
      expect(game.canUndoBuild()).toBe(true);
      game.undoBuild();
      expect(game.money.balance).toBe(STARTING_BALANCE);
    });

    it("closes when a train is sent — the railway is in service now", () => {
      const game = tycoonGame();
      game.buildRoute(gapSteps);
      expect(game.canUndoBuild()).toBe(true);
      expect(game.dispatch("t1")).toBe(true);
      expect(game.canUndoBuild()).toBe(false);
      expect(game.undoBuild()).toEqual({ ok: true, blocked: [] }); // a no-op
      expect(game.money.balance).toBe(
        STARTING_BALANCE - 2 * TRACK_COST_PER_TILE
      );
    });

    it("closes when anything is bulldozed", () => {
      const game = tycoonGame();
      game.buildRoute(gapSteps);
      game.bulldoze("3,1");
      expect(game.canUndoBuild()).toBe(false);
    });

    it("is mirrored reactively for the view", () => {
      // `game` is markRaw'd and `lastBuild` is a closure variable, and DISPATCH
      // clears it without touching `levelVersion` — so the button needs its own
      // reactive source or it would never disappear.
      const game = tycoonGame();
      expect(game.undoable.value).toEqual({ pieces: 0, value: 0 });
      game.buildRoute(gapSteps);
      expect(game.undoable.value).toEqual({
        pieces: 2,
        value: 2 * TRACK_COST_PER_TILE,
      });
      game.dispatch("t1");
      expect(game.undoable.value).toEqual({ pieces: 0, value: 0 });
    });
  });

  it("refuses while a train stands on the track it would remove", () => {
    // Same guard as building and clearing: a train's path caches the exit port
    // of the tile it is on, so editing under it makes that stale.
    //
    // Reachable only where trains run without being dispatched — in Tycoon the
    // window closes on `dispatch`, before any train can have moved onto the new
    // track at all. Sandbox has no dispatch gate, so it is the honest place to
    // exercise the guard.
    const game = createGame(gapLevel(), trains, 200, sandboxMode, 1, colors);
    game.buildRoute(gapSteps);
    for (let i = 0; i < 400 && !["3,1", "4,1"].includes(game.sim.trainTileId("t1")); i++) {
      game.sim.step(0.05);
    }
    const here = game.sim.trainTileId("t1");
    expect(["3,1", "4,1"]).toContain(here); // the train really is on bought track

    const res = game.undoBuild();
    expect(res.ok).toBe(false);
    expect(res.blocked).toContain(here);
    expect(game.canUndoBuild()).toBe(false);
    // Refused, so nothing was taken back — the window stays open for later.
    expect(game.undoable.value.pieces).toBe(2);
  });

  it("Retry clears the window with everything else", () => {
    const game = tycoonGame();
    game.buildRoute(gapSteps);
    game.reset();
    expect(game.canUndoBuild()).toBe(false);
    expect(game.undoable.value.pieces).toBe(0);
    expect(game.money.balance).toBe(STARTING_BALANCE);
  });

  it("is real but worth nothing in a mode that builds free", () => {
    // Sandbox has no ledger, so the money is 0 — but taking back a misdrawn
    // route is still useful, which is why the control keys off the PIECE count.
    const game = createGame(gapLevel(), trains, 200, sandboxMode, 1, colors);
    game.buildRoute(gapSteps);
    expect(game.undoable.value.pieces).toBe(2);
    expect(game.undoValue()).toBe(0);
    expect(game.undoBuild().ok).toBe(true);
    expect(game.undoable.value.pieces).toBe(0);
  });

  it("costs strictly less than clearing the same track", () => {
    // The relationship the whole split exists to create, stated once as a test
    // so a future price change cannot silently invert it.
    const game = tycoonGame();
    game.buildRoute([{ id: "3,1", a: L, b: B }]);
    const undoGain = game.undoValue();
    const clearCost = game.bulldozeCostOf("3,1");
    expect(undoGain).toBe(TRACK_COST_PER_TILE);
    expect(clearCost).toBe(CLEARING_COST_PER_TILE);
    expect(undoGain).toBeGreaterThan(0);
    expect(clearCost).toBeGreaterThan(0);
    expect(CLEARING_COST_PER_TILE).toBeLessThan(TRACK_COST_PER_TILE);
  });
});
