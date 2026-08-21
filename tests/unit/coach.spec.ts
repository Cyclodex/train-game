import { describe, it, expect } from "vitest";
import {
  COACH_BY_BOARD,
  CoachObs,
  coachMarksFor,
  createCoach,
} from "@/coach";
import { SCENARIOS } from "@/levels/test/index";
import { modeById } from "@/modes/index";
import { tycoonMode } from "@/modes/tycoon";
import { puzzleMode } from "@/modes/puzzle";
import { coachmarks } from "@/levels/test/scenarios/coachmarks";
import { createGame, TrainDef } from "@/game";
import { parseCoordId } from "@/tiles/model";
import { ActiveIntersection } from "@/types";

// The teaching system (src/coach.ts): a per-board list of anchored hints,
// shown one at a time in authored order, each dismissed by the player actually
// performing the action it teaches. The controller is a pure state machine
// over cumulative run facts, which is what makes all of this testable here
// without a browser.

function obs(partial: Partial<CoachObs> = {}): CoachObs {
  return {
    phase: "playing",
    tilesBuilt: 0,
    dispatches: 0,
    switchTouched: false,
    delivered: 0,
    ...partial,
  };
}

const SPECS = [
  {
    id: "a-build",
    text: "build",
    anchor: { kind: "tile" as const, id: "0,0" },
    done: (o: CoachObs) => o.tilesBuilt >= 1,
  },
  {
    id: "b-dispatch",
    text: "dispatch",
    anchor: { kind: "tile" as const, id: "1,0" },
    done: (o: CoachObs) => o.dispatches >= 1,
  },
];

describe("createCoach — sequencing", () => {
  it("shows nothing outside the playing phase", () => {
    const coach = createCoach(SPECS);
    coach.step(obs({ phase: "ready" }));
    expect(coach.active).toBeNull();
    coach.step(obs({ phase: "won", tilesBuilt: 0 }));
    expect(coach.active).toBeNull();
  });

  it("shows the first mark, and advances to the next when its action happens", () => {
    const coach = createCoach(SPECS);
    coach.step(obs());
    expect(coach.active?.id).toBe("a-build");
    // Doing something else does not dismiss it.
    coach.step(obs({ dispatches: 1 }));
    expect(coach.active?.id).toBe("a-build");
    // Doing THE thing does — and the next mark takes over in the same step.
    coach.step(obs({ tilesBuilt: 1, dispatches: 0 }));
    expect(coach.active?.id).toBe("b-dispatch");
  });

  it("never re-teaches a verb performed before its mark appeared", () => {
    const coach = createCoach(SPECS);
    // The player dispatched during the build lesson; when the build completes,
    // the dispatch mark's action has already happened, so it never shows.
    coach.step(obs({ dispatches: 1 }));
    expect(coach.active?.id).toBe("a-build");
    coach.step(obs({ tilesBuilt: 1, dispatches: 1 }));
    expect(coach.active).toBeNull();
  });

  it("keeps completed marks completed across newRun (Retry never nags)", () => {
    const coach = createCoach(SPECS);
    coach.step(obs({ tilesBuilt: 1 }));
    expect(coach.active?.id).toBe("b-dispatch");
    coach.newRun();
    // The new run's facts start at zero, but the build lesson stays learned:
    // the first mark shown is the one the player never finished.
    coach.step(obs());
    expect(coach.active?.id).toBe("b-dispatch");
  });

  it("reports empty for a board with no hints", () => {
    expect(createCoach([]).empty).toBe(true);
    expect(createCoach(SPECS).empty).toBe(false);
  });
});

describe("coachMarksFor — mode gating", () => {
  it("filters marks whose verb the mode has disabled", () => {
    // Tycoon has build+dispatch, so buildgap teaches both.
    expect(coachMarksFor("board:buildgap", tycoonMode.controls)).toHaveLength(2);
    // Puzzle has neither, so the same board teaches nothing there — a mark
    // that could never be dismissed would be a dead end.
    expect(coachMarksFor("board:buildgap", puzzleMode.controls)).toHaveLength(0);
  });

  it("resolves board ids from both /play and /test levelIds", () => {
    const a = coachMarksFor("board:lakevalley-open", tycoonMode.controls);
    const b = coachMarksFor("test:lakevalley-open", tycoonMode.controls);
    expect(a.map(m => m.id)).toEqual(b.map(m => m.id));
    expect(a).toHaveLength(3);
  });

  it("teaches nothing on an unlisted board", () => {
    expect(coachMarksFor("board:demoworld", tycoonMode.controls)).toHaveLength(0);
  });
});

// Both the scenario registry and COACH_BY_BOARD fail SILENTLY on a typo (an
// unknown board simply teaches nothing; scenarioById falls back to its first
// entry), so the wiring is pinned here: every keyed board is a real scenario,
// every anchor names a place that exists on it, and every `needs` verb is one
// the scenario's own mode actually enables.
describe("COACH_BY_BOARD — registry integrity", () => {
  const entries = Object.entries(COACH_BY_BOARD);

  it("keys only real scenarios", () => {
    for (const [board] of entries) {
      expect(
        SCENARIOS.some(s => s.id === board),
        `${board} is not a /test scenario`
      ).toBe(true);
    }
  });

  it("anchors name coordinates inside the board and trains that exist on it", () => {
    for (const [board, marks] of entries) {
      const scenario = SCENARIOS.find(s => s.id === board)!;
      const cols =
        scenario.size?.cols ??
        Math.max(...Object.keys(scenario.level).map(k => parseCoordId(k).x)) + 1;
      const rows =
        scenario.size?.rows ??
        Math.max(...Object.keys(scenario.level).map(k => parseCoordId(k).y)) + 1;
      for (const mark of marks) {
        if (mark.anchor.kind === "tile") {
          // A tile anchor may name an EMPTY cell (a build mark points at the
          // gap), so the check is "inside the world", not "has a tile".
          const { x, y } = parseCoordId(mark.anchor.id);
          const dx = mark.anchor.dx ?? 0;
          const dy = mark.anchor.dy ?? 0;
          expect(x + dx, `${board}/${mark.id} x`).toBeGreaterThanOrEqual(0);
          expect(x + dx, `${board}/${mark.id} x`).toBeLessThan(cols);
          expect(y + dy, `${board}/${mark.id} y`).toBeGreaterThanOrEqual(0);
          expect(y + dy, `${board}/${mark.id} y`).toBeLessThan(rows);
        } else {
          const train = scenario.trains[mark.anchor.id];
          expect(train, `${board}/${mark.id} train`).toBeDefined();
          const home = parseCoordId(mark.anchor.homeTile);
          expect({ x: train.x, y: train.y }, `${board}/${mark.id} home`).toEqual(
            { x: home.x, y: home.y }
          );
        }
      }
    }
  });

  it("every needed verb is enabled by the scenario's own mode", () => {
    for (const [board, marks] of entries) {
      const scenario = SCENARIOS.find(s => s.id === board)!;
      const mode = scenario.modeId ? modeById(scenario.modeId) : null;
      for (const mark of marks) {
        if (!mark.needs || !mode) continue;
        expect(
          mode.controls[mark.needs],
          `${board}/${mark.id} needs ${mark.needs}`
        ).toBe(true);
      }
    }
  });
});

// The wiring through the game itself, headless: the mark appears once the run
// starts, moves on when the train is sent, falls silent when the junction arm
// is set — and a Retry does not bring any of it back.
describe("game.coach — the coachmarks board end to end", () => {
  function coachGame() {
    const trains: TrainDef[] = [
      {
        id: "t1",
        x: 0,
        y: 1,
        type: "people",
        wagonIds: ["w1"],
        destinations: ["4,1"],
      },
    ];
    return createGame(
      structuredClone(coachmarks.level),
      trains,
      200,
      tycoonMode,
      1,
      coachmarks.colors,
      undefined,
      "test:coachmarks"
    );
  }

  it("teaches dispatch, then the switch, each dismissed by the action itself", () => {
    const game = coachGame();
    // Nothing floats over the Ready card.
    game.advance(0.1);
    expect(game.coach.active).toBeNull();

    game.startObjective();
    game.advance(0.1);
    expect(game.coach.active?.id).toBe("dispatch-train");
    expect(game.coach.active?.anchor).toMatchObject({ kind: "train", id: "t1" });

    // Sending the train is the dismissal — and the switch lesson takes over.
    expect(game.dispatch("t1")).toBe(true);
    game.advance(0.1);
    expect(game.coach.active?.id).toBe("set-switch");
    expect(game.coach.active?.anchor).toMatchObject({ kind: "tile", id: "2,1" });

    // Setting the junction's arm (what Tile.vue's pickArm does) ends the class.
    const arms = game.switches["2,1"];
    const entry = Number(Object.keys(arms)[0]);
    arms[entry] = ((arms[entry] + 1) % 3) as ActiveIntersection;
    game.advance(0.1);
    expect(game.coach.active).toBeNull();
  });

  it("stays silent after a Retry for verbs already performed", () => {
    const game = coachGame();
    game.startObjective();
    game.advance(0.1);
    game.dispatch("t1");
    const arms = game.switches["2,1"];
    const entry = Number(Object.keys(arms)[0]);
    game.advance(0.1);
    arms[entry] = ((arms[entry] + 1) % 3) as ActiveIntersection;
    game.advance(0.1);
    expect(game.coach.active).toBeNull();

    game.reset();
    game.startObjective();
    game.advance(0.1);
    expect(game.coach.active).toBeNull();
  });

  it("does not count a merged-in junction entry as a player flip", () => {
    const game = coachGame();
    game.startObjective();
    game.advance(0.1);
    game.dispatch("t1");
    game.advance(0.1);
    expect(game.coach.active?.id).toBe("set-switch");
    // A NEW switch key appearing (what applyEdits does when a build creates a
    // junction) is not a flip: only a changed arm on an existing entry counts.
    game.switches["9,9"] = { 0: ActiveIntersection.Left };
    game.advance(0.1);
    expect(game.coach.active?.id).toBe("set-switch");
  });
});
