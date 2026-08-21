import { describe, it, expect } from "vitest";
import { createGame, Game, GameSave, SAVE_VERSION, TrainDef } from "@/game";
import { tycoonMode } from "@/modes/tycoon";
import { puzzleMode } from "@/modes/puzzle";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";

// Game-level round trip (docs/superpowers/specs/2026-08-21-save-load-design.md):
// captureSave on a running game, restoreSave into a game freshly built from the
// save's own level/trains/mode/colours, and the pair must keep advancing in
// lockstep — sim, money, fares, objective counters. The boards here carry no
// roads, so the road sim (deliberately NOT snapshotted) cannot leak into the
// comparison.

const DT = 0.1;

function lane(): Level {
  return {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("straight", 1),
    "3,0": expandKind("depot", 3),
  };
}

const colors = {
  depotColors: { "0,0": "blue", "3,0": "green" },
  trainColors: { t1: "green" },
};

function trains(): TrainDef[] {
  return [{ id: "t1", x: 0, y: 0, type: "people", wagonIds: ["w1"] }];
}

function advance(game: Game, ticks: number) {
  for (let i = 0; i < ticks; i++) game.advance(DT);
}

// A fresh game built the way PlayView's load path builds one: from the save's
// own (cloned) level, trains and colours.
function gameFromSave(save: GameSave, mode: typeof puzzleMode): Game {
  const copy = JSON.parse(JSON.stringify(save)) as GameSave;
  const game = createGame(
    copy.level,
    copy.trains,
    200,
    mode,
    copy.colorSeed,
    copy.colors,
    undefined,
    copy.levelId
  );
  game.restoreSave(copy);
  return game;
}

describe("game captureSave / restoreSave", () => {
  it("resumes a tycoon run in lockstep: sim, balance, fare decay, counters", () => {
    const reference = createGame(lane(), trains(), 200, tycoonMode, 1, colors);
    reference.startObjective();
    expect(reference.dispatch("t1")).toBe(true);
    advance(reference, 30);

    const save = reference.captureSave("mid-run");
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.modeId).toBe("tycoon");

    const restored = gameFromSave(save, tycoonMode);
    // The restored game answers exactly like the one the save came from…
    expect(restored.sim.snapshot()).toEqual(reference.sim.snapshot());
    expect(restored.money.balance).toBe(reference.money.balance);
    expect(restored.objective.phase).toBe("playing");
    expect(restored.objective.counters.elapsedSec).toBe(
      reference.objective.counters.elapsedSec
    );

    // …and keeps answering like it, tick for tick, through the delivery and
    // the fare settlement.
    advance(reference, 200);
    advance(restored, 200);
    expect(restored.sim.snapshot()).toEqual(reference.sim.snapshot());
    expect(restored.money.balance).toBe(reference.money.balance);
    expect(restored.money.earned).toBe(reference.money.earned);
    expect(restored.deliveries.value).toBe(reference.deliveries.value);
    expect(restored.objective.counters).toEqual(reference.objective.counters);
    expect(restored.objective.phase).toBe(reference.objective.phase);
  });

  it("keeps an undispatched tycoon train waiting, dispatchable after the load", () => {
    const reference = createGame(lane(), trains(), 200, tycoonMode, 1, colors);
    reference.startObjective();
    advance(reference, 20); // the fare decays while it waits — that is the mode
    const save = reference.captureSave("still waiting");

    const restored = gameFromSave(save, tycoonMode);
    expect(restored.sim.trainState("t1")).toBe("waiting");
    expect(restored.dispatch("t1")).toBe(true);
    expect(restored.sim.trainState("t1")).toBe("running");
  });

  it("fast-forwards the spawner: an already-spawned train is not re-injected, a future one still comes", () => {
    const rushTrains: TrainDef[] = [
      { id: "t1", x: 0, y: 0, type: "people", wagonIds: ["w1"] },
      { id: "t2", x: 0, y: 0, type: "people", wagonIds: ["w2"], spawnAtSec: 2 },
      { id: "t3", x: 0, y: 0, type: "people", wagonIds: ["w3"], spawnAtSec: 60 },
    ];
    const rushColors = {
      depotColors: { "0,0": "blue", "3,0": "green" },
      trainColors: { t1: "green", t2: "green", t3: "green" },
    };
    const reference = createGame(
      lane(),
      JSON.parse(JSON.stringify(rushTrains)),
      200,
      puzzleMode,
      1,
      rushColors
    );
    reference.startObjective();
    // Past t2's spawn (2s), well short of t3's (60s).
    advance(reference, 50);
    expect(reference.sim.trains["t2"]).toBeDefined();
    expect(reference.sim.trains["t3"]).toBeUndefined();
    const save = reference.captureSave("mid-rush");

    const restored = gameFromSave(save, puzzleMode);
    expect(restored.sim.trains["t2"]).toBeDefined();
    expect(restored.sim.trains["t3"]).toBeUndefined();
    expect(restored.objective.counters.spawned).toBe(
      reference.objective.counters.spawned
    );

    // Cross t3's spawn time in both; the schedules must fire identically.
    advance(reference, 600);
    advance(restored, 600);
    expect(restored.sim.trains["t3"]).toBeDefined();
    expect(restored.sim.snapshot()).toEqual(reference.sim.snapshot());
    expect(restored.objective.counters).toEqual(reference.objective.counters);
  });

  it("Retry after a load resets to the SAVE's board and capital (no free-track exploit)", () => {
    const reference = createGame(lane(), trains(), 200, tycoonMode, 1, colors);
    reference.startObjective();
    advance(reference, 10);
    const save = reference.captureSave("before retry");
    const restored = gameFromSave(save, tycoonMode);

    const startBalance = save.game.economy!.balance;
    restored.reset();
    // Retry hands back the balance the save's pristine board opened with…
    expect(restored.money.balance).toBe(reference.money.balance);
    // …and the board itself: same tiles as the save's pristine level.
    expect(restored.sim.trainState("t1")).toBe("waiting");
    expect(startBalance).toBe(restored.money.balance);
  });
});
