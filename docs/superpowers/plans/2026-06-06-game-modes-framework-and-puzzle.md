# GameMode framework + Puzzle/Dispatcher mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the half-built delivery counter into a real game by adding a pluggable `GameMode` framework whose first plug-in, Puzzle/Dispatcher, gives the existing board a genuine win / lose / 3-star loop — all on the unchanged headless sim.

**Architecture:** A new headless, deterministic `ObjectiveTracker` (`src/sim/objectives.ts`) consumes a per-tick `Observation` (delivery/mismatch/manual-control deltas + scaled `dt`) and runs a `ready → playing → won | lost` phase machine with pure star/lose predicates. A `src/modes/` layer defines the `GameMode` interface (board source · enabled controls · objective · optional spawner · HUD descriptor) and a `MODES` registry. `game.ts` holds the chosen mode, assembles the observation each frame, drives the tracker, exposes its state reactively, and gains a deterministic `reset()`. `PlayView.vue` projects the tracker state into start/end overlays + a timer + star pips, and selects the mode from a `?mode=` query arg. The sim (`simulation.ts`, `road.ts`) is **not** touched.

**Tech Stack:** Vue 3.5 + TypeScript 5, vue-facing-decorator class components, Vitest, Playwright. Deterministic sim driven by scaled `dt` (no `Date.now()` in headless code).

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/sim/objectives.ts` | Shared headless objective tracker: phase machine, counters, win/lose/star predicates | Create |
| `src/modes/types.ts` | `GameMode`, `ModeControls`, `HudDescriptor`, `ModeContext`, `ModeSetup`, `Spawner` interfaces | Create |
| `src/modes/puzzle.ts` | Puzzle/Dispatcher mode (objective preset, controls, hud, setup) | Create |
| `src/modes/sandbox.ts` | Sandbox/Creative mode (free play, no objective) — proves the registry with a 2nd mode | Create |
| `src/modes/index.ts` | `MODES` registry + `modeById` helper | Create |
| `src/objectiveStore.ts` | localStorage best-stars/best-time per `levelId` | Create |
| `src/game.ts` | Hold a mode, assemble `Observation`, drive tracker, expose reactive `objective`, count manual controls, `reset()` | Modify |
| `src/views/PlayView.vue` | Pick mode from query arg, render start/end overlays + timer + star pips + Retry | Modify |
| `src/levels/test/scenarios/objectives.ts` | `/test` scenario: tiny board that can be won (and lost on a timer) | Create |
| `src/levels/test/index.ts` | Register the `objectives` scenario | Modify |
| `tests/unit/sim/objectives.spec.ts` | Tracker: win, lose-on-timeout, each star at its boundary, reset | Create |
| `tests/unit/modes/puzzle.spec.ts` | Puzzle wires the right preset (controls/spec/hud); setup solvable | Create |
| `tests/e2e/play.spec.ts` | Smoke: default board runs to a Won overlay (extend existing e2e) | Modify |

---

## Task 1: ObjectiveTracker core types + win on deliveries

**Files:**
- Create: `src/sim/objectives.ts`
- Test: `tests/unit/sim/objectives.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sim/objectives.spec.ts
import { describe, it, expect } from "vitest";
import {
  createObjectiveTracker,
  emptyObservation,
  ObjectiveSpec,
} from "@/sim/objectives";

const baseSpec: ObjectiveSpec = { deliveriesRequired: 2 };

describe("objective tracker — phase + win", () => {
  it("starts Ready and does not accrue until started", () => {
    const t = createObjectiveTracker(baseSpec);
    expect(t.state().phase).toBe("ready");
    t.observe({ ...emptyObservation, deliveredDelta: 5 }, 1);
    expect(t.state().counters.delivered).toBe(0);
    expect(t.state().phase).toBe("ready");
  });

  it("accrues deliveries and time once Playing", () => {
    const t = createObjectiveTracker(baseSpec);
    t.start();
    expect(t.state().phase).toBe("playing");
    t.observe({ ...emptyObservation, deliveredDelta: 1 }, 1.5);
    expect(t.state().counters.delivered).toBe(1);
    expect(t.state().counters.elapsedSec).toBeCloseTo(1.5);
    expect(t.state().phase).toBe("playing");
  });

  it("wins when deliveries reach the requirement", () => {
    const t = createObjectiveTracker(baseSpec);
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 2 }, 1);
    expect(t.state().phase).toBe("won");
  });

  it("freezes counters after winning", () => {
    const t = createObjectiveTracker(baseSpec);
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 2 }, 1);
    t.observe({ ...emptyObservation, deliveredDelta: 1 }, 1);
    expect(t.state().counters.delivered).toBe(2);
    expect(t.state().counters.elapsedSec).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- objectives`
Expected: FAIL — `Cannot find module '@/sim/objectives'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/sim/objectives.ts

// The game-phase state machine that drives start/end overlays.
export type GamePhase = "ready" | "playing" | "won" | "lost";

// The running tallies every star/lose predicate reads. Pure data.
export interface Counters {
  delivered: number;
  mismatchedArrivals: number;
  elapsedSec: number;
  manualHolds: number;
  manualGreens: number;
}

// A pure predicate over the counters; e.g. "no signal was ever overridden".
export interface StarSpec {
  id: string;
  label: string;
  predicate: (c: Counters) => boolean;
}

// The objective attached to a board. All fail conditions are opt-in so a spec
// of just { deliveriesRequired } reproduces today's "deliver them all, can't
// lose" behaviour.
export interface ObjectiveSpec {
  deliveriesRequired: number;
  timeLimitSec?: number;
  fail?: {
    onTimeout?: boolean;
  };
  stars?: StarSpec[];
}

// One tick of observed change, assembled by game.ts from the sim event stream
// and the manual-control counters. Deltas, not absolutes, so observe() is purely
// additive.
export interface Observation {
  deliveredDelta: number; // matched arrivals this tick
  mismatchedDelta: number; // unmatched (bounced) arrivals this tick
  manualHoldDelta: number; // manual signal holds activated this tick
  manualGreenDelta: number; // forced-green overrides activated this tick
}

export const emptyObservation: Observation = {
  deliveredDelta: 0,
  mismatchedDelta: 0,
  manualHoldDelta: 0,
  manualGreenDelta: 0,
};

// One star's display state, projected for the HUD.
export interface StarState {
  id: string;
  label: string;
  earned: boolean;
}

export interface ObjectiveState {
  phase: GamePhase;
  counters: Counters;
  timeLeftSec?: number;
  stars: StarState[];
  lostReason?: string;
}

export interface ObjectiveTracker {
  start(): void;
  observe(obs: Observation, dt: number): void;
  state(): ObjectiveState;
  reset(): void;
}

function zeroCounters(): Counters {
  return {
    delivered: 0,
    mismatchedArrivals: 0,
    elapsedSec: 0,
    manualHolds: 0,
    manualGreens: 0,
  };
}

export function createObjectiveTracker(spec: ObjectiveSpec): ObjectiveTracker {
  let phase: GamePhase = "ready";
  let counters = zeroCounters();
  let lostReason: string | undefined;

  function stars(): StarState[] {
    return (spec.stars ?? []).map(s => ({
      id: s.id,
      label: s.label,
      earned: s.predicate(counters),
    }));
  }

  return {
    start() {
      phase = "playing";
      counters = zeroCounters();
      lostReason = undefined;
    },
    observe(obs, dt) {
      if (phase !== "playing") return;
      counters.delivered += obs.deliveredDelta;
      counters.mismatchedArrivals += obs.mismatchedDelta;
      counters.manualHolds += obs.manualHoldDelta;
      counters.manualGreens += obs.manualGreenDelta;
      counters.elapsedSec += dt;

      if (counters.delivered >= spec.deliveriesRequired) {
        phase = "won";
        return;
      }
      if (
        spec.fail?.onTimeout &&
        spec.timeLimitSec !== undefined &&
        counters.elapsedSec >= spec.timeLimitSec
      ) {
        phase = "lost";
        lostReason = "Time ran out";
      }
    },
    state() {
      const timeLeftSec =
        spec.timeLimitSec !== undefined
          ? Math.max(0, spec.timeLimitSec - counters.elapsedSec)
          : undefined;
      return {
        phase,
        counters: { ...counters },
        timeLeftSec,
        stars: stars(),
        lostReason,
      };
    },
    reset() {
      phase = "ready";
      counters = zeroCounters();
      lostReason = undefined;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- objectives`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/objectives.ts tests/unit/sim/objectives.spec.ts
git commit -m "feat(objectives): headless tracker with phase machine + win on deliveries"
```

---

## Task 2: Lose-on-timeout, stars, and reset

**Files:**
- Modify: `tests/unit/sim/objectives.spec.ts`
- (implementation already complete in Task 1 — these tests lock the behaviour in)

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/sim/objectives.spec.ts`:

```ts
import type { Counters } from "@/sim/objectives";

describe("objective tracker — lose, stars, reset", () => {
  it("loses on timeout when onTimeout is set", () => {
    const t = createObjectiveTracker({
      deliveriesRequired: 5,
      timeLimitSec: 10,
      fail: { onTimeout: true },
    });
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 1 }, 9);
    expect(t.state().phase).toBe("playing");
    t.observe(emptyObservation, 2);
    expect(t.state().phase).toBe("lost");
    expect(t.state().lostReason).toBe("Time ran out");
  });

  it("does not time out without onTimeout (untimed default stays calm)", () => {
    const t = createObjectiveTracker({ deliveriesRequired: 5, timeLimitSec: 1 });
    t.start();
    t.observe(emptyObservation, 100);
    expect(t.state().phase).toBe("playing");
  });

  it("win takes priority over a same-tick timeout", () => {
    const t = createObjectiveTracker({
      deliveriesRequired: 2,
      timeLimitSec: 1,
      fail: { onTimeout: true },
    });
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 2 }, 5);
    expect(t.state().phase).toBe("won");
  });

  it("evaluates star predicates live over counters", () => {
    const handsOff = {
      id: "hands-off",
      label: "Hands off",
      predicate: (c: Counters) => c.manualHolds + c.manualGreens === 0,
    };
    const t = createObjectiveTracker({ deliveriesRequired: 1, stars: [handsOff] });
    t.start();
    expect(t.state().stars[0].earned).toBe(true);
    t.observe({ ...emptyObservation, manualHoldDelta: 1 }, 1);
    expect(t.state().stars[0].earned).toBe(false);
  });

  it("reset() returns to Ready and clears counters", () => {
    const t = createObjectiveTracker({ deliveriesRequired: 1 });
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 1 }, 3);
    expect(t.state().phase).toBe("won");
    t.reset();
    expect(t.state().phase).toBe("ready");
    expect(t.state().counters.delivered).toBe(0);
    expect(t.state().counters.elapsedSec).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test:unit -- objectives`
Expected: PASS (all tests; Task 1's implementation already covers these). If any fail, fix `src/sim/objectives.ts` to match.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/sim/objectives.spec.ts
git commit -m "test(objectives): lock in lose-on-timeout, live stars, reset"
```

---

## Task 3: GameMode framework types

**Files:**
- Create: `src/modes/types.ts`

- [ ] **Step 1: Write the types**

```ts
// src/modes/types.ts
import { Level } from "@/tiles/model";
import { TrainDef } from "@/game";
import { ColorAssignment } from "@/utils/colorAssignment";
import {
  ObjectiveSpec,
  ObjectiveTracker,
  Observation,
  createObjectiveTracker,
} from "@/sim/objectives";

// Which existing player controls a mode enables. The sim already implements all
// of these; a mode only gates whether the view exposes them.
export interface ModeControls {
  switches: boolean; // flip junction switches
  signalHolds: boolean; // hold/release + force-green signals
  crossingGate: boolean; // manual level-crossing gate (Crossing Keeper, later)
  build: boolean; // edit the board (Sandbox)
}

// Which readouts/overlays the HUD shows for this mode. A pure view hint.
export interface HudDescriptor {
  deliveries: boolean; // "N/M delivered" card
  timer: boolean; // elapsed (or remaining) time
  stars: boolean; // star pips
  startOverlay: boolean; // Ready screen with a Start button
  endOverlay: boolean; // Won/Lost screen with Retry
}

// What a mode hands back from setup(): the board, trains, optional pinned colours,
// and the objective spec the tracker will run.
export interface ModeSetup {
  levelId: string;
  level: Level;
  trains: TrainDef[];
  colors?: ColorAssignment;
  objective: ObjectiveSpec;
}

// Inputs available to setup(): the board the view currently has (default board,
// editor handoff, or a procgen seed). Modes may ignore these and supply their own.
export interface ModeContext {
  level: Level;
  trains: TrainDef[];
  levelId: string;
}

// Optional per-tick source of new trains/demand (Time Attack / Endless). Puzzle
// and Sandbox return none. Headless + deterministic, driven by scaled dt.
export interface Spawner {
  step(dt: number): void;
}

export interface GameMode {
  id: string;
  label: string;
  description: string;
  setup(ctx: ModeContext): ModeSetup;
  controls: ModeControls;
  createObjective(setup: ModeSetup): ObjectiveTracker;
  createSpawner?(setup: ModeSetup): Spawner;
  hud: HudDescriptor;
}

// The default createObjective for any mode that just runs the tracker over its
// spec (Puzzle, and most future modes).
export function objectiveFromSpec(setup: ModeSetup): ObjectiveTracker {
  return createObjectiveTracker(setup.objective);
}

// Re-export the per-tick observation shape so modes/game.ts share one definition.
export type { Observation };
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: PASS (no new type errors; the file is only imported once it's wired, but `vue-tsc` checks it).

- [ ] **Step 3: Commit**

```bash
git add src/modes/types.ts
git commit -m "feat(modes): GameMode framework interfaces"
```

---

## Task 4: Puzzle/Dispatcher mode

**Files:**
- Create: `src/modes/puzzle.ts`
- Test: `tests/unit/modes/puzzle.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/modes/puzzle.spec.ts
import { describe, it, expect } from "vitest";
import { puzzleMode } from "@/modes/puzzle";
import { straight } from "@/levels/test/scenarios/straight";

function ctx() {
  const trains = Object.values(straight.trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
  }));
  return { level: straight.level, trains, levelId: "straight" };
}

describe("puzzle mode", () => {
  it("enables only dispatch controls", () => {
    expect(puzzleMode.controls).toEqual({
      switches: true,
      signalHolds: true,
      crossingGate: false,
      build: false,
    });
  });

  it("requires delivering every train and never spawns", () => {
    const setup = puzzleMode.setup(ctx());
    expect(setup.objective.deliveriesRequired).toBe(setup.trains.length);
    expect(puzzleMode.createSpawner).toBeUndefined();
  });

  it("offers three stars: speedrun, hands-off, perfect colours", () => {
    const setup = puzzleMode.setup(ctx());
    const ids = (setup.objective.stars ?? []).map(s => s.id).sort();
    expect(ids).toEqual(["hands-off", "perfect-colours", "speedrun"]);
  });

  it("perfect-colours star is lost once a bounce is recorded", () => {
    const setup = puzzleMode.setup(ctx());
    const star = (setup.objective.stars ?? []).find(
      s => s.id === "perfect-colours"
    )!;
    const base = {
      delivered: 1,
      mismatchedArrivals: 0,
      elapsedSec: 1,
      manualHolds: 0,
      manualGreens: 0,
    };
    expect(star.predicate(base)).toBe(true);
    expect(star.predicate({ ...base, mismatchedArrivals: 1 })).toBe(false);
  });

  it("hud shows the full objective UI", () => {
    expect(puzzleMode.hud).toEqual({
      deliveries: true,
      timer: true,
      stars: true,
      startOverlay: true,
      endOverlay: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- puzzle`
Expected: FAIL — `Cannot find module '@/modes/puzzle'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/modes/puzzle.ts
import { GameMode, ModeContext, ModeSetup, objectiveFromSpec } from "@/modes/types";
import { Counters, StarSpec } from "@/sim/objectives";

// A star time scaled to the board: a generous baseline so small boards stay
// achievable. Tuned per-board later; for now ~8s per train to deliver.
function starTimeFor(trainCount: number): number {
  return Math.max(20, trainCount * 8);
}

function puzzleStars(trainCount: number): StarSpec[] {
  const starTime = starTimeFor(trainCount);
  return [
    {
      id: "speedrun",
      label: "Speedrun",
      predicate: (c: Counters) => c.elapsedSec <= starTime,
    },
    {
      id: "hands-off",
      label: "Hands off",
      predicate: (c: Counters) => c.manualHolds + c.manualGreens === 0,
    },
    {
      id: "perfect-colours",
      label: "Perfect colours",
      predicate: (c: Counters) => c.mismatchedArrivals === 0,
    },
  ];
}

export const puzzleMode: GameMode = {
  id: "puzzle",
  label: "Puzzle / Dispatcher",
  description:
    "Route every train to its matching depot. Flip switches and hold signals " +
    "to bring them all home — fast, hands-off, no bounces.",
  setup(ctx: ModeContext): ModeSetup {
    const trainCount = ctx.trains.length;
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: {
        deliveriesRequired: trainCount,
        stars: puzzleStars(trainCount),
      },
    };
  },
  controls: {
    switches: true,
    signalHolds: true,
    crossingGate: false,
    build: false,
  },
  createObjective: objectiveFromSpec,
  hud: {
    deliveries: true,
    timer: true,
    stars: true,
    startOverlay: true,
    endOverlay: true,
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- puzzle`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modes/puzzle.ts tests/unit/modes/puzzle.spec.ts
git commit -m "feat(modes): Puzzle/Dispatcher mode (deliver-all + 3 stars)"
```

---

## Task 5: Sandbox mode + registry

**Files:**
- Create: `src/modes/sandbox.ts`
- Create: `src/modes/index.ts`

- [ ] **Step 1: Write the Sandbox mode**

```ts
// src/modes/sandbox.ts
import { GameMode, ModeContext, ModeSetup } from "@/modes/types";
import { createObjectiveTracker, ObjectiveTracker } from "@/sim/objectives";

// Sandbox / Creative: free play. The objective never completes (an impossibly
// high requirement) so the phase stays Playing and there is no win/lose — the
// player just runs the board. Build is enabled for a future editor-as-mode.
export const sandboxMode: GameMode = {
  id: "sandbox",
  label: "Sandbox",
  description: "Free play. No goal, no clock — just run the railway.",
  setup(ctx: ModeContext): ModeSetup {
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: { deliveriesRequired: Number.POSITIVE_INFINITY },
    };
  },
  controls: {
    switches: true,
    signalHolds: true,
    crossingGate: false,
    build: true,
  },
  createObjective(setup): ObjectiveTracker {
    return createObjectiveTracker(setup.objective);
  },
  hud: {
    deliveries: true,
    timer: false,
    stars: false,
    startOverlay: false,
    endOverlay: false,
  },
};
```

- [ ] **Step 2: Write the registry**

```ts
// src/modes/index.ts
import { GameMode } from "@/modes/types";
import { puzzleMode } from "@/modes/puzzle";
import { sandboxMode } from "@/modes/sandbox";

// The mode menu. Add a mode by dropping a file in `modes/` and appending it
// here (mirrors the /test SCENARIOS registry). Order is the picker order.
export const MODES: GameMode[] = [puzzleMode, sandboxMode];

export const DEFAULT_MODE_ID = puzzleMode.id;

export function modeById(id: string | undefined | null): GameMode {
  return MODES.find(m => m.id === id) ?? MODES[0];
}

export type { GameMode } from "@/modes/types";
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modes/sandbox.ts src/modes/index.ts
git commit -m "feat(modes): Sandbox mode + MODES registry"
```

---

## Task 6: Wire the mode + tracker into game.ts

**Files:**
- Modify: `src/game.ts`

The game gains: a `mode`, a tracker, an `Observation` assembled each tick, manual-control counters, a reactive `objective` state, a `startObjective()`/`reset()` pair, and exposure of `mode` + `objective` on the `Game` interface.

- [ ] **Step 1: Add imports**

In `src/game.ts`, after the existing imports (around line 16), add:

```ts
import { GameMode } from "@/modes/types";
import { ObjectiveState, Observation } from "@/sim/objectives";
```

- [ ] **Step 2: Extend the `Game` interface**

In the `export interface Game { … }` block, after `deliveries: Ref<number>;` add:

```ts
  mode: GameMode;
  // Reactive snapshot of the objective tracker, refreshed each frame.
  objective: ObjectiveState;
  // Move Ready -> Playing (the Start button). Re-arms the loop deterministically.
  startObjective(): void;
  // Win/Lose -> Ready with the same seed, for Retry (true do-over).
  reset(): void;
```

- [ ] **Step 3: Accept a mode parameter**

Change the `createGame` signature to take the mode. Replace:

```ts
export function createGame(
  level: Level,
  trainDefs: TrainDef[],
  tileSize: number,
  colorSeed = 1,
  colors?: ColorAssignment
): Game {
```

with:

```ts
export function createGame(
  level: Level,
  trainDefs: TrainDef[],
  tileSize: number,
  mode: GameMode,
  colorSeed = 1,
  colors?: ColorAssignment,
  levelId = "default"
): Game {
```

- [ ] **Step 4: Build the tracker + manual-control counters**

Immediately before the `const paused = ref(false);` line (around line 375), add:

```ts
  // The objective tracker for the active mode, driven by the per-tick observation.
  const setup = mode.setup({ level, trains: trainDefs, levelId });
  const tracker = mode.createObjective(setup);
  const spawner = mode.createSpawner?.(setup);
  const objective = reactive(tracker.state()) as ObjectiveState;

  // Raw running totals of player signal overrides. The loop diffs these against
  // the last-observed totals to feed the tracker manual-control deltas. They are
  // incremented in the control handlers below (toggleHold/forceProceed/cycle).
  let manualHoldTotal = 0;
  let manualGreenTotal = 0;
  let lastHoldTotal = 0;
  let lastGreenTotal = 0;

  function refreshObjective() {
    Object.assign(objective, tracker.state());
  }
```

- [ ] **Step 5: Assemble the observation in `handleEvents` and drive the tracker in `frame`**

Replace the existing `handleEvents`:

```ts
  function handleEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === "arrived" && e.matched) deliveries.value += 1;
      eventLog.push(toLogEntry(e, logSeq++, clock));
    }
    if (eventLog.length > MAX_LOG) eventLog.splice(0, eventLog.length - MAX_LOG);
  }
```

with a version that also returns the per-tick observation:

```ts
  function handleEvents(events: SimEvent[]): Observation {
    let deliveredDelta = 0;
    let mismatchedDelta = 0;
    for (const e of events) {
      if (e.type === "arrived") {
        if (e.matched) deliveredDelta += 1;
        else mismatchedDelta += 1;
      }
      eventLog.push(toLogEntry(e, logSeq++, clock));
    }
    if (eventLog.length > MAX_LOG) eventLog.splice(0, eventLog.length - MAX_LOG);
    const manualHoldDelta = manualHoldTotal - lastHoldTotal;
    const manualGreenDelta = manualGreenTotal - lastGreenTotal;
    lastHoldTotal = manualHoldTotal;
    lastGreenTotal = manualGreenTotal;
    deliveries.value += deliveredDelta;
    return { deliveredDelta, mismatchedDelta, manualHoldDelta, manualGreenDelta };
  }
```

Then update the `frame` loop body. Replace:

```ts
    if (!paused.value) {
      const scaled = dt * speed.value;
      clock += scaled;
      handleEvents(sim.step(scaled));
      // A crossing is closed while a train reserves or sits on that tile.
      roadSim.step(scaled, id => !!(sim.reservedBy(id) || sim.occupiedBy(id)));
    }
```

with:

```ts
    if (!paused.value) {
      const scaled = dt * speed.value;
      clock += scaled;
      spawner?.step(scaled);
      const obs = handleEvents(sim.step(scaled));
      // A crossing is closed while a train reserves or sits on that tile.
      roadSim.step(scaled, id => !!(sim.reservedBy(id) || sim.occupiedBy(id)));
      tracker.observe(obs, scaled);
      refreshObjective();
    }
```

- [ ] **Step 6: Count manual overrides in the control handlers**

In the returned object's control methods, increment the totals when the player *activates* an override. Replace `toggleHold`:

```ts
    toggleHold(tileId: string, exitPort: Position) {
      sim.toggleHold(tileId, exitPort);
    },
```

with:

```ts
    toggleHold(tileId: string, exitPort: Position) {
      const wasHeld = sim.isHeld(tileId, exitPort);
      sim.toggleHold(tileId, exitPort);
      if (!wasHeld && sim.isHeld(tileId, exitPort)) manualHoldTotal += 1;
    },
```

Replace `forceProceed`:

```ts
    forceProceed(tileId: string, exitPort: Position) {
      sim.forceProceed(tileId, exitPort);
    },
```

with:

```ts
    forceProceed(tileId: string, exitPort: Position) {
      const wasForced = sim.isProceedForced(tileId, exitPort);
      sim.forceProceed(tileId, exitPort);
      if (!wasForced && sim.isProceedForced(tileId, exitPort))
        manualGreenTotal += 1;
    },
```

In `cycleSignal`, increment on the activating transitions. Replace:

```ts
      if (state === "auto") {
        sim.forceProceed(tileId, exitPort); // -> green
      } else if (state === "green") {
        // green -> red: clear the forced green, then apply the stop hold.
        sim.forceProceed(tileId, exitPort); // toggle off green
        sim.toggleHold(tileId, exitPort); // -> red
      } else {
        sim.toggleHold(tileId, exitPort); // red -> auto
      }
```

with:

```ts
      if (state === "auto") {
        sim.forceProceed(tileId, exitPort); // -> green
        manualGreenTotal += 1;
      } else if (state === "green") {
        // green -> red: clear the forced green, then apply the stop hold.
        sim.forceProceed(tileId, exitPort); // toggle off green
        sim.toggleHold(tileId, exitPort); // -> red
        manualHoldTotal += 1;
      } else {
        sim.toggleHold(tileId, exitPort); // red -> auto
      }
```

- [ ] **Step 7: Add `mode`, `objective`, `startObjective`, `reset` to the returned object**

In the `return { … }` object, after `deliveries,` add:

```ts
    mode,
    objective,
```

and after the `stop()` method add:

```ts
    startObjective() {
      tracker.start();
      refreshObjective();
    },
    reset() {
      sim.reset();
      deliveries.value = 0;
      manualHoldTotal = 0;
      manualGreenTotal = 0;
      lastHoldTotal = 0;
      lastGreenTotal = 0;
      clock = 0;
      eventLog.splice(0, eventLog.length);
      tracker.reset();
      refreshObjective();
    },
```

> **Note on `sim.reset()`:** if `Simulation` has no `reset()`, this step must instead rebuild the sim. Check first (Step 8). If absent, the minimal deterministic reset is to re-run `createSimulation(...)` and reassign — but `sim` is `const`. Simplest compatible approach: make `sim` a `let` and add a private `rebuild()` that recreates `sim` + `roadSim` from the same captured config, called by `reset()`. Use whichever the codebase already supports; prefer adding a `reset()` to the sim if other call sites would benefit. The acceptance criterion is: after `reset()` then `startObjective()`, trains are back in their depots and the colour assignment is identical.

- [ ] **Step 8: Verify the sim reset path**

Run: `npm run build`
Expected: if it fails with `Property 'reset' does not exist on type 'Simulation'`, implement the rebuild approach from the Step 7 note (convert `sim`/`roadSim` to `let`, extract their construction into a local `buildSims()` closure, call it initially and in `reset()`). Re-run until green.

- [ ] **Step 9: Run unit tests**

Run: `npm run test:unit`
Expected: PASS (no regressions; the new game wiring isn't unit-tested directly but must not break existing suites).

- [ ] **Step 10: Commit**

```bash
git add src/game.ts
git commit -m "feat(game): drive the objective tracker per tick + startObjective/reset"
```

---

## Task 7: localStorage best-stars/best-time store

**Files:**
- Create: `src/objectiveStore.ts`

- [ ] **Step 1: Write the store**

```ts
// src/objectiveStore.ts
// Per-level best result (most stars, then fastest time) persisted to
// localStorage. Pure helpers; safe when localStorage is unavailable (SSR/tests).

export interface BestResult {
  stars: number;
  timeSec: number;
}

const KEY_PREFIX = "train-game:best:";

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadBest(levelId: string): BestResult | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(KEY_PREFIX + levelId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BestResult;
    if (typeof parsed.stars === "number" && typeof parsed.timeSec === "number")
      return parsed;
    return null;
  } catch {
    return null;
  }
}

// Records a result if it beats the stored best (more stars, or same stars but
// faster). Returns the (possibly updated) best.
export function recordResult(
  levelId: string,
  result: BestResult
): BestResult {
  const prev = loadBest(levelId);
  const better =
    !prev ||
    result.stars > prev.stars ||
    (result.stars === prev.stars && result.timeSec < prev.timeSec);
  const best = better ? result : prev!;
  const s = storage();
  if (s && better) s.setItem(KEY_PREFIX + levelId, JSON.stringify(best));
  return best;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/objectiveStore.ts
git commit -m "feat(objectives): localStorage best-stars/best-time store"
```

---

## Task 8: PlayView — mode selection, timer, star pips, start/end overlays

**Files:**
- Modify: `src/views/PlayView.vue`

- [ ] **Step 1: Update the script imports + mode selection**

In the `<script>` block, extend the imports:

```ts
import { createGame, Game, TrainDef } from "@/game";
import { DEFAULT_LEVEL, defaultTrains } from "@/levels/default";
import { takeCustomLevel } from "@/levelStore";
import { modeById } from "@/modes/index";
import { loadBest, recordResult, BestResult } from "@/objectiveStore";
import Crossing from "@/components/Crossing.vue";
```

Add a helper above the class to read the mode from the URL hash query (the app uses hash history, so the query rides in the hash):

```ts
function modeIdFromUrl(): string | null {
  // Hash history puts the route in location.hash, e.g. "#/play?mode=puzzle".
  const hash = window.location.hash;
  const q = hash.indexOf("?");
  if (q === -1) return null;
  return new URLSearchParams(hash.slice(q + 1)).get("mode");
}
```

- [ ] **Step 2: Pass the mode into createGame**

Replace the `@Provide("game")` initialiser:

```ts
  @Provide("game") game: Game = markRaw(
    createGame(
      this.level,
      buildTrainDefs(this.trains),
      gameConfig.tileSize,
      gameConfig.colorSeed
    )
  );
```

with:

```ts
  private mode = modeById(modeIdFromUrl());
  private levelId = this.custom ? "custom" : "default";

  @Provide("game") game: Game = markRaw(
    createGame(
      this.level,
      buildTrainDefs(this.trains),
      gameConfig.tileSize,
      this.mode,
      gameConfig.colorSeed,
      undefined,
      this.levelId
    )
  );
```

- [ ] **Step 3: Start via the objective phase, persist on win**

Replace `mounted()`:

```ts
  mounted() {
    this.game.start();
    (window as unknown as { __game?: Game }).__game = this.game;
  }
```

with:

```ts
  best: BestResult | null = null;

  mounted() {
    this.best = loadBest(this.levelId);
    this.game.start(); // start the rAF loop (rendering); objective stays Ready
    if (!this.game.mode.hud.startOverlay) this.game.startObjective();
    (window as unknown as { __game?: Game }).__game = this.game;
  }

  startPlaying() {
    this.game.startObjective();
  }

  retry() {
    this.game.reset();
    this.game.startObjective();
  }

  @Watch("phase")
  onPhase(now: string) {
    if (now === "won") {
      const earned = this.game.objective.stars.filter(s => s.earned).length;
      this.best = recordResult(this.levelId, {
        stars: earned,
        timeSec: this.game.objective.counters.elapsedSec,
      });
    }
  }

  get phase(): string {
    return this.game.objective.phase;
  }
  get hud() {
    return this.game.mode.hud;
  }
  get stars() {
    return this.game.objective.stars;
  }
  get elapsedLabel(): string {
    const t = this.game.objective.timeLeftSec ?? this.game.objective.counters.elapsedSec;
    return t.toFixed(1) + "s";
  }
  get earnedStars(): number {
    return this.stars.filter(s => s.earned).length;
  }
  get lostReason(): string {
    return this.game.objective.lostReason ?? "";
  }
```

- [ ] **Step 4: Add HUD timer + star pips + overlays to the template**

In the template, inside `.score-card` (after the `.score-bar` div, before the `score-banner` transition), add the timer + stars:

```html
      <div v-if="hud.timer" class="score-timer">⏱ {{ elapsedLabel }}</div>
      <div v-if="hud.stars" class="score-stars">
        <span
          v-for="s in stars"
          :key="s.id"
          class="star-pip"
          :class="{ 'star-pip--on': s.earned }"
          :title="s.label"
          >★</span
        >
      </div>
```

After the closing `</div>` of `.level` (before the debug event-log block), add the start and end overlays:

```html
    <div
      v-if="hud.startOverlay && phase === 'ready'"
      class="game-overlay"
    >
      <div class="overlay-card">
        <h2 class="overlay-title">{{ game.mode.label }}</h2>
        <p class="overlay-desc">{{ game.mode.description }}</p>
        <p v-if="best" class="overlay-best">
          Best: {{ best.stars }}★ · {{ best.timeSec.toFixed(1) }}s
        </p>
        <button class="overlay-btn" @click="startPlaying">Start</button>
      </div>
    </div>
    <div
      v-if="hud.endOverlay && (phase === 'won' || phase === 'lost')"
      class="game-overlay"
    >
      <div class="overlay-card">
        <h2 class="overlay-title">{{ phase === "won" ? "You win!" : "Failed" }}</h2>
        <div v-if="phase === 'won' && hud.stars" class="overlay-stars">
          <span
            v-for="s in stars"
            :key="s.id"
            class="star-pip star-pip--lg"
            :class="{ 'star-pip--on': s.earned }"
            :title="s.label"
            >★</span
          >
        </div>
        <p v-if="phase === 'won'" class="overlay-desc">
          {{ earnedStars }}/{{ stars.length }} stars · {{ elapsedLabel }}
        </p>
        <p v-else class="overlay-desc">{{ lostReason }}</p>
        <button class="overlay-btn" @click="retry">Retry</button>
      </div>
    </div>
```

- [ ] **Step 5: Add overlay + star styles**

In the `<style>` block, append:

```scss
.score-timer {
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #cdd7df;
}
.score-stars {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}
.star-pip {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.18);
  transition: color 0.3s ease, text-shadow 0.3s ease;
  &--on {
    color: #f0cf72;
    text-shadow: 0 0 10px rgba(240, 207, 114, 0.6);
  }
  &--lg {
    font-size: 34px;
  }
}
.game-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 11, 15, 0.62);
  backdrop-filter: blur(4px);
}
.overlay-card {
  min-width: 320px;
  padding: 28px 34px;
  text-align: center;
  background: linear-gradient(160deg, rgba(28, 34, 42, 0.97), rgba(18, 22, 28, 0.97));
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  color: #eef2f6;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
}
.overlay-title {
  margin: 0 0 8px;
  font-size: 26px;
}
.overlay-desc {
  margin: 8px 0 18px;
  color: #9aa7b2;
  max-width: 360px;
}
.overlay-best {
  margin: 0 0 8px;
  color: #f0cf72;
  font-weight: 700;
}
.overlay-stars {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 8px 0;
}
.overlay-btn {
  padding: 12px 28px;
  font-size: 16px;
  font-weight: 700;
  color: #0d1117;
  background: linear-gradient(90deg, #5fd39a, #2f9e6b);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  &:hover {
    filter: brightness(1.08);
  }
}
```

- [ ] **Step 6: Type-check + run**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Manual smoke (optional but recommended)**

Run: `npm run dev`, open `http://localhost:5173/#/play`. Expect a Start overlay; click Start; deliver trains; expect timer counting, star pips, and a "You win!" overlay with stars + Retry. Open `#/play?mode=sandbox`; expect no overlays/timer (free play). Stop the dev server when done.

- [ ] **Step 8: Commit**

```bash
git add src/views/PlayView.vue
git commit -m "feat(play): mode-driven start/end overlays, timer, star pips, bests"
```

---

## Task 9: /test `objectives` scenario

**Files:**
- Create: `src/levels/test/scenarios/objectives.ts`
- Modify: `src/levels/test/index.ts`

- [ ] **Step 1: Write the scenario**

Model it on the simplest existing scenario (`straight`). Read `src/levels/test/scenarios/straight.ts` first to copy its exact grid/route helper usage, then:

```ts
// src/levels/test/scenarios/objectives.ts
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { expandKind } from "@/tiles/kinds";
import { Rotations } from "@/types";

// A two-tile lane: a depot, a straight, a depot. One train drives across and
// parks at the matching depot — a board that can be *won*. With a tight time
// limit + onTimeout (set via the puzzle objective's timeLimit on a real board),
// it can also be lost; here we keep it winnable and let the tracker tests cover
// the lose path. Demonstrates the objective loop in isolation.
export const objectives: TestScenario = {
  id: "objectives",
  name: "Objectives",
  description: "A winnable lane: deliver the train to its matching depot.",
  level: {
    "0,0": expandKind("depot", Rotations.Right),
    "1,0": expandKind("straight", Rotations.Right),
    "2,0": expandKind("depot", Rotations.Left),
  },
  trains: {
    t1: mkTrain("t1", 0, 0, "people", 1, "2,0"),
  },
};
```

> **Note:** the exact `expandKind`/`Rotations` call shape must match `straight.ts`. If `straight.ts` uses different depot rotation conventions or a `scenarioRoutes` helper, mirror it exactly. The acceptance criterion is that `testScenarios.spec.ts` validates this scenario (connectivity, route reachability, train-in-depot, grid fit).

- [ ] **Step 2: Register it**

In `src/levels/test/index.ts`, add the import after the `carqueue` import:

```ts
import { objectives } from "@/levels/test/scenarios/objectives";
```

and append `objectives` to the `SCENARIOS` array (after `carqueue`).

- [ ] **Step 3: Run the scenario validation test**

Run: `npm run test:unit -- testScenarios`
Expected: PASS — the registry-driven validator accepts the new scenario.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/levels/test/scenarios/objectives.ts src/levels/test/index.ts
git commit -m "test(world): objectives scenario (winnable lane)"
```

---

## Task 10: e2e smoke — runs to a Won overlay

**Files:**
- Modify: `tests/e2e/play.spec.ts` (or the existing e2e spec — locate it first)

- [ ] **Step 1: Locate the existing e2e spec**

Run: `npx --no-install glob "tests/e2e/**/*.spec.ts"` (or inspect `tests/e2e/`). Read the existing spec to reuse its `window.__game` access pattern and base URL.

- [ ] **Step 2: Add a win-overlay assertion**

Append a test that drives the game to a win using the `__game` hook (fast speed + waiting), then asserts the overlay. Adapt selectors to the project's existing e2e style:

```ts
test("puzzle mode shows a win overlay when all trains are delivered", async ({
  page,
}) => {
  await page.goto("/#/play");
  // Dismiss the start overlay.
  await page.getByRole("button", { name: "Start" }).click();
  // Force a fast finish: max speed, then poll the headless objective phase.
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.speed.value = 4;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__game.objective.phase), {
      timeout: 30000,
    })
    .toBe("won");
  await expect(page.getByText("You win!")).toBeVisible();
});
```

> **Note:** if the default board can't be won purely by waiting (a train needs a switch flipped), either pick a board/scenario that auto-solves, or flip the needed switch via `__game` before polling. The acceptance criterion is a deterministic path to `phase === "won"` and the overlay visible. Keep the timeout generous.

- [ ] **Step 3: Run e2e**

Run: `npm run test:e2e` (requires `npx playwright install chromium` once).
Expected: PASS, including the new test.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/play.spec.ts
git commit -m "test(e2e): puzzle win overlay smoke"
```

---

## Final verification

- [ ] `npm run build` — green
- [ ] `npm run test:unit` — green
- [ ] `npm run test:e2e` — green
- [ ] Manual: `#/play` (puzzle) shows start→win loop; `#/play?mode=sandbox` is free play

---

## Post-base fan-out (separate plans, parallelisable to subagents)

Once the base above is merged, these modes plug into the same framework with **no further base changes** and can be built independently (one subagent each), per the spec §7:

- **Crossing Keeper** — needs the crossing-scoring sim work from `2026-06-06-stakes-and-crossing-scoring-design.md` (§6: `waitedSec`/`RoadFrame`/`crossingIncident`). Add `Observation` fields (`maxCarWaitSec`, etc.), a `crossing-keeper.ts` mode, a `/test` scenario. *Recommended first fan-out.*
- **Time Attack / Rush** — implement `createSpawner` (inject trains on a rising cadence) + depot backlog; fail on overflow. Exercises the `Spawner` slot the base already wires.
- **Sandbox depth** — wire `controls.build` to the editor-in-play.
- **Daily / Score Challenge** — `setup` from a date→seed via `generate.ts`, wrapping a scored mode.

Each is its own spec→plan→implementation cycle; the base task above is the shared foundation they all depend on, so it must land first (not parallelisable).

---

## Self-review notes

- **Spec coverage:** §2 GameMode interface → Task 3; §3 shared tracker → Tasks 1–2; §4 Puzzle concrete → Task 4; §5 phasing (win loop, lose+overlays+retry, stars+localStorage, mode-select scaffold) → Tasks 1–2 (win/lose), 6–8 (overlays/retry/select), 4+8 (stars), 7 (bests); §6 testing → Tasks 1–2, 4, 9, 10; §7 roadmap → "Post-base fan-out". Sandbox (§7 first bullet, "register alongside Puzzle in step 4") → Task 5.
- **Mode-select surfacing (open Q1):** resolved as the query-arg approach (`?mode=`) the spec leaned toward; a dedicated screen is deferred until ≥3 modes.
- **Type consistency:** `Observation` deltas (`deliveredDelta`/`mismatchedDelta`/`manualHoldDelta`/`manualGreenDelta`) are used identically in Tasks 1, 4, 6. `Counters` fields match across tracker, puzzle stars, and PlayView. `ObjectiveState`/`GamePhase` consumed in game.ts (Task 6) and PlayView (Task 8) match Task 1.
- **Risk flagged inline:** the `sim.reset()` path (Task 6 Steps 7–8) — the plan tells the engineer to verify the sim's reset capability and gives the rebuild fallback if `Simulation.reset()` doesn't exist.
