import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { tycoonMode, fareFor } from "@/modes/tycoon";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";

// TIMED ARRIVALS IN TYCOON — the structural lever that turns a level from "a
// pile of trains at t=0, deliver them all, done" into a shift with a pressure
// curve. Puzzle has read `spawnAtSec` off a board since #113; this asserts the
// same board data now works in the mode that CHARGES for it.
//
// The trap this file exists to guard: the fare book ages every fare it holds,
// so a scheduled train left in the book at construction would step onto the
// platform with a fare already decayed to its floor — a silently unwinnable
// level, showing only a small number on a pin. The two features had never met
// (the only scheduled board ran under Puzzle, which declares no economy), so
// nothing caught it.
//
// Everything here is asserted through headless-honest surfaces — the sim, the
// counters, the ledger. `fareBadges` is filled by the RENDER frame, so it is
// empty in a headless run and would silently assert nothing (KNOWHOW → the
// rAF/hidden-tab trap).

// TWO PARALLEL LANES. Each train gets its own shed, because one shed holds one
// train — sharing a depot is a capacity case in its own right (see the second
// describe), not the baseline a timetable is authored on.
function lane(): Level {
  return {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("straight", 1),
    "3,0": expandKind("depot", 3),
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    "2,1": expandKind("straight", 1),
    "3,1": expandKind("depot", 3),
  };
}
const colors = {
  depotColors: { "0,0": "blue", "3,0": "green", "0,1": "blue", "3,1": "green" },
  trainColors: { now: "green", later: "green" },
};
const SPAWN_AT = 20;

function scheduledDefs(): TrainDef[] {
  return [
    { id: "now", x: 0, y: 0, type: "people", wagonIds: ["w1"], destinations: ["3,0"] },
    {
      id: "later",
      x: 0,
      y: 1,
      type: "people",
      wagonIds: ["w2"],
      destinations: ["3,1"],
      spawnAtSec: SPAWN_AT,
    },
  ];
}
function scheduledGame() {
  const defs = scheduledDefs();
  return {
    defs,
    game: createGame(lane(), defs, 200, tycoonMode, 1, colors, undefined, "board:sched"),
  };
}
function run(game: ReturnType<typeof scheduledGame>["game"], sec: number) {
  for (let t = 0; t < sec; t += 0.5) game.advance(0.5);
}

describe("Tycoon: timed arrivals", () => {
  it("declares a spawner, so a scheduled board can be won at all", () => {
    expect(tycoonMode.createSpawner).toBeDefined();
    const { game } = scheduledGame();
    game.startObjective();
    // Only the t=0 train exists to begin with...
    expect(Object.keys(game.sim.trains)).toEqual(["now"]);
    run(game, SPAWN_AT + 1);
    // ...and the scheduled one turns up on time. Before this it never arrived,
    // and a board asking for two deliveries could only ever make one.
    expect(Object.keys(game.sim.trains).sort()).toEqual(["later", "now"]);
  });

  it("lands the arrival WAITING, so it is the player's turn — Train Valley's move", () => {
    const { game } = scheduledGame();
    game.startObjective();
    run(game, SPAWN_AT + 1);
    expect(game.sim.trainState("later")).toBe("waiting");
    // And it is genuinely dispatchable: the pin over it is a Send button.
    expect(game.dispatch("later")).toBe(true);
  });

  it("starts the arrival's fare clock ON ARRIVAL, not at t=0", () => {
    const { game, defs } = scheduledGame();
    game.startObjective();
    // Leave the t=0 train alone; run out the clock, then send the arrival at
    // once and bank it. What it PAYS is the honest measure of its fare age.
    run(game, SPAWN_AT + 1);
    const before = game.money.earned;
    game.dispatch("later");
    run(game, 30);
    const paid = game.money.earned - before;
    const full = fareFor(defs[1]).base;
    expect(game.objective.counters.delivered).toBeGreaterThanOrEqual(1);
    // Sent the moment it appeared, it pays near its full value — only the
    // journey itself decays it. Aged from t=0 it would arrive at its 25%
    // floor, which is the silent failure this guards.
    expect(paid).toBeGreaterThan(full * 0.6);
  });

  it("still burns the t=0 train's fare the whole time — the mode's rule is untouched", () => {
    const { game, defs } = scheduledGame();
    game.startObjective();
    // Let it stand on the platform for the same span, then send it.
    run(game, SPAWN_AT);
    const before = game.money.earned;
    game.dispatch("now");
    run(game, 30);
    const paid = game.money.earned - before;
    expect(paid).toBeLessThan(fareFor(defs[0]).base * 0.6);
    expect(paid).toBeGreaterThan(0);
  });

  it("opens the backlog at the t=0 count, not the whole roster", () => {
    const { game } = scheduledGame();
    game.startObjective();
    game.advance(0.1);
    // One train is in play; the other is not on the board yet. Counting it
    // here would open every scheduled level with a phantom backlog.
    expect(game.objective.counters.active).toBe(1);
  });

  it("leaves a board with no schedule exactly as it was", () => {
    const defs: TrainDef[] = [
      { id: "solo", x: 0, y: 0, type: "people", wagonIds: ["w1"], destinations: ["3,0"] },
    ];
    const game = createGame(lane(), defs, 200, tycoonMode, 1,
      { depotColors: colors.depotColors, trainColors: { solo: "green" } },
      undefined, "board:plain");
    game.startObjective();
    expect(game.objective.counters.active).toBe(1);
    expect(Object.keys(game.sim.trains)).toEqual(["solo"]);
    expect(game.sim.trainState("solo")).toBe("waiting");
  });

  it("re-arms the schedule on Retry, fresh fare and all", () => {
    const { game, defs } = scheduledGame();
    game.startObjective();
    run(game, SPAWN_AT + 1);
    expect(Object.keys(game.sim.trains).sort()).toEqual(["later", "now"]);

    game.reset();
    game.startObjective();
    expect(Object.keys(game.sim.trains)).toEqual(["now"]);
    run(game, SPAWN_AT + 1);
    expect(game.sim.trainState("later")).toBe("waiting");
    // The second run's arrival is worth what the first one's was: a Retry that
    // handed back a pre-decayed fare would make the board harder every attempt.
    const before = game.money.earned;
    game.dispatch("later");
    run(game, 30);
    expect(game.money.earned - before).toBeGreaterThan(fareFor(defs[1]).base * 0.6);
  });
});

// ONE TRAIN PER SHED — the capacity rule that makes a timetable authorable at
// all. Train Valley spawns "at a vacant station"; ours holds the arrival in
// the shed queue that ordered trains already use. Without it, several waiting
// trains stack on one depot tile: identical coordinates, identical pins, and
// nothing on screen says there is more than one.
describe("Tycoon: a busy shed holds the next arrival", () => {
  function stackedGame() {
    const defs: TrainDef[] = [
      { id: "a", x: 0, y: 0, type: "people", wagonIds: ["w1"], destinations: ["3,0"] },
      { id: "b", x: 0, y: 0, type: "people", wagonIds: ["w2"], destinations: ["3,0"], spawnAtSec: 5 },
      { id: "c", x: 0, y: 0, type: "people", wagonIds: ["w3"], destinations: ["3,0"], spawnAtSec: 10 },
    ];
    return {
      defs,
      game: createGame(lane(), defs, 200, tycoonMode, 1,
        { depotColors: { "0,0": "blue", "3,0": "green" },
          trainColors: { a: "green", b: "green", c: "green" } },
        undefined, "board:stack"),
    };
  }

  it("never puts two waiting trains on one depot tile", () => {
    const { game } = stackedGame();
    game.startObjective();
    // Dispatch nothing: 'a' squats in the shed while b and c fall due.
    for (let t = 0; t < 14; t += 0.5) {
      game.advance(0.5);
      const tiles = Object.keys(game.sim.trains).map(id => game.sim.trainTileId(id));
      expect(new Set(tiles).size, `two trains share a tile at t=${t}`).toBe(tiles.length);
    }
    // Only the t=0 train ever made it onto the board.
    expect(Object.keys(game.sim.trains)).toEqual(["a"]);
  });

  it("rolls the held arrival out the moment the shed clears", () => {
    const { game } = stackedGame();
    game.startObjective();
    for (let t = 0; t < 6; t += 0.5) game.advance(0.5);
    expect(Object.keys(game.sim.trains)).toEqual(["a"]); // b is due but held
    // Send 'a' and let it clear the depot.
    game.dispatch("a");
    for (let t = 0; t < 8; t += 0.5) game.advance(0.5);
    expect(Object.keys(game.sim.trains)).toContain("b");
    expect(game.sim.trainState("b")).toBe("waiting");
  });

  it("counts a held arrival as spawned when it reaches the board, not when it is due", () => {
    const { game } = stackedGame();
    game.startObjective();
    for (let t = 0; t < 6; t += 0.5) game.advance(0.5);
    // 'b' is due but stuck in the shed queue: one train is in play, not two.
    expect(game.objective.counters.active).toBe(1);
    game.dispatch("a");
    for (let t = 0; t < 8; t += 0.5) game.advance(0.5);
    expect(game.objective.counters.spawned).toBeGreaterThanOrEqual(1);
  });

  it("empties the shed queue on Retry", () => {
    const { game } = stackedGame();
    game.startObjective();
    for (let t = 0; t < 12; t += 0.5) game.advance(0.5); // b and c both held
    game.reset();
    game.startObjective();
    expect(Object.keys(game.sim.trains)).toEqual(["a"]);
    // Run 2 must not inherit run 1's queue: nothing rolls out unbidden.
    game.advance(0.5);
    expect(Object.keys(game.sim.trains)).toEqual(["a"]);
  });
});
