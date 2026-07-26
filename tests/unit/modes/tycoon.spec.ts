import { describe, it, expect } from "vitest";
import {
  tycoonMode,
  fareFor,
  maxPayoutOf,
  BASE_FARE,
  FARE_PER_WAGON,
  FARE_DECAY_PER_SEC,
  STARTING_BALANCE,
} from "@/modes/tycoon";
import { MODES, modeById } from "@/modes/index";
import type { TrainDef } from "@/modes/types";
import type { Counters } from "@/sim/objectives";
import { expandKind } from "@/tiles/kinds";

const trains: TrainDef[] = [
  { id: "a", x: 0, y: 0, type: "people", wagonIds: ["a1", "a2"] },
  { id: "b", x: 3, y: 0, type: "fraight", wagonIds: ["b1"] },
];

const ctx = {
  level: { "0,0": expandKind("depot", 1), "3,0": expandKind("depot", 3) },
  trains,
  levelId: "test",
};

// A Counters fixture with everything at zero, so each test can set only the
// field its predicate reads.
function counters(over: Partial<Counters> = {}): Counters {
  return {
    delivered: 0,
    mismatchedArrivals: 0,
    elapsedSec: 0,
    manualHolds: 0,
    manualGreens: 0,
    maxCarWaitSec: 0,
    carsDelivered: 0,
    crossingIncidents: 0,
    balance: 0,
    earned: 0,
    spent: 0,
    ...over,
  };
}

describe("tycoon mode", () => {
  it("is registered in the mode picker and resolvable by id", () => {
    expect(MODES).toContain(tycoonMode);
    expect(modeById("tycoon")).toBe(tycoonMode);
  });

  it("is the ONLY mode that turns dispatch on", () => {
    const dispatching = MODES.filter(m => m.controls.dispatch);
    expect(dispatching).toEqual([tycoonMode]);
  });

  it("is the ONLY mode that declares an economy", () => {
    const withMoney = MODES.filter(m => m.setup(ctx).economy !== undefined);
    expect(withMoney).toEqual([tycoonMode]);
  });

  it("prices a fare from the loco plus its cargo", () => {
    expect(fareFor(trains[0])).toEqual({
      base: BASE_FARE + 2 * FARE_PER_WAGON,
      decayPerSec: FARE_DECAY_PER_SEC,
    });
    expect(maxPayoutOf(trains)).toBe(2 * BASE_FARE + 3 * FARE_PER_WAGON);
  });

  it("sets up a fare per train plus the starting capital", () => {
    const setup = tycoonMode.setup(ctx);
    expect(setup.economy?.startingBalance).toBe(STARTING_BALANCE);
    expect(Object.keys(setup.economy?.fares ?? {}).sort()).toEqual(["a", "b"]);
  });

  it("requires every train delivered, and counts a waiting train as in play", () => {
    const objective = tycoonMode.setup(ctx).objective;
    expect(objective.deliveriesRequired).toBe(2);
    // A waiting train is in play — its fare is already burning — so the live
    // backlog starts at the full roster instead of counting into negatives.
    expect(objective.initialActiveTrains).toBe(2);
  });

  it("scores its money star off `earned`, at 60% of the maximum payout", () => {
    const stars = tycoonMode.setup(ctx).objective.stars ?? [];
    const payday = stars.find(s => s.id === "payday");
    expect(payday).toBeDefined();
    const target = Math.round(maxPayoutOf(trains) * 0.6);
    expect(payday?.predicate(counters({ earned: target - 1 }))).toBe(false);
    expect(payday?.predicate(counters({ earned: target }))).toBe(true);
  });

  it("keeps three stars on three different axes", () => {
    const stars = tycoonMode.setup(ctx).objective.stars ?? [];
    expect(stars.map(s => s.id)).toEqual([
      "payday",
      "hands-off",
      "perfect-colours",
    ]);
    // Money alone must not earn the other two.
    const rich = counters({ earned: 99999, manualHolds: 1, mismatchedArrivals: 1 });
    expect(stars.filter(s => s.predicate(rich)).map(s => s.id)).toEqual(["payday"]);
  });

  it("shows the money HUD, and no other mode does", () => {
    expect(tycoonMode.hud.money).toBe(true);
    expect(MODES.filter(m => m.hud.money)).toEqual([tycoonMode]);
  });

  it("does not enable the build tool — that is phase 2", () => {
    expect(tycoonMode.controls.build).toBe(false);
  });
});
