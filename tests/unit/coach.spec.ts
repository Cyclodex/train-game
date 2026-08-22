import { describe, it, expect } from "vitest";
import {
  COACH_BY_BOARD,
  COACH_CONCEPTS,
  CONCEPT_COOLDOWN_SEC,
  CoachMarkSpec,
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

// The teaching system (src/coach.ts): board-scripted LESSONS shown in
// authored order, each dismissed by the player performing the taught action —
// plus the global FIRST-ENCOUNTER catalog (the Transport Fever model), each
// hint triggered by its situation and remembered once per player. The
// controller is a pure state machine over per-tick facts, which is what makes
// all of this testable here without a browser.

function obs(partial: Partial<CoachObs> = {}): CoachObs {
  return {
    phase: "playing",
    tilesBuilt: 0,
    dispatches: 0,
    switchTouched: false,
    delivered: 0,
    heldByTrainIds: [],
    signalHeldTrainIds: [],
    taxPaid: 0,
    taxUnaffordable: false,
    ...partial,
  };
}

const SPECS: CoachMarkSpec[] = [
  {
    id: "a-build",
    text: "build",
    anchor: { kind: "tile", id: "0,0" },
    done: (o: CoachObs) => o.tilesBuilt >= 1,
  },
  {
    id: "b-dispatch",
    text: "dispatch",
    anchor: { kind: "tile", id: "1,0" },
    done: (o: CoachObs) => o.dispatches >= 1,
  },
];

describe("createCoach — lesson sequencing", () => {
  it("shows nothing outside the playing phase", () => {
    const coach = createCoach(SPECS);
    coach.step(obs({ phase: "ready" }), 0.1);
    expect(coach.active).toBeNull();
    coach.step(obs({ phase: "won", tilesBuilt: 0 }), 0.1);
    expect(coach.active).toBeNull();
  });

  it("shows the first mark, and advances to the next when its action happens", () => {
    const coach = createCoach(SPECS);
    coach.step(obs(), 0.1);
    expect(coach.active?.id).toBe("a-build");
    expect(coach.active?.kind).toBe("lesson");
    // Doing something else does not dismiss it.
    coach.step(obs({ dispatches: 1 }), 0.1);
    expect(coach.active?.id).toBe("a-build");
    // Doing THE thing does — and the next mark takes over in the same step.
    coach.step(obs({ tilesBuilt: 1, dispatches: 0 }), 0.1);
    expect(coach.active?.id).toBe("b-dispatch");
  });

  it("never re-teaches a verb performed before its mark appeared", () => {
    const coach = createCoach(SPECS);
    coach.step(obs({ dispatches: 1 }), 0.1);
    expect(coach.active?.id).toBe("a-build");
    coach.step(obs({ tilesBuilt: 1, dispatches: 1 }), 0.1);
    expect(coach.active).toBeNull();
  });

  it("keeps completed marks completed across newRun (Retry never nags)", () => {
    const coach = createCoach(SPECS);
    coach.step(obs({ tilesBuilt: 1 }), 0.1);
    expect(coach.active?.id).toBe("b-dispatch");
    coach.newRun();
    coach.step(obs(), 0.1);
    expect(coach.active?.id).toBe("b-dispatch");
  });

  it("re-arms a tier:'run' mark on newRun", () => {
    const coach = createCoach([
      { ...SPECS[0], tier: "run" },
    ]);
    coach.step(obs({ tilesBuilt: 1 }), 0.1);
    expect(coach.active).toBeNull();
    coach.newRun();
    coach.step(obs(), 0.1);
    expect(coach.active?.id).toBe("a-build");
  });

  it("reports empty for a board with no hints", () => {
    expect(createCoach([]).empty).toBe(true);
    expect(createCoach(SPECS).empty).toBe(false);
    expect(createCoach([], COACH_CONCEPTS).empty).toBe(false);
  });
});

describe("createCoach — first-encounter hints", () => {
  const HINT: CoachMarkSpec = {
    id: "h-held",
    text: "held",
    anchorOf: o =>
      o.heldByTrainIds.length
        ? { kind: "train", id: o.heldByTrainIds[0] }
        : null,
    tier: "player",
    trigger: o => o.heldByTrainIds.length > 0,
    done: o => o.heldByTrainIds.length === 0,
    dwellSec: 10,
  };
  const INFO: CoachMarkSpec = {
    id: "h-levy",
    text: "levy",
    anchor: { kind: "hud", slot: "calendar" },
    tier: "player",
    trigger: o => o.taxPaid > 0,
    dwellSec: 8,
  };

  it("shows only while its situation holds, anchored to the thing", () => {
    const coach = createCoach([], [HINT]);
    coach.step(obs(), 0.1);
    expect(coach.active).toBeNull();
    coach.step(obs({ heldByTrainIds: ["red"] }), 0.1);
    expect(coach.active?.id).toBe("h-held");
    expect(coach.active?.kind).toBe("concept");
    expect(coach.active?.anchor).toMatchObject({ kind: "train", id: "red" });
  });

  it("completes by its action (the situation resolving) and stays seen", () => {
    const seen = new Set<string>();
    const coach = createCoach([], [HINT], seen);
    coach.step(obs({ heldByTrainIds: ["red"] }), 0.1);
    expect(coach.active?.id).toBe("h-held");
    coach.step(obs(), 0.1);
    expect(coach.active).toBeNull();
    expect(seen.has("h-held")).toBe(true);
    // Another hold later teaches nothing — this player knows.
    coach.step(obs({ heldByTrainIds: ["blue"] }), CONCEPT_COOLDOWN_SEC + 1);
    expect(coach.active).toBeNull();
  });

  it("dwells out an info-only hint and counts it as seen", () => {
    const seen = new Set<string>();
    const coach = createCoach([], [INFO], seen);
    coach.step(obs({ taxPaid: 300 }), 0.1);
    expect(coach.active?.id).toBe("h-levy");
    coach.step(obs({ taxPaid: 300 }), 7);
    expect(coach.active?.id).toBe("h-levy");
    coach.step(obs({ taxPaid: 300 }), 2);
    expect(coach.active).toBeNull();
    expect(seen.has("h-levy")).toBe(true);
  });

  it("a situation that passes unshown keeps its turn for the next occurrence", () => {
    const seen = new Set<string>();
    const coach = createCoach(SPECS, [HINT], seen);
    // The lesson is up, and a hold comes and goes behind it.
    coach.step(obs({ heldByTrainIds: ["red"] }), 0.1);
    expect(coach.active?.id).toBe("a-build");
    coach.step(obs(), 0.1);
    // The hint was never shown, so it is NOT burned...
    expect(seen.has("h-held")).toBe(false);
    // ...and teaches at the next hold, once the lessons are out of the way.
    coach.step(obs({ tilesBuilt: 1, dispatches: 1 }), 0.1);
    coach.step(
      obs({ tilesBuilt: 1, dispatches: 1, heldByTrainIds: ["red"] }),
      CONCEPT_COOLDOWN_SEC + 1
    );
    expect(coach.active?.id).toBe("h-held");
  });

  it("waits the cooldown after any dismissal before the next hint", () => {
    const seen = new Set<string>();
    const coach = createCoach([], [HINT, INFO], seen);
    coach.step(obs({ heldByTrainIds: ["red"], taxPaid: 300 }), 0.1);
    expect(coach.active?.id).toBe("h-held");
    // The hold resolves — the hint completes, and the levy hint must WAIT.
    coach.step(obs({ taxPaid: 300 }), 0.1);
    expect(coach.active).toBeNull();
    coach.step(obs({ taxPaid: 300 }), CONCEPT_COOLDOWN_SEC / 2);
    expect(coach.active).toBeNull();
    coach.step(obs({ taxPaid: 300 }), CONCEPT_COOLDOWN_SEC);
    expect(coach.active?.id).toBe("h-levy");
  });

  it("lessons always outrank hints", () => {
    const coach = createCoach(SPECS, [INFO]);
    coach.step(obs({ taxPaid: 300 }), CONCEPT_COOLDOWN_SEC + 1);
    expect(coach.active?.id).toBe("a-build");
  });

  it("skips hints this player has already seen, from construction", () => {
    const seen = new Set<string>(["h-held"]);
    const coach = createCoach([], [HINT, INFO], seen);
    coach.step(obs({ heldByTrainIds: ["red"], taxPaid: 300 }), 0.1);
    expect(coach.active?.id).toBe("h-levy");
  });
});

describe("coachMarksFor — mode gating", () => {
  it("filters marks whose verb the mode has disabled", () => {
    expect(coachMarksFor("board:buildgap", tycoonMode.controls)).toHaveLength(2);
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
        const anchor = mark.anchor;
        expect(anchor, `${board}/${mark.id} lessons carry a static anchor`).toBeDefined();
        if (!anchor) continue;
        if (anchor.kind === "tile") {
          // A tile anchor may name an EMPTY cell (a build mark points at the
          // gap), so the check is "inside the world", not "has a tile".
          const { x, y } = parseCoordId(anchor.id);
          const dx = anchor.dx ?? 0;
          const dy = anchor.dy ?? 0;
          expect(x + dx, `${board}/${mark.id} x`).toBeGreaterThanOrEqual(0);
          expect(x + dx, `${board}/${mark.id} x`).toBeLessThan(cols);
          expect(y + dy, `${board}/${mark.id} y`).toBeGreaterThanOrEqual(0);
          expect(y + dy, `${board}/${mark.id} y`).toBeLessThan(rows);
        } else if (anchor.kind === "train") {
          const train = scenario.trains[anchor.id];
          expect(train, `${board}/${mark.id} train`).toBeDefined();
          expect(anchor.homeTile, `${board}/${mark.id} homeTile`).toBeDefined();
          const home = parseCoordId(anchor.homeTile!);
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

describe("COACH_CONCEPTS — catalog integrity", () => {
  it("every hint is player-tier, triggered, anchored and dismissable", () => {
    for (const s of COACH_CONCEPTS) {
      expect(s.tier, `${s.id} tier`).toBe("player");
      expect(s.trigger, `${s.id} trigger`).toBeDefined();
      expect(s.anchor ?? s.anchorOf, `${s.id} anchor`).toBeDefined();
      // Every hint can end: an action predicate, a dwell, or both — a hint
      // with neither would stand for ever.
      expect(s.done ?? s.dwellSec, `${s.id} dismissal`).toBeDefined();
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
    game.advance(0.1);
    expect(game.coach.active).toBeNull();

    game.startObjective();
    game.advance(0.1);
    expect(game.coach.active?.id).toBe("dispatch-train");
    expect(game.coach.active?.kind).toBe("lesson");
    expect(game.coach.active?.anchor).toMatchObject({ kind: "train", id: "t1" });

    expect(game.dispatch("t1")).toBe(true);
    game.advance(0.1);
    expect(game.coach.active?.id).toBe("set-switch");
    expect(game.coach.active?.anchor).toMatchObject({ kind: "tile", id: "2,1" });

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
