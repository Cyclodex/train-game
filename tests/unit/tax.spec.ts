import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { tycoonMode, TAXYEAR_BALANCE, TAXYEAR_TAX_PER_PIECE, TAXYEAR_SEC_PER_YEAR } from "@/modes/tycoon";
import { puzzleMode } from "@/modes/puzzle";
import { CLEARING_COST_PER_TILE, TRACK_COST_PER_TILE } from "@/sim/economy";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";
import { Position } from "@/types";
import type { RouteStep } from "@/tiles/routePlanner";

// The annual levy, end to end through the game loop — the second clock of
// design doc §1.3 (M1/M13).
//
// Driven through `game.advance(dt)` rather than the rAF frame: a hidden browser
// pane runs no requestAnimationFrame, so anything only reachable from `frame()`
// cannot be observed headlessly at all (KNOWHOW → VERIFY). `advance` is that
// frame body minus the drawing.

const L = Position.Left;
const R = Position.Right;

// The `taxyear` shape: a line with a two-tile gap.
function gapLevel(): Level {
  return {
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    // 2,1 / 3,1: the gap
    "4,1": expandKind("straight", 1),
    "5,1": expandKind("depot", 3),
  };
}

const trains: TrainDef[] = [
  { id: "t1", x: 0, y: 1, type: "people", wagonIds: ["w1"] },
];

const colors = {
  depotColors: { "0,1": "blue", "5,1": "green" },
  trainColors: { t1: "green" },
};

// The direct link: the anchor straight (already there, free) plus two new tiles.
const gapSteps: RouteStep[] = [
  { id: "1,1", a: L, b: R },
  { id: "2,1", a: L, b: R },
  { id: "3,1", a: L, b: R },
];

// `taxyear` is one of the two boards tuned for a calendar; every other board
// falls through to the generic tuning and has none.
function taxGame(level: Level = gapLevel()) {
  return createGame(
    level,
    trains,
    200,
    tycoonMode,
    1,
    colors,
    undefined,
    "test:taxyear"
  );
}

const YEAR = TAXYEAR_SEC_PER_YEAR;

describe("the annual levy", () => {
  it("does not tick behind the Ready card", () => {
    const game = taxGame();
    game.buildRoute(gapSteps);
    const afterBuild = game.money.balance;
    // The objective is still "ready" — the player has not pressed Start. Even
    // handed a whole decade of dt, nothing accrues: the ledger's clock is gated
    // on the objective being live, and the levy is denominated in that clock.
    for (let i = 0; i < 10; i++) game.advance(YEAR);
    expect(game.money.balance).toBe(afterBuild);
    expect(game.money.taxPaid).toBe(0);
    expect(game.money.dateLabel).toBe("Jan 1830");
  });

  it("charges nothing for the level's own track — only for what you laid", () => {
    const game = taxGame();
    game.startObjective();
    // Nothing bought yet. The board arrives with rails on it and they are the
    // company's existing line: a tax on those would be a constant the player
    // cannot act on, which is exactly what the mechanic must not be.
    expect(game.money.taxPerYear).toBe(0);
    for (let i = 0; i < 3; i++) game.advance(YEAR);
    expect(game.money.balance).toBe(TAXYEAR_BALANCE);
    expect(game.money.taxPaid).toBe(0);
    // The calendar still ran — it is the tax that was zero, not the clock.
    expect(game.money.dateLabel).toBe("Jan 1833");
  });

  it("bills one levy per completed year, priced by the track standing", () => {
    const game = taxGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    const built = 2;
    const levy = built * TAXYEAR_TAX_PER_PIECE;
    expect(game.money.taxPerYear).toBe(levy);

    const afterBuild = TAXYEAR_BALANCE - built * TRACK_COST_PER_TILE;
    expect(game.money.balance).toBe(afterBuild);

    // Just short of the year: still nothing.
    game.advance(YEAR - 0.5);
    expect(game.money.balance).toBe(afterBuild);
    // Over the boundary: exactly one levy.
    game.advance(1);
    expect(game.money.balance).toBe(afterBuild - levy);
    expect(game.money.taxPaid).toBe(levy);
    // And a second year charges a second.
    game.advance(YEAR);
    expect(game.money.balance).toBe(afterBuild - 2 * levy);
  });

  it("bills every year a single big step crossed — a skipped levy is free money", () => {
    // One frame at 4x speed (or a headless catch-up) can span more than one
    // year boundary. The collector loops for exactly this reason.
    const game = taxGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    const afterBuild = game.money.balance;
    game.advance(YEAR * 3);
    expect(game.money.taxPaid).toBe(3 * 2 * TAXYEAR_TAX_PER_PIECE);
    expect(game.money.balance).toBe(afterBuild - game.money.taxPaid);
  });

  it("keeps the tax out of `trackSpent` but inside `spent`", () => {
    // THE TRAP this feature had to be steered around: the "Under budget" star
    // reads how much went on TRACK. Booked through `spend`, the tax lands in
    // `spent` — correct, the ledger is all outgoings — so the star had to move
    // to a build-only counter or it would silently become a second time star.
    const game = taxGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    const track = 2 * TRACK_COST_PER_TILE;
    game.advance(YEAR * 2);
    const tax = 2 * 2 * TAXYEAR_TAX_PER_PIECE;

    expect(game.money.trackSpent).toBe(track);
    expect(game.money.spent).toBe(track + tax);
    expect(game.money.taxPaid).toBe(tax);
    // The counters the star predicates read agree with the mirror.
    expect(game.objective.counters.trackSpent).toBe(track);
    expect(game.objective.counters.spent).toBe(track + tax);
    // Dawdling for another decade must not move `trackSpent` by a penny.
    for (let i = 0; i < 10; i++) game.advance(YEAR);
    expect(game.objective.counters.trackSpent).toBe(track);
  });

  it("charges upkeep on the railway that is STANDING, so clearing lowers it", () => {
    // Clearing surplus track is the second way out of an upkeep spiral (the
    // first is delivering). It costs a fee and is worth it only with years left
    // to save — here, one year of upkeep on the spur is $300 and so is the fee,
    // so it pays from the second year on.
    const game = taxGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    expect(game.money.taxPerYear).toBe(2 * TAXYEAR_TAX_PER_PIECE);

    // A pointless spur, on its own tile so it can be cleared by itself.
    const spur: RouteStep[] = [{ id: "2,2", a: Position.Top, b: Position.Bottom }];
    game.buildRoute(spur);
    expect(game.money.taxPerYear).toBe(3 * TAXYEAR_TAX_PER_PIECE);
    const beforeClearing = game.money.balance;

    expect(game.bulldoze("2,2").ok).toBe(true);
    expect(game.money.taxPerYear).toBe(2 * TAXYEAR_TAX_PER_PIECE);
    // It COST money — clearing never pays back...
    expect(game.money.balance).toBe(beforeClearing - CLEARING_COST_PER_TILE);
    // ...and `trackSpent` does not fall with it: that money was spent. Only
    // `tilesBuilt` (and so the upkeep) counts the railway you kept.
    expect(game.money.trackSpent).toBe(3 * TRACK_COST_PER_TILE);

    const before = game.money.balance;
    game.advance(YEAR);
    expect(game.money.balance).toBe(before - 2 * TAXYEAR_TAX_PER_PIECE);
  });

  it("takes what is there rather than letting being broke be free", () => {
    // `spend` REFUSES an unaffordable amount, so a levy bigger than the balance
    // would otherwise be waived entirely — being broke would be free. It takes
    // the remainder instead, and the shortfall is what bankruptcy reads.
    const game = taxGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    // The train is waiting for dispatch and never sent, so nothing pays in.
    for (let i = 0; i < 40; i++) game.advance(YEAR);
    expect(game.money.balance).toBe(0);
    // Everything that was there went on track and tax, and nothing more.
    expect(game.money.trackSpent + game.money.taxPaid).toBe(TAXYEAR_BALANCE);
  });

  it("Retry re-opens the level on 1 January with the capital back", () => {
    const game = taxGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    game.advance(YEAR * 2);
    expect(game.money.taxPaid).toBeGreaterThan(0);

    game.reset();
    expect(game.money.balance).toBe(TAXYEAR_BALANCE);
    expect(game.money.taxPaid).toBe(0);
    expect(game.money.trackSpent).toBe(0);
    expect(game.money.taxPerYear).toBe(0);
    expect(game.money.dateLabel).toBe("Jan 1830");
    // And the second run bills from year one again, not from where it left off.
    game.startObjective();
    game.buildRoute(gapSteps);
    game.advance(YEAR);
    expect(game.money.taxPaid).toBe(2 * TAXYEAR_TAX_PER_PIECE);
  });
});

describe("boards and modes without a calendar", () => {
  it("an untuned Tycoon board has no calendar and is never taxed", () => {
    // The generic tuning deliberately names none: the boards that fall through
    // to it are the one-mechanic test scenarios on a $3,000 budget, where a
    // levy would both muddy the lesson and dominate it.
    const game = createGame(
      gapLevel(),
      trains,
      200,
      tycoonMode,
      1,
      colors,
      undefined,
      "board:buildgap"
    );
    game.startObjective();
    game.buildRoute(gapSteps);
    const afterBuild = game.money.balance;
    for (let i = 0; i < 20; i++) game.advance(YEAR);
    expect(game.money.dateLabel).toBe("");
    expect(game.money.taxPerYear).toBe(0);
    expect(game.money.taxPaid).toBe(0);
    expect(game.money.balance).toBe(afterBuild);
  });

  it("a mode with no economy grows no money chrome at all", () => {
    const game = createGame(
      gapLevel(),
      trains,
      200,
      puzzleMode,
      1,
      colors,
      undefined,
      "test:taxyear" // even on the tuned board id — the mode owns the economy
    );
    game.startObjective();
    for (let i = 0; i < 5; i++) game.advance(YEAR);
    expect(game.money.enabled).toBe(false);
    expect(game.money.dateLabel).toBe("");
    expect(game.money.balance).toBe(0);
  });
});
