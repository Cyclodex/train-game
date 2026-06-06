import { describe, it, expect } from "vitest";
import { crossingKeeperMode } from "@/modes/crossing-keeper";
import { keepcrossingclear } from "@/levels/test/scenarios/keepcrossingclear";

function ctx() {
  const trains = Object.values(keepcrossingclear.trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
  }));
  return { level: keepcrossingclear.level, trains, levelId: "keepcrossingclear" };
}

describe("crossing-keeper mode", () => {
  it("enables the crossing gate, not signal holds", () => {
    expect(crossingKeeperMode.controls).toEqual({
      switches: true,
      signalHolds: false,
      crossingGate: true,
      build: false,
    });
  });

  it("requires delivering every train and never spawns", () => {
    const setup = crossingKeeperMode.setup(ctx());
    expect(setup.objective.deliveriesRequired).toBe(setup.trains.length);
    expect(crossingKeeperMode.createSpawner).toBeUndefined();
  });

  it("fails on a gridlocked crossing and on a crossing incident", () => {
    const setup = crossingKeeperMode.setup(ctx());
    expect(setup.objective.fail?.maxCarWaitSec).toBeGreaterThan(0);
    expect(setup.objective.fail?.onCrossingIncident).toBe(true);
  });

  it("offers speedrun, smooth-operator and flawless stars", () => {
    const setup = crossingKeeperMode.setup(ctx());
    const ids = (setup.objective.stars ?? []).map(s => s.id).sort();
    expect(ids).toEqual(["flawless", "smooth-operator", "speedrun"]);
  });

  it("smooth-operator star is lost once a car waits too long", () => {
    const setup = crossingKeeperMode.setup(ctx());
    const star = (setup.objective.stars ?? []).find(
      s => s.id === "smooth-operator"
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
    expect(star.predicate({ ...base, maxCarWaitSec: 999 })).toBe(false);
  });

  it("hud shows the full objective UI", () => {
    expect(crossingKeeperMode.hud).toEqual({
      deliveries: true,
      timer: true,
      stars: true,
      startOverlay: true,
      endOverlay: true,
    });
  });
});
