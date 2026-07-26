import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { tycoonMode } from "@/modes/tycoon";
import { puzzleMode } from "@/modes/puzzle";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";

// A depot at 0,0 opening east, two straights, a depot at 3,0 opening west —
// the same lane the dispatch scenario uses.
function lane(): Level {
  return {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("straight", 1),
    "3,0": expandKind("depot", 3),
  };
}

const trains: TrainDef[] = [
  { id: "t1", x: 0, y: 0, type: "people", wagonIds: ["w1"] },
];

const colors = {
  depotColors: { "0,0": "blue", "3,0": "green" },
  trainColors: { t1: "green" },
};

function gameFor(mode: typeof puzzleMode) {
  return createGame(lane(), trains, 200, mode, 1, colors);
}

// `reset()` REPLACES the simulation (buildSims()), so anything the Game object
// hands out has to resolve the live one at call time. `sim` used to be a plain
// snapshot taken when createGame returned: after a Retry the handle answered
// from the dead sim while the game ran a new one. Nothing in `src/` reads it,
// so only the e2e tests and the `window.__game` probe saw it — silently, as a
// wrong answer rather than an error. Same class of trap as `signalTiles`.
describe("Game handles survive reset()", () => {
  it("exposes the LIVE simulation after a reset, not the one it was built with", () => {
    const game = gameFor(puzzleMode);
    const before = game.sim;
    game.reset();
    expect(game.sim).not.toBe(before);
  });

  it("reports the reset state through game.sim, not the pre-reset state", () => {
    const game = gameFor(puzzleMode);
    // Drive the train off its starting tile.
    for (let i = 0; i < 20; i++) game.sim.step(0.2);
    expect(game.sim.trainTileId("t1")).not.toBe("0,0");
    game.reset();
    // A stale handle would still say the train is halfway down the lane.
    expect(game.sim.trainTileId("t1")).toBe("0,0");
    expect(game.sim.trainProgress("t1")).toBe(0);
  });

  it("puts a Tycoon train back to WAITING after a reset (Retry is a real flow here)", () => {
    const game = gameFor(tycoonMode);
    expect(game.sim.trainState("t1")).toBe("waiting");
    expect(game.dispatch("t1")).toBe(true);
    expect(game.sim.trainState("t1")).toBe("running");
    game.reset();
    // Retry must hand back a train that waits again — and `game.dispatch` must
    // reach the NEW sim, or the pin would be dead on the second run.
    expect(game.sim.trainState("t1")).toBe("waiting");
    expect(game.dispatch("t1")).toBe(true);
    expect(game.sim.trainState("t1")).toBe("running");
  });

  it("restores the starting capital and un-settles the fares on reset", () => {
    const game = gameFor(tycoonMode);
    expect(game.money.enabled).toBe(true);
    const start = game.money.balance;
    game.dispatch("t1");
    // Run until the train parks and the fare is booked.
    let paid = false;
    for (let i = 0; i < 200 && !paid; i++) {
      for (const e of game.sim.step(0.1)) {
        if (e.type === "arrived" && e.matched) paid = true;
      }
    }
    expect(paid).toBe(true);
    game.reset();
    expect(game.money.balance).toBe(start);
    expect(game.money.earned).toBe(0);
    expect(game.fareBadges).toHaveLength(0);
  });
});
