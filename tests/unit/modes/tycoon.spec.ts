import { describe, it, expect } from "vitest";
import {
  tycoonMode,
  fareFor,
  demandTilesOf,
  idealTravelSec,
  maxPayoutOf,
  boardIdOf,
  tuningFor,
  FARE_HANDLING,
  FARE_PER_WAGON,
  FARE_PER_TILE,
  FALLBACK_DEMAND_TILES,
  GENERIC_FARE_GRACE,
  STARTING_BALANCE,
  LAKEVALLEY_OPEN_BALANCE,
  LAKEVALLEY_OPEN_GRACE,
  LAKEVALLEY_OPEN_LEAN_SPEND,
  LAKEVALLEY_OPEN_RING_PIECES,
  LAKEVALLEY_OPEN_PAYDAY,
} from "@/modes/tycoon";
import { MODES, modeById } from "@/modes/index";
import type { TrainDef } from "@/modes/types";
import type { Counters } from "@/sim/objectives";
import {
  fareAt,
  fareFloor,
  fareStepAmount,
  DEFAULT_FARE_STEP_SEC,
} from "@/sim/economy";
import { expandKind } from "@/tiles/kinds";

const trains: TrainDef[] = [
  { id: "a", x: 0, y: 0, type: "people", wagonIds: ["a1", "a2"], destinations: ["3,0"] },
  { id: "b", x: 3, y: 0, type: "fraight", wagonIds: ["b1"], destinations: ["0,0"] },
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

  it("prices a fare from the handling fee, the cargo AND the distance", () => {
    expect(fareFor(trains[0]).base).toBe(
      FARE_HANDLING + 2 * FARE_PER_WAGON.people + 3 * FARE_PER_TILE
    );
    expect(fareFor(trains[1]).base).toBe(
      FARE_HANDLING + FARE_PER_WAGON.fraight + 3 * FARE_PER_TILE
    );
    expect(maxPayoutOf(trains)).toBe(
      fareFor(trains[0]).base + fareFor(trains[1]).base
    );
  });

  it("pays MORE for a longer haul — the whole point of pricing the demand", () => {
    const near = { ...trains[0], destinations: ["1,0"] };
    const far = { ...trains[0], destinations: ["9,0"] };
    expect(demandTilesOf(near)).toBe(1);
    expect(demandTilesOf(far)).toBe(9);
    expect(fareFor(far).base - fareFor(near).base).toBe(8 * FARE_PER_TILE);
  });

  it("measures the demand as the crow flies, summed over the legs it names", () => {
    // Straight-line, not the route driven: a scenic detour must not pay for
    // itself, and on a build board the rail does not exist yet at setup.
    expect(demandTilesOf({ ...trains[0], destinations: ["3,4"] })).toBe(7);
    expect(demandTilesOf({ ...trains[0], destinations: ["2,0", "2,3"] })).toBe(5);
    // A train the level pairs with nothing still prices as a middling haul.
    expect(demandTilesOf({ ...trains[0], destinations: undefined })).toBe(
      FALLBACK_DEMAND_TILES
    );
    // Never zero — the decay below divides by the ideal trip time.
    expect(demandTilesOf({ ...trains[0], destinations: ["0,0"] })).toBe(1);
  });

  it("pays a freight wagon more than a passenger wagon — it is heavier to haul", () => {
    expect(FARE_PER_WAGON.fraight).toBeGreaterThan(FARE_PER_WAGON.people);
    const people = { ...trains[0], wagonIds: ["w1"], type: "people" as const };
    const fraight = { ...people, type: "fraight" as const };
    expect(fareFor(fraight).base - fareFor(people).base).toBe(
      FARE_PER_WAGON.fraight - FARE_PER_WAGON.people
    );
  });

  it("normalises the decay to the trip: distance is a bigger prize, not a harder one", () => {
    const near = fareFor({ ...trains[0], destinations: ["2,0"] });
    const far = fareFor({ ...trains[0], destinations: ["10,0"] });
    // The far haul is worth more AND burns SLOWER per second — its clock is the
    // longer trip it has to make. Both bottom out after the same number of
    // ideal trips, which is what makes distance a prize rather than a penalty.
    expect(far.base).toBeGreaterThan(near.base);
    expect(far.decayPerSec).toBeLessThan(near.decayPerSec);
    for (const [spec, tiles] of [
      [near, 2],
      [far, 10],
    ] as const) {
      const budget = GENERIC_FARE_GRACE * idealTravelSec(tiles);
      expect(spec.decayPerSec * budget).toBeCloseTo(spec.base - fareFloor(spec), 6);
      // Halfway through its grace, each fare has spent about half of what it
      // can lose — the same shape regardless of how far it has to go.
      const half = (spec.base + fareFloor(spec)) / 2;
      expect(fareAt(spec, budget / 2)).toBeGreaterThan(half - 30);
      expect(fareAt(spec, budget / 2)).toBeLessThan(half + 30);
      // The staircase lands on the floor within one step of the ideal line —
      // it holds each value for a beat, so it can never be early.
      expect(fareAt(spec, budget)).toBeLessThanOrEqual(
        fareFloor(spec) + fareStepAmount(spec)
      );
      expect(fareAt(spec, budget + DEFAULT_FARE_STEP_SEC)).toBe(fareFloor(spec));
    }
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

  it("any other board keeps the generic budget, grace and stars", () => {
    const setup = tycoonMode.setup({ ...ctx, levelId: "board:buildgap" });
    expect(setup.economy?.startingBalance).toBe(STARTING_BALANCE);
    expect(setup.economy?.fares?.a.decayPerSec).toBe(
      fareFor(trains[0], GENERIC_FARE_GRACE).decayPerSec
    );
    expect((setup.objective.stars ?? []).map(s => s.id)).toEqual([
      "payday",
      "hands-off",
      "perfect-colours",
    ]);
  });

  it("funds the ring rebuild with room to fumble, and burns slower", () => {
    const setup = tycoonMode.setup(openCtx);
    expect(setup.economy?.startingBalance).toBe(LAKEVALLEY_OPEN_BALANCE);
    // This used to pin budget === rebuild + exactly one spare piece. That was
    // the wrong shape for an OPENING level and the intent changed deliberately
    // (playtested): TV1 gives 100,000$ against a ~10,000$ ring, because the
    // first level teaches the verbs and steers with goals, not scarcity — and
    // we have neither a bulldoze-refund nor a bankruptcy state, so one fumbled
    // drag on a hairline budget soft-locks the board into Retry with no
    // feedback. The floor asserted here is "several misdrags are survivable".
    const rebuild = LAKEVALLEY_OPEN_RING_PIECES * 1000;
    expect(LAKEVALLEY_OPEN_BALANCE).toBeGreaterThanOrEqual(rebuild * 2);
    // Discipline is still scored — but on SPEND, which is independent of the
    // budget, so a generous purse cannot buy the lean star.
    expect(LAKEVALLEY_OPEN_LEAN_SPEND).toBeLessThan(rebuild);
    // …and the opening level burns slower: twice the generic grace, so a fare
    // survives twice as many ideal trips while the player learns to build.
    expect(LAKEVALLEY_OPEN_GRACE).toBe(2 * GENERIC_FARE_GRACE);
    expect(setup.economy?.fares?.a.decayPerSec).toBe(
      fareFor(trains[0], LAKEVALLEY_OPEN_GRACE).decayPerSec
    );
    expect(setup.economy?.fares?.a.decayPerSec).toBeLessThan(
      fareFor(trains[0], GENERIC_FARE_GRACE).decayPerSec
    );
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
    // Measured in a real browser on this board (see the constant's comment):
    // every fare left to rot to its floor pays $611, and a run sent 60s late
    // banks $1,140. The star must not be earnable by dawdling.
    expect(LAKEVALLEY_OPEN_PAYDAY).toBeGreaterThan(1140);
  });
});
