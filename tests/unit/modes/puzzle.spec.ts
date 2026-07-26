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

  it("requires delivering every train and never spawns", () => {
    const setup = puzzleMode.setup(ctx());
    expect(setup.objective.deliveriesRequired).toBe(setup.trains.length);
    expect(puzzleMode.createSpawner).toBeUndefined();
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
