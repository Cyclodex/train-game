import { describe, it, expect } from "vitest";
import { createGame, Game, TrainDef } from "@/game";
import { puzzleMode } from "@/modes/puzzle";
import { tycoonMode } from "@/modes/tycoon";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";

// The feedback-FX plumbing, end to end through the game loop: an arrival must
// leave a visible trace in `game.fx` (delivery pulse / bounce squash / flying
// fare) for FxLayer.vue to draw. Driven via `advance` — headless, no rAF.

// Two disjoint lanes: row 0 delivers (match), row 2 bounces (mismatch).
function twoLaneLevel(): Level {
  return {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("depot", 3),
    "0,2": expandKind("depot", 1),
    "1,2": expandKind("straight", 1),
    "2,2": expandKind("depot", 3),
  };
}

const trains: TrainDef[] = [
  { id: "hit", x: 0, y: 0, type: "people", wagonIds: ["w1"] },
  { id: "miss", x: 0, y: 2, type: "fraight", wagonIds: ["w2"] },
];

const colors = {
  depotColors: { "0,0": "blue", "2,0": "green", "0,2": "blue", "2,2": "red" },
  trainColors: { hit: "green", miss: "blue" },
};

function advanceUntil(game: Game, pred: () => boolean, maxSec = 120): void {
  for (let t = 0; t < maxSec && !pred(); t += 0.1) game.advance(0.1);
}

describe("feedback fx from the event stream", () => {
  it("a matched arrival pushes a delivery pulse at the depot", () => {
    const game = createGame(twoLaneLevel(), trains, 200, puzzleMode, 1, colors);
    game.startObjective();
    advanceUntil(game, () => game.fx.some(f => f.kind === "delivery"));
    const fx = game.fx.find(f => f.kind === "delivery");
    expect(fx).toBeDefined();
    expect(fx?.tileId).toBe("2,0");
  });

  it("a mismatched arrival pushes a bounce squash at the depot it hit", () => {
    const game = createGame(twoLaneLevel(), trains, 200, puzzleMode, 1, colors);
    game.startObjective();
    advanceUntil(game, () => game.fx.some(f => f.kind === "bounce"));
    const fx = game.fx.find(f => f.kind === "bounce");
    expect(fx).toBeDefined();
    expect(fx?.tileId).toBe("2,2");
    // No fare was banked on a bounce — nothing may fly to the account.
    expect(game.fx.some(f => f.kind === "cash")).toBe(false);
  });

  it("a banked fare (Tycoon) pushes a cash chip carrying the amount", () => {
    const game = createGame(
      twoLaneLevel(),
      trains,
      200,
      tycoonMode,
      1,
      colors,
      undefined,
      "test:gamefeel"
    );
    game.startObjective();
    // Tycoon trains wait in their sheds for dispatch — the pin click, headless.
    game.dispatch("hit");
    advanceUntil(game, () => game.fx.some(f => f.kind === "cash"));
    const fx = game.fx.find(f => f.kind === "cash");
    expect(fx).toBeDefined();
    expect(fx?.tileId).toBe("2,0");
    expect(fx?.amount ?? 0).toBeGreaterThan(0);
    expect(game.money.earned).toBeGreaterThan(0);
  });

  it("reset clears the fx list with the rest of the run", () => {
    const game = createGame(twoLaneLevel(), trains, 200, puzzleMode, 1, colors);
    game.startObjective();
    advanceUntil(game, () => game.fx.length > 0);
    expect(game.fx.length).toBeGreaterThan(0);
    game.reset();
    expect(game.fx.length).toBe(0);
  });
});
