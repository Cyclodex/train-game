import { describe, it, expect } from "vitest";
import {
  tycoonMode,
  fareFor,
  maxPayoutOf,
  boardIdOf,
  tuningFor,
  BASE_FARE,
  FARE_PER_WAGON,
  FARE_DECAY_PER_SEC,
  STARTING_BALANCE,
  LAKEVALLEY_OPEN_BALANCE,
  LAKEVALLEY_OPEN_DECAY,
  LAKEVALLEY_OPEN_LEAN_SPEND,
  LAKEVALLEY_OPEN_RING_PIECES,
  LAKEVALLEY_OPEN_PAYDAY,
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

  it("enables the build tool (phase 2) alongside dispatch", () => {
    expect(tycoonMode.controls.build).toBe(true);
    expect(tycoonMode.controls.dispatch).toBe(true);
  });
});

// Per-board tuning: the generic numbers hold everywhere except the boards that
// name their own (Train Valley style — each level names its targets).
describe("tycoon per-board tuning (lakevalley-open)", () => {
  const openCtx = { ...ctx, levelId: "board:lakevalley-open" };

  it("keys off the levelId tail, so /play and /test get the same game", () => {
    expect(boardIdOf("board:lakevalley-open")).toBe("lakevalley-open");
    expect(boardIdOf("test:lakevalley-open")).toBe("lakevalley-open");
    expect(boardIdOf("default")).toBe("default");
    expect(tuningFor("board:lakevalley-open")).toBe(
      tuningFor("test:lakevalley-open")
    );
  });

  it("any other board keeps the generic budget, decay and stars", () => {
    const setup = tycoonMode.setup({ ...ctx, levelId: "board:buildgap" });
    expect(setup.economy?.startingBalance).toBe(STARTING_BALANCE);
    expect(setup.economy?.fares?.a.decayPerSec).toBe(FARE_DECAY_PER_SEC);
    expect((setup.objective.stars ?? []).map(s => s.id)).toEqual([
      "payday",
      "hands-off",
      "perfect-colours",
    ]);
  });

  it("funds the 7-piece ring rebuild with one spare piece, and burns slower", () => {
    const setup = tycoonMode.setup(openCtx);
    expect(setup.economy?.startingBalance).toBe(LAKEVALLEY_OPEN_BALANCE);
    // Comfortable but not lavish: the designed rebuild plus exactly one spare.
    expect(LAKEVALLEY_OPEN_BALANCE).toBe(
      (LAKEVALLEY_OPEN_RING_PIECES + 1) * 1000
    );
    expect(setup.economy?.fares?.a.decayPerSec).toBe(LAKEVALLEY_OPEN_DECAY);
  });

  it("names three goals that pull in different directions", () => {
    const stars = tycoonMode.setup(openCtx).objective.stars ?? [];
    expect(stars.map(s => s.id)).toEqual([
      "payday",
      "under-budget",
      "rail-baron",
    ]);
  });

  it("Under budget and Rail baron are mutually exclusive by arithmetic", () => {
    // 6 pieces cost $6,000; the baron needs 7. All build spend is track, so one
    // run cannot satisfy both — the board is worth at least two runs (§1.3).
    expect(LAKEVALLEY_OPEN_LEAN_SPEND / 1000).toBeLessThan(
      LAKEVALLEY_OPEN_RING_PIECES
    );
    const stars = tycoonMode.setup(openCtx).objective.stars ?? [];
    const under = stars.find(s => s.id === "under-budget")!;
    const baron = stars.find(s => s.id === "rail-baron")!;
    const lean = counters({ spent: 6000, tilesBuilt: 6 });
    const full = counters({ spent: 7000, tilesBuilt: 7 });
    expect(under.predicate(lean)).toBe(true);
    expect(baron.predicate(lean)).toBe(false);
    expect(under.predicate(full)).toBe(false);
    expect(baron.predicate(full)).toBe(true);
  });

  it("Payday reads gross income and sits above the all-floors payout", () => {
    const stars = tycoonMode.setup(openCtx).objective.stars ?? [];
    const payday = stars.find(s => s.id === "payday")!;
    expect(payday.predicate(counters({ earned: LAKEVALLEY_OPEN_PAYDAY }))).toBe(
      true
    );
    expect(
      payday.predicate(counters({ earned: LAKEVALLEY_OPEN_PAYDAY - 1 }))
    ).toBe(false);
    // Letting every fare hit its 25% floor pays 550 on this roster — the star
    // must not be earnable by dawdling.
    expect(LAKEVALLEY_OPEN_PAYDAY).toBeGreaterThan(550);
  });
});
