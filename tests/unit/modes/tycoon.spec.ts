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
  LAKEVALLEY_OPEN_START_YEAR,
  LAKEVALLEY_OPEN_SEC_PER_YEAR,
  LAKEVALLEY_OPEN_TAX_PER_PIECE,
  TAXYEAR_SEC_PER_YEAR,
  TAXYEAR_TAX_PER_PIECE,
} from "@/modes/tycoon";
import { taxFor } from "@/sim/calendar";
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
    trackSpent: 0,
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
    // And NO calendar: the boards that fall through to the generic tuning are
    // the one-mechanic test scenarios on a $3,000 budget, where an annual levy
    // would both muddy the lesson and, on that purse, dominate it. The tax is
    // opt-in per board exactly like every other dial here.
    expect(setup.economy?.calendar).toBeUndefined();
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
    const lean = counters({ trackSpent: 6000, tilesBuilt: 6 });
    const full = counters({ trackSpent: 7000, tilesBuilt: 7 });
    expect(under.predicate(lean)).toBe(true);
    expect(baron.predicate(lean)).toBe(false);
    expect(under.predicate(full)).toBe(false);
    expect(baron.predicate(full)).toBe(true);
  });

  it("Under budget measures BUILD discipline, not time — the tax cannot cost it", () => {
    // The trap this feature had to be steered around. The annual levy books
    // through the same ledger, so it lands in `spent`; a star reading `spent`
    // would be lost by DAWDLING rather than by over-building — i.e. it would
    // stop measuring the build and start measuring time, which is the axis
    // Payday already scores. It reads `trackSpent` for exactly that reason.
    const stars = tycoonMode.setup(openCtx).objective.stars ?? [];
    const under = stars.find(s => s.id === "under-budget")!;
    // A lean build that took forever: $6,000 of track, $9,000 of upkeep on top.
    const leanButSlow = counters({
      trackSpent: 6000,
      spent: 15000,
      tilesBuilt: 6,
    });
    expect(under.predicate(leanButSlow)).toBe(true);
    // And an over-build still loses it, tax or no tax.
    expect(under.predicate(counters({ trackSpent: 7000, spent: 7000 }))).toBe(
      false
    );
  });

  it("runs a calendar, and levies upkeep only on player-laid track", () => {
    const cal = tycoonMode.setup(openCtx).economy?.calendar;
    expect(cal).toEqual({
      startYear: LAKEVALLEY_OPEN_START_YEAR,
      secPerYear: LAKEVALLEY_OPEN_SEC_PER_YEAR,
      taxPerTrackPiecePerYear: LAKEVALLEY_OPEN_TAX_PER_PIECE,
    });
    // Measured win times through the real UI, and the levies each line pays at
    // this dial. A levy has to land at least TWICE in a WINNING run: at 20s/year
    // the prompt line finished inside its second year and paid once, which reads
    // as a one-off fee rather than a clock. That measurement is what these
    // numbers are, so they are pinned here rather than left to taste.
    const levies = (winSec: number) =>
      Math.floor(winSec / LAKEVALLEY_OPEN_SEC_PER_YEAR);
    const full = taxFor(cal!, LAKEVALLEY_OPEN_RING_PIECES);
    const lean = taxFor(cal!, LAKEVALLEY_OPEN_RING_PIECES - 1);
    expect(levies(35)).toBeGreaterThanOrEqual(2);

    const promptTax = levies(35) * full;
    const leanTax = levies(75) * lean;
    const dawdleTax = levies(95) * full;

    // "Hurry": dawdling costs several times what a prompt run does.
    expect(dawdleTax).toBeGreaterThan(2 * promptTax);
    // "Build lean" is a real trade, not a free win: the lean line saves $1,000
    // of capital up front and gives more than that back in upkeep, because it
    // runs slower.
    expect(leanTax - promptTax).toBeGreaterThan(1000);
    // NO LINE MAY RUN THE CAPITAL DRY — and the margin has to be a whole spare
    // piece of track, not merely positive. There is no bankruptcy state yet
    // (deliberately, §8), so a line that cannot afford a rescue build soft-locks
    // silently, which is the worst thing this dial can buy. Measured on CAPITAL
    // ALONE: counting the fares would let a line be rescued by income that only
    // arrives at the end, long after the player needed the money. $200/piece
    // failed exactly here (the dawdling line reached −$400).
    const left = (track: number, tax: number) =>
      LAKEVALLEY_OPEN_BALANCE - track - tax;
    for (const margin of [
      left(7000, promptTax),
      left(6000, leanTax),
      left(7000, dawdleTax),
    ]) {
      expect(margin).toBeGreaterThanOrEqual(1000);
    }
    // And the upkeep on a prompt full rebuild outweighs what that run earns —
    // the sentence the mechanic exists to say.
    expect(promptTax).toBeGreaterThan(LAKEVALLEY_OPEN_PAYDAY);
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
    // must not be earnable by dawdling. Unaffected by the tax, which eats the
    // BALANCE and never `earned`.
    expect(LAKEVALLEY_OPEN_PAYDAY).toBeGreaterThan(550);
  });
});

// The feature-test board for the second clock (project rule: every mechanic
// ships a scenario that shows it in isolation).
describe("tycoon per-board tuning (taxyear)", () => {
  it("dials the calendar for WATCHING: a short year and a visible levy", () => {
    const setup = tycoonMode.setup({ ...ctx, levelId: "test:taxyear" });
    const cal = setup.economy?.calendar;
    expect(cal?.secPerYear).toBe(TAXYEAR_SEC_PER_YEAR);
    expect(cal?.taxPerTrackPiecePerYear).toBe(TAXYEAR_TAX_PER_PIECE);
    // Faster than the board it teaches for, so a levy lands while you are still
    // looking at the balance...
    expect(TAXYEAR_SEC_PER_YEAR).toBeLessThan(LAKEVALLEY_OPEN_SEC_PER_YEAR);
    // ...and the purse survives several years of it, so the demonstration does
    // not soft-lock before the point lands.
    const twoPieces = taxFor(cal!, 2);
    expect(setup.economy!.startingBalance! - 2000).toBeGreaterThan(5 * twoPieces);
  });

  it("reaches the same tuning from /play and from /test", () => {
    expect(tuningFor("board:taxyear")).toBe(tuningFor("test:taxyear"));
  });
});
