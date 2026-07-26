import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import {
  tycoonMode,
  BANKRUPT_BALANCE,
  BANKRUPT_SEC_PER_YEAR,
  BANKRUPT_TAX_PER_PIECE,
} from "@/modes/tycoon";
import { puzzleMode } from "@/modes/puzzle";
import { TRACK_COST_PER_TILE } from "@/sim/economy";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";
import { Position } from "@/types";
import type { RouteStep } from "@/tiles/routePlanner";

// Bankruptcy — the fail half of the second clock (design doc §8, M14's
// survivable part). Driven through `game.advance(dt)`, because the levy only
// happens inside the loop and a hidden browser pane runs no rAF.
//
// The rule under test is narrow on purpose: bankruptcy is OWING MORE THAN YOU
// HAVE, not "the balance reached zero". Finishing flat broke with the railway
// built and the trains running is a tight win, and measured lines do exactly
// that — so the distinction is load-bearing, not pedantry.

const L = Position.Left;
const R = Position.Right;

// The `bankrupt` shape: a line with a two-tile gap.
function gapLevel(): Level {
  return {
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
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
const gapSteps: RouteStep[] = [
  { id: "1,1", a: L, b: R },
  { id: "2,1", a: L, b: R },
  { id: "3,1", a: L, b: R },
];

function bankruptGame(levelId = "test:bankrupt") {
  return createGame(
    gapLevel(),
    trains,
    200,
    tycoonMode,
    1,
    colors,
    undefined,
    levelId
  );
}

const YEAR = BANKRUPT_SEC_PER_YEAR;
const LEVY = 2 * BANKRUPT_TAX_PER_PIECE; // the two-piece direct link

describe("bankruptcy", () => {
  it("ends the run when a levy outruns the balance, and says why", () => {
    const game = bankruptGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    // $5,000 − $2,000 of track buys exactly two years at $1,200.
    expect(game.money.balance).toBe(BANKRUPT_BALANCE - 2 * TRACK_COST_PER_TILE);
    game.advance(YEAR);
    game.advance(YEAR);
    expect(game.money.taxPaid).toBe(2 * LEVY);
    expect(game.objective.phase).toBe("playing");
    expect(game.money.unpaidTax).toBe(0);

    // The third bill cannot be met.
    game.advance(YEAR);
    expect(game.money.unpaidTax).toBeGreaterThan(0);
    expect(game.objective.phase).toBe("lost");
    expect(game.objective.lostReason).toMatch(/Bankrupt/);
    // It names the fix, the way the gridlock nudge does.
    expect(game.objective.lostReason).toMatch(/bulldoze/i);
    // The company paid what it had on the way down — being broke is not free.
    expect(game.money.balance).toBe(0);
    expect(game.money.taxPaid).toBe(BANKRUPT_BALANCE - 2 * TRACK_COST_PER_TILE);
  });

  it("does NOT fail a run that merely ends broke", () => {
    // The distinction that keeps this from being a "balance hit zero" check:
    // several measured lines win with almost nothing left, and a run that pays
    // its last bill in full has not gone bankrupt — it has been thrifty.
    const game = bankruptGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    game.advance(YEAR);
    game.advance(YEAR);
    expect(game.money.balance).toBe(600); // exactly half a levy left
    expect(game.objective.phase).toBe("playing");
    expect(game.objective.lostReason).toBeUndefined();
  });

  it("stops billing at the first shortfall instead of piling on", () => {
    // "You were $18,000 short" says nothing more than "$600 short", and the run
    // is over either way — so the loop stops rather than accruing every later
    // levy against a zero balance.
    const game = bankruptGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    game.advance(YEAR * 20);
    expect(game.money.unpaidTax).toBe(LEVY - 600);
  });

  it("bulldozing before the year turns is the way out", () => {
    // The warning names a fix, so the fix has to work: razing surplus track
    // refunds what it cost AND lowers the next bill.
    const game = bankruptGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    game.advance(YEAR);
    game.advance(YEAR);
    expect(game.money.taxUnaffordable).toBe(true); // $600 in hand, $1,200 due

    expect(game.bulldoze("3,1").ok).toBe(true);
    expect(game.money.balance).toBe(600 + TRACK_COST_PER_TILE);
    expect(game.money.taxPerYear).toBe(BANKRUPT_TAX_PER_PIECE);
    expect(game.money.taxUnaffordable).toBe(false);

    game.advance(YEAR);
    expect(game.objective.phase).toBe("playing");
    expect(game.money.unpaidTax).toBe(0);
  });

  it("warns only when the next bill is really out of reach", () => {
    const game = bankruptGame();
    game.startObjective();
    expect(game.money.taxUnaffordable).toBe(false); // nothing built, nothing due
    game.buildRoute(gapSteps);
    expect(game.money.taxUnaffordable).toBe(false); // $3,000 against $1,200
    game.advance(YEAR);
    expect(game.money.taxUnaffordable).toBe(false); // $1,800
    game.advance(YEAR);
    expect(game.money.taxUnaffordable).toBe(true); // $600 — cannot pay
  });

  it("Retry clears it: a fresh purse, a fresh calendar, no shortfall", () => {
    const game = bankruptGame();
    game.startObjective();
    game.buildRoute(gapSteps);
    game.advance(YEAR * 4);
    expect(game.objective.phase).toBe("lost");

    game.reset();
    expect(game.objective.phase).toBe("ready");
    expect(game.money.unpaidTax).toBe(0);
    expect(game.money.taxUnaffordable).toBe(false);
    expect(game.money.balance).toBe(BANKRUPT_BALANCE);
    expect(game.objective.lostReason).toBeUndefined();
  });
});

describe("bankruptcy cannot fire where there is no tax", () => {
  it("is inert on a Tycoon board with no calendar", () => {
    // `fail.onBankruptcy` is declared for the whole mode because it is
    // self-gating: no calendar ⇒ no levy ⇒ no shortfall.
    const game = bankruptGame("board:buildgap");
    game.startObjective();
    game.buildRoute(gapSteps);
    for (let i = 0; i < 50; i++) game.advance(YEAR);
    expect(game.money.unpaidTax).toBe(0);
    expect(game.objective.phase).toBe("playing");
  });

  it("is not declared by any other mode", () => {
    const setup = puzzleMode.setup({
      level: gapLevel(),
      trains,
      levelId: "test:bankrupt",
    });
    expect(setup.objective.fail?.onBankruptcy).toBeFalsy();
    const game = createGame(
      gapLevel(),
      trains,
      200,
      puzzleMode,
      1,
      colors,
      undefined,
      "test:bankrupt"
    );
    game.startObjective();
    for (let i = 0; i < 20; i++) game.advance(YEAR);
    expect(game.objective.phase).toBe("playing");
  });
});
