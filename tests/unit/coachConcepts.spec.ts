import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { tycoonMode, BANKRUPT_SEC_PER_YEAR } from "@/modes/tycoon";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";
import { Position } from "@/types";
import type { RouteStep } from "@/tiles/routePlanner";
import { heldby } from "@/levels/test/scenarios/heldby";

// The first-encounter hints (tier 2, COACH_CONCEPTS), driven through the real
// game headlessly — `game.advance(dt)`, because the coach only steps inside
// the loop and a hidden browser pane runs no rAF. Each test is a situation
// arising on a real board and the hint appearing ON the thing, then being
// dismissed by the situation resolving (held-train) or by dwell (first-levy).
//
// The seen-store is per-game-instance here (node has no localStorage, so the
// store falls back to its in-memory set), which is exactly the isolation a
// unit test wants.

const L = Position.Left;
const R = Position.Right;

describe("first-encounter hints — held-train on the heldby board", () => {
  function heldbyGame() {
    const defs: TrainDef[] = [
      {
        id: "east",
        x: 0,
        y: 1,
        type: "people",
        wagonIds: ["e1", "e2"],
        destinations: ["2,1"],
      },
      {
        id: "south",
        x: 1,
        y: 0,
        type: "people",
        wagonIds: ["s1", "s2"],
        destinations: ["1,2"],
      },
    ];
    return createGame(
      structuredClone(heldby.level),
      defs,
      200,
      tycoonMode,
      1,
      heldby.colors,
      undefined,
      "test:heldby"
    );
  }

  it("appears on the blocked train while the block holds, and completes when it clears", () => {
    const game = heldbyGame();
    game.startObjective();
    // Send east first — it reserves the crossing all the way to its depot —
    // then south, which noses out of its shed and stops on the reservation.
    expect(game.dispatch("east")).toBe(true);
    game.advance(0.2);
    expect(game.dispatch("south")).toBe(true);

    let sawHint = false;
    for (let i = 0; i < 100 && !sawHint; i++) {
      game.advance(0.2);
      if (game.coach.active?.id === "held-train") sawHint = true;
    }
    expect(sawHint, "the held-train hint never appeared").toBe(true);
    expect(game.coach.active?.kind).toBe("concept");
    // Anchored to the train that is actually held — south, not the culprit.
    expect(game.coach.active?.anchor).toMatchObject({
      kind: "train",
      id: "south",
    });

    // East parks, the block clears, south rolls — the situation resolving IS
    // the dismissal.
    let cleared = false;
    for (let i = 0; i < 200 && !cleared; i++) {
      game.advance(0.2);
      if (game.coach.active === null) cleared = true;
    }
    expect(cleared, "the hint never cleared").toBe(true);

    // Taught once: a later hold on the same board teaches nothing more. (The
    // second leg of this board never re-blocks, so assert via the controller's
    // memory — the hint must not come back while south is still en route.)
    for (let i = 0; i < 50; i++) {
      game.advance(0.2);
      expect(game.coach.active?.id).not.toBe("held-train");
    }
  });
});

describe("first-encounter hints — the second clock's bills", () => {
  // The bankrupt shape: a line with a two-tile gap, under the bankrupt
  // board's tuning (8-second year, $600 a piece) so the whole arc fits in a
  // minute of sim time.
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

  it("teaches the first levy at the calendar, then the affordability warning", () => {
    const game = createGame(
      gapLevel(),
      trains,
      200,
      tycoonMode,
      1,
      colors,
      undefined,
      "test:bankrupt"
    );
    game.startObjective();
    game.buildRoute(gapSteps);

    // Walk the run in small steps and record the hints in order of appearance.
    const seen: string[] = [];
    for (let t = 0; t < 5 * BANKRUPT_SEC_PER_YEAR; t += 0.5) {
      game.advance(0.5);
      const id = game.coach.active?.id;
      if (id && seen[seen.length - 1] !== id) seen.push(id);
      if (game.coach.active?.id === "first-levy") {
        expect(game.coach.active.anchor).toMatchObject({
          kind: "hud",
          slot: "calendar",
        });
        expect(game.coach.active.kind).toBe("concept");
      }
    }
    // The first bill explains itself, and — once the balance can no longer
    // cover next year — the warning does too, in that order, each once.
    expect(seen).toEqual(["first-levy", "tax-warning"]);
  });
});
