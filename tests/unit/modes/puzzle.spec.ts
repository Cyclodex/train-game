import { describe, it, expect } from "vitest";
import { puzzleMode } from "@/modes/puzzle";
import { straight } from "@/levels/test/scenarios/straight";

function ctx() {
  const trains = Object.values(straight.trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
  }));
  return { level: straight.level, trains, levelId: "straight" };
}

describe("puzzle mode", () => {
  it("enables only dispatch controls", () => {
    expect(puzzleMode.controls).toEqual({
      switches: true,
      signalHolds: true,
      crossingGate: false,
      build: false,
      // Trains depart immediately here; only Tycoon makes them wait.
      dispatch: false,
    });
  });

  it("requires delivering every train; the spawner is inert without a schedule", () => {
    const setup = puzzleMode.setup(ctx());
    expect(setup.objective.deliveriesRequired).toBe(setup.trains.length);
    // Since #113 Puzzle carries the Rush variant's spawner. On a board without
    // scheduled trains the schedule is empty, so it never releases anything.
    const spawner = puzzleMode.createSpawner!(setup);
    for (let i = 0; i < 30; i++) expect(spawner.step(1)).toEqual([]);
    // ...and the classic objective carries no backlog rules.
    expect(setup.objective.fail).toBeUndefined();
    expect(setup.objective.initialActiveTrains).toBeUndefined();
  });

  it("offers three stars: speedrun, hands-off, perfect colours", () => {
    const setup = puzzleMode.setup(ctx());
    const ids = (setup.objective.stars ?? []).map(s => s.id).sort();
    expect(ids).toEqual(["hands-off", "perfect-colours", "speedrun"]);
  });

  it("perfect-colours star is lost once a bounce is recorded", () => {
    const setup = puzzleMode.setup(ctx());
    const star = (setup.objective.stars ?? []).find(
      s => s.id === "perfect-colours"
    )!;
    const base = {
      delivered: 1,
      mismatchedArrivals: 0,
      elapsedSec: 1,
      manualHolds: 0,
      manualGreens: 0,
      maxCarWaitSec: 0,
      carsDelivered: 0,
      crossingIncidents: 0,
    };
    expect(star.predicate(base)).toBe(true);
    expect(star.predicate({ ...base, mismatchedArrivals: 1 })).toBe(false);
  });

  it("hud shows the full objective UI", () => {
    expect(puzzleMode.hud).toEqual({
      deliveries: true,
      timer: true,
      stars: true,
      startOverlay: true,
      endOverlay: true,
      money: false,
    });
  });
});

// The Rush variant (#113): a board whose trains carry a spawnAtSec turns the
// schedule spawner, the backlog fail and the rush stars on — from Puzzle
// itself, with no separate picker mode.
describe("puzzle mode on a scheduled board (Rush variant)", () => {
  function scheduledCtx() {
    return {
      level: straight.level,
      trains: [
        { id: "a", x: 0, y: 0, type: "people" as const, wagonIds: [] },
        { id: "b", x: 0, y: 1, type: "people" as const, wagonIds: [], spawnAtSec: 3 },
        { id: "c", x: 0, y: 2, type: "fraight" as const, wagonIds: [], spawnAtSec: 6 },
      ],
      levelId: "rush",
    };
  }

  it("seeds the init-active count and arms the backlog fail", () => {
    const setup = puzzleMode.setup(scheduledCtx());
    expect(setup.objective.deliveriesRequired).toBe(3);
    expect(setup.objective.initialActiveTrains).toBe(1); // only "a" is init
    expect(setup.objective.fail?.maxActiveTrains).toBeGreaterThan(0);
  });

  it("swaps hands-off for the free-flowing star", () => {
    const setup = puzzleMode.setup(scheduledCtx());
    const ids = (setup.objective.stars ?? []).map(s => s.id).sort();
    expect(ids).toEqual(["no-overflow", "perfect-colours", "speedrun"]);
  });

  it("releases the scheduled trains at their times", () => {
    const setup = puzzleMode.setup(scheduledCtx());
    const spawner = puzzleMode.createSpawner!(setup);
    const released: string[] = [];
    for (let i = 0; i < 8; i++) {
      for (const d of spawner.step(1)) released.push(d.id);
    }
    expect(released).toEqual(["b", "c"]);
  });

  it("adds the last departure to the speedrun star's time", () => {
    const setup = puzzleMode.setup(scheduledCtx());
    const speedrun = (setup.objective.stars ?? []).find(s => s.id === "speedrun")!;
    // 3 trains → base 24s is below the 20s floor? No: max(20, 24) = 24, plus
    // the last spawn at 6s → 30s. A run at 28s keeps the star, 31s loses it.
    const base = {
      delivered: 3,
      mismatchedArrivals: 0,
      elapsedSec: 28,
      manualHolds: 0,
      manualGreens: 0,
      maxCarWaitSec: 0,
      carsDelivered: 0,
      crossingIncidents: 0,
    };
    expect(speedrun.predicate(base)).toBe(true);
    expect(speedrun.predicate({ ...base, elapsedSec: 31 })).toBe(false);
  });
});
