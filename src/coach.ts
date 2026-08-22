import { ModeControls } from "@/modes/types";
import { boardIdOf } from "@/modes/tycoon";
import { CoachSeen } from "@/coachStore";

// Coach-marks — the teaching system (design doc §8 item 8, campaign doc A4.3;
// the two-tier concept: docs/superpowers/specs/2026-08-22-teaching-depth-design.md).
//
// Train Valley pins a short hint to the THING it is talking about — "Zug
// wartet. Per Klick losschicken." floats over the waiting train, "Vollende das
// Schienennetz…" over the gap in the rails. That anchoring is the whole idea:
// a hint in a corner is a manual, a hint on the object is a lesson. So a mark
// here is world chrome (a bubble positioned in board pixels, like a fare pin),
// never a modal.
//
// TWO TIERS, ONE ENGINE:
//
//  - LESSONS (tier 1): the level is the curriculum. Authored per board
//    (COACH_BY_BOARD), shown one at a time in authored order, each dismissed
//    by the player performing the action it teaches. Remembered for the
//    SESSION across Retry — a lesson belongs to its level, so a reload
//    re-teaches, deliberately.
//  - FIRST-ENCOUNTER HINTS (tier 2, the Transport Fever model): a global
//    catalog (COACH_CONCEPTS), each triggered by a SITUATION the first time it
//    confronts the player — a train held by another train's reservation, the
//    first annual levy. Once completed they are remembered PER PLAYER
//    (localStorage via coachStore), and never shown again.
//
// The rules that keep the teacher quiet (concept doc §2):
//  - ONE bubble on screen, ever. The active lesson always outranks hints.
//  - After any bubble is dismissed, the next HINT waits a cooldown — two
//    firsts in one moment must not stack into a lecture.
//  - A mark is dismissed by DOING THE THING where an action exists; hints
//    that are pure information fade after a dwell and count as seen. Never a
//    close button.
//  - A hint shows only while its situation actually holds (`trigger`), so it
//    can never point at a problem that has already resolved itself; a
//    situation that passes unshown simply teaches at its next occurrence.
//
// Headless on purpose, like the rest of the model layer: the controller is a
// pure state machine over an observation the game assembles each tick, so the
// whole sequencing logic is unit-testable without a browser.

// Where a mark points. World-anchored (a tile or a train) or — for the
// board-wide facts that live in chrome, like the annual levy — a named HUD
// slot the views tag with `data-coach-slot`.
export type CoachAnchor =
  | {
      kind: "tile";
      id: string;
      // Offset in TILE units from the tile's centre, for aiming between two
      // tiles (a two-tile gap has no middle tile to name).
      dx?: number;
      dy?: number;
    }
  | {
      kind: "train";
      id: string;
      // Where the train starts, for boards whose mode draws no fare pins (a
      // puzzle board has no fares, so there is no badge to ride). Optional:
      // dynamically-anchored hints fall back to the live sim position instead.
      homeTile?: string;
    }
  | { kind: "hud"; slot: "calendar" };

// The cumulative-or-current run facts a predicate may read. The cumulative
// ones (tilesBuilt, dispatches, switchTouched, delivered) are monotone within
// a run, which is what lets a LESSON complete correctly even when its action
// happened before it was shown. The situational ones (held/signal-held
// trains, the tax flags) describe THIS tick, for tier-2 triggers.
export interface CoachObs {
  phase: string;
  // Track pieces bought in play this run (the build verb).
  tilesBuilt: number;
  // Successful dispatch() calls this run (the send verb).
  dispatches: number;
  // Whether any junction arm has been changed this run (the switch verb).
  switchTouched: boolean;
  // Matched deliveries this run (for watch-and-learn marks).
  delivered: number;
  // Trains currently blocked by ANOTHER train (BlockReason "reservation" /
  // "occupancy" with a culprit) — the path-reservation moment that,
  // unexplained, reads as a broken game.
  heldByTrainIds: string[];
  // Trains currently held at the player's OWN signal ("signal-hold").
  signalHeldTrainIds: string[];
  // Lifetime annual levies booked this run, in money (0 until the first year
  // turns on a calendar board).
  taxPaid: number;
  // The bankruptcy warning: next year's levy exceeds the balance.
  taxUnaffordable: boolean;
}

export type CoachTier = "run" | "session" | "player";

export interface CoachMarkSpec {
  id: string;
  text: string;
  // A static anchor (lessons know their board), or...
  anchor?: CoachAnchor;
  // ...a dynamic one, resolved from the observation every step while the mark
  // shows — a first-encounter hint points at whichever train is held NOW.
  anchorOf?(obs: CoachObs): CoachAnchor | null;
  // The control this mark's verb lives behind. A mark that teaches a verb the
  // mode has disabled (build on a puzzle board) could never be dismissed, so
  // it is filtered out up front rather than shown as a dead end.
  needs?: keyof ModeControls;
  // Where completion is remembered. "session" (default): the createCoach
  // instance's lifetime, surviving Retry — the lesson behaviour. "player":
  // the localStorage seen-store — the TF behaviour. "run": cleared by
  // newRun(), for a mark that should re-teach on every attempt.
  tier?: CoachTier;
  // Tier-2 eligibility: the hint may show only while this holds. Absent (the
  // lessons) → always eligible.
  trigger?(obs: CoachObs): boolean;
  // Action-dismissal. For LESSONS this is evaluated cumulatively (a verb
  // performed early auto-completes its mark); for CONCEPTS only while the
  // hint is actually showing, so a situation that resolves unseen does not
  // silently burn the hint.
  done?(obs: CoachObs): boolean;
  // Dwell-dismissal for info-only hints: after this many SIM-seconds on
  // screen the hint counts as seen and fades. The one sanctioned deviation
  // from action-is-the-dismissal, because for pure information "seen" is the
  // goal.
  dwellSec?: number;
}

// What the view renders: the active mark, mirrored into reactive state by the
// game so the bubble component stays as dumb as a fare pin.
export interface CoachActive {
  id: string;
  text: string;
  anchor: CoachAnchor;
  // Lesson bubbles and hint bubbles are told apart in tests and styling.
  kind: "lesson" | "concept";
}

// How long after any dismissal the next tier-2 hint has to wait, in
// sim-seconds. Lessons ignore it — a curriculum is allowed consecutive steps.
export const CONCEPT_COOLDOWN_SEC = 8;

export interface CoachController {
  // Sequence the marks against the latest run facts. dt is the sim-seconds
  // this tick advanced, for dwell and cooldown. Call once per world tick.
  step(obs: CoachObs, dt: number): void;
  // The mark the player should see right now, or null.
  readonly active: CoachActive | null;
  // Retry: run facts and run-tier marks start over; session/player completion
  // survives (see tier).
  newRun(): void;
  // True when there is nothing to teach — the game skips all per-tick coach
  // work (including the switch snapshot) on such boards.
  readonly empty: boolean;
}

export function createCoach(
  lessons: CoachMarkSpec[],
  concepts: CoachMarkSpec[] = [],
  seen: CoachSeen = { has: () => false, add: () => undefined }
): CoachController {
  const sessionDone = new Set<string>();
  const runDone = new Set<string>();
  let active: CoachActive | null = null;
  let activeSpec: CoachMarkSpec | null = null;
  let activeSec = 0;
  let cooldown = 0;

  const isDone = (s: CoachMarkSpec): boolean => {
    if (s.tier === "player") return seen.has(s.id) || sessionDone.has(s.id);
    if (s.tier === "run") return runDone.has(s.id);
    return sessionDone.has(s.id);
  };
  const complete = (s: CoachMarkSpec): void => {
    if (s.tier === "player") seen.add(s.id);
    else if (s.tier === "run") runDone.add(s.id);
    if (s.tier !== "run") sessionDone.add(s.id);
    cooldown = CONCEPT_COOLDOWN_SEC;
  };
  const deactivate = (): void => {
    active = null;
    activeSpec = null;
    activeSec = 0;
  };
  const activate = (s: CoachMarkSpec, obs: CoachObs, kind: CoachActive["kind"]): void => {
    if (activeSpec !== s) activeSec = 0;
    activeSpec = s;
    const anchor = s.anchorOf ? s.anchorOf(obs) : s.anchor;
    // A dynamic anchor may momentarily resolve to nothing (the held train
    // parked this very tick); keep the previous anchor for that frame rather
    // than flickering the bubble away.
    if (anchor) active = { id: s.id, text: s.text, anchor, kind };
    else if (active?.id !== s.id) active = null;
  };

  return {
    step(obs: CoachObs, dt: number) {
      if (obs.phase !== "playing") {
        deactivate();
        return;
      }
      cooldown = Math.max(0, cooldown - dt);
      if (activeSpec) activeSec += dt;

      // Lessons first, cumulatively: complete every leading mark whose action
      // has already happened, stop at the first that still needs doing.
      for (const s of lessons) {
        if (isDone(s)) continue;
        if (s.done?.(obs) || (s.dwellSec && activeSpec === s && activeSec >= s.dwellSec)) {
          if (activeSpec === s) deactivate();
          complete(s);
          continue;
        }
        activate(s, obs, "lesson");
        return;
      }

      // No lesson pending — the first-encounter hints, in catalog order. A
      // hint completes only while it is SHOWING (by its action, or by dwell);
      // one whose situation passes unshown keeps its turn for the next
      // occurrence.
      const shownTrigger = activeSpec?.trigger;
      if (activeSpec && shownTrigger) {
        const s = activeSpec;
        if (s.done?.(obs) || (s.dwellSec !== undefined && activeSec >= s.dwellSec)) {
          deactivate();
          complete(s);
          return;
        }
        if (!shownTrigger(obs)) {
          // The situation resolved before the hint earned its dwell: stand
          // down without completing, so it teaches at the next occurrence.
          deactivate();
          return;
        }
        activate(s, obs, "concept");
        return;
      }
      if (cooldown > 0) {
        deactivate();
        return;
      }
      for (const s of concepts) {
        if (isDone(s)) continue;
        if (!s.trigger?.(obs)) continue;
        activate(s, obs, "concept");
        return;
      }
      deactivate();
    },
    get active() {
      return active;
    },
    newRun() {
      deactivate();
      runDone.clear();
      cooldown = 0;
    },
    get empty() {
      return lessons.length === 0 && concepts.length === 0;
    },
  };
}

// --- the per-board hint lists ------------------------------------------------
//
// Keyed by BOARD id (the levelId tail), exactly like TycoonTuning: PlayView
// passes "board:<scenario>" and the /test stage "test:<scenario>", so both
// routes into the same board teach the same lesson. A board with no entry
// teaches nothing — the campaign's early levels are the ones that need words,
// and a sandbox full of bubbles would be chrome, not teaching.

const doneBuild = (obs: CoachObs) => obs.tilesBuilt >= 1;
const doneDispatch = (obs: CoachObs) => obs.dispatches >= 1;
const doneSwitch = (obs: CoachObs) => obs.switchTouched;
const doneDelivery = (obs: CoachObs) => obs.delivered >= 1;

const COACH_BY_BOARD: Record<string, CoachMarkSpec[]> = {
  // Campaign level 1 (`objectives`, puzzle): nothing to operate yet — the mark
  // just names the game's one sentence, and the first delivery dismisses it.
  objectives: [
    {
      id: "watch-delivery",
      text: "Every train drives itself to the station in its colour. Get them all home.",
      anchor: { kind: "tile", id: "2,0" },
      done: doneDelivery,
    },
  ],
  // Campaign level 2 (`buildgap`, tycoon): the build verb appears, then the
  // dispatch verb. The gap between 3,1 and 4,1 has no middle tile, so the
  // build mark aims at the seam.
  buildgap: [
    {
      id: "build-gap",
      text: "The line stops short. Open Build, then drag from one open end to the other — every new tile costs money.",
      anchor: { kind: "tile", id: "3,1", dx: 0.5 },
      needs: "build",
      done: doneBuild,
    },
    {
      id: "dispatch-train",
      text: "Your train is waiting and its fare is falling. Click the fare pin to send it.",
      anchor: { kind: "train", id: "t1", homeTile: "0,1" },
      needs: "dispatch",
      done: doneDispatch,
    },
  ],
  // Campaign level 3 (`lakevalley-open`, tycoon) — the design doc's level 1,
  // which introduces all three verbs at once and, until now, explained none of
  // them (the §8 gap this file exists to close). Taught in the order the level
  // is played: close the ring, send the trains, set the junctions.
  "lakevalley-open": [
    {
      id: "build-ring",
      text: "The ring is missing its south run. Open Build, then drag rails between the two open ends.",
      anchor: { kind: "tile", id: "4,5" },
      needs: "build",
      done: doneBuild,
    },
    {
      id: "dispatch-train",
      text: "Your trains wait while their fares tick down. Click a fare pin to send that train.",
      anchor: { kind: "train", id: "blue", homeTile: "0,2" },
      needs: "dispatch",
      done: doneDispatch,
    },
    {
      id: "set-switch",
      text: "A junction sends trains wherever its arm points. Click it to set the route.",
      anchor: { kind: "tile", id: "6,2" },
      needs: "switches",
      done: doneSwitch,
    },
  ],
  // The /test scenario for the lesson mechanic in isolation (project rule:
  // every feature ships one). Only verbs the STAGE can perform — the build
  // gesture lives in PlayView, so the stage's pair is dispatch + switch.
  coachmarks: [
    {
      id: "dispatch-train",
      text: "Click the fare pin to send the waiting train.",
      anchor: { kind: "train", id: "t1", homeTile: "0,1" },
      needs: "dispatch",
      done: doneDispatch,
    },
    {
      id: "set-switch",
      text: "Click the junction to choose which way the next train goes.",
      anchor: { kind: "tile", id: "2,1" },
      needs: "switches",
      done: doneSwitch,
    },
  ],
};

// --- the first-encounter catalog (tier 2, global) ----------------------------
//
// Every entry: `trigger` = the situation, currently true; anchored to the
// thing; `tier: "player"` so once taught it is taught for ever (until "Reset
// hints"). Ordered by how often the situation is a new player's first "is the
// game broken?" moment. Self-gating by construction: a board with no calendar
// never books a levy, a board with one train never holds one.
//
// Deliberately absent (concept doc §3): gridlock and bankruptcy — both have
// dedicated, louder UI that names failure and fix; a bubble on top would be
// exactly the stacking the cooldown rule exists to prevent.

const firstHeldTrain = (obs: CoachObs): CoachAnchor | null =>
  obs.heldByTrainIds.length ? { kind: "train", id: obs.heldByTrainIds[0] } : null;
const firstSignalHeldTrain = (obs: CoachObs): CoachAnchor | null =>
  obs.signalHeldTrainIds.length
    ? { kind: "train", id: obs.signalHeldTrainIds[0] }
    : null;

export const COACH_CONCEPTS: CoachMarkSpec[] = [
  {
    // The #1 unexplained mechanic: our interlocking reserves the whole route
    // to the next signal, so a train can refuse to move for a stretch of
    // track it is nowhere near — which, unexplained, reads as a broken game
    // (FarePin.vue says exactly this about its held state).
    id: "held-train",
    text:
      "A train claims its whole path to the next signal, and this one's path " +
      "is taken. It rolls again on its own once the other train clears it.",
    anchorOf: firstHeldTrain,
    tier: "player",
    trigger: obs => obs.heldByTrainIds.length > 0,
    done: obs => obs.heldByTrainIds.length === 0,
    dwellSec: 10,
  },
  {
    // The player's OWN signal — set and forgotten, then read as a bug.
    id: "signal-hold",
    text:
      "Your signal is holding this train at red. Click the signal to release " +
      "or force it.",
    anchorOf: firstSignalHeldTrain,
    tier: "player",
    trigger: obs => obs.signalHeldTrainIds.length > 0,
    done: obs => obs.signalHeldTrainIds.length === 0,
    dwellSec: 10,
  },
  {
    // The second clock's first bill. Pure information — dwell-dismissed.
    id: "first-levy",
    text:
      "A year has turned: upkeep is charged for every piece of track you " +
      "laid. A lean railway pays less.",
    anchor: { kind: "hud", slot: "calendar" },
    tier: "player",
    trigger: obs => obs.taxPaid > 0,
    dwellSec: 8,
  },
  {
    // The bankruptcy warning, explained the first time the row turns red.
    id: "tax-warning",
    text:
      "Next year's upkeep exceeds your balance. Deliver fares to earn, or " +
      "bulldoze track you no longer need.",
    anchor: { kind: "hud", slot: "calendar" },
    tier: "player",
    trigger: obs => obs.taxUnaffordable,
    done: obs => !obs.taxUnaffordable,
    dwellSec: 10,
  },
];

// The lesson list for a board, with every mark whose verb the mode has
// disabled filtered out (see CoachMarkSpec.needs).
export function coachMarksFor(
  levelId: string,
  controls: ModeControls
): CoachMarkSpec[] {
  const marks = COACH_BY_BOARD[boardIdOf(levelId)] ?? [];
  return marks.filter(m => !m.needs || controls[m.needs]);
}

// Exported for the registry-integrity unit test (anchors must name real tiles
// and trains on their boards).
export { COACH_BY_BOARD };
