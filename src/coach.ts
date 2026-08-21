import { ModeControls } from "@/modes/types";
import { boardIdOf } from "@/modes/tycoon";

// Coach-marks — the teaching system (design doc §8 item 8, campaign doc A4.3).
//
// Train Valley pins a short hint to the THING it is talking about — "Zug
// wartet. Per Klick losschicken." floats over the waiting train, "Vollende das
// Schienennetz…" over the gap in the rails. That anchoring is the whole idea:
// a hint in a corner is a manual, a hint on the object is a lesson. So a mark
// here is world chrome (a bubble positioned in board pixels, like a fare pin),
// never a modal.
//
// The rules, decided and recorded (handoff §3.1 asked for them explicitly):
//
//  - A mark is dismissed by DOING THE THING, never by a close button. Its
//    `done` predicate reads cumulative run facts (pieces built, trains sent,
//    a switch arm changed), so the player's action is the dismissal.
//  - One mark at a time, in authored order — level 1 teaches build, THEN
//    dispatch, THEN the switch, because that is the order the level is played
//    in. The next mark appears only when the one before it is done.
//  - A verb the player already performed is never taught: the predicates are
//    cumulative over the run, so a mark whose action happened early completes
//    the moment it would have appeared.
//  - Completion is remembered for the SESSION, across Retry (`newRun` keeps
//    the done set): a player who has sent a train knows how to send a train,
//    and re-teaching it on every Retry would turn the tutor into a nag. A
//    reload starts fresh — deliberately no localStorage key; the marks are
//    three short sentences, not progress worth persisting.
//  - Marks only show while the objective is `playing`: nothing floats over
//    the Ready card, and a won/lost board stops teaching.
//
// Headless on purpose, like the rest of the model layer: the controller is a
// pure state machine over an observation the game assembles each tick, so the
// whole sequencing logic is unit-testable without a browser.

// Where a mark points. World-anchored only — a mark names a board object, and
// the two kinds of object a verb happens on are a tile and a train.
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
      // puzzle board has no fares, so there is no badge to ride).
      homeTile: string;
    };

// The cumulative run facts a `done` predicate may read. All monotone within a
// run (reset() zeroes them with everything else), which is what lets a mark
// complete correctly even when its action happened before it was shown.
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
}

export interface CoachMarkSpec {
  id: string;
  text: string;
  anchor: CoachAnchor;
  // The control this mark's verb lives behind. A mark that teaches a verb the
  // mode has disabled (build on a puzzle board) could never be dismissed, so
  // it is filtered out up front rather than shown as a dead end.
  needs?: keyof ModeControls;
  done(obs: CoachObs): boolean;
}

// What the view renders: the active mark, mirrored into reactive state by the
// game so the bubble component stays as dumb as a fare pin.
export interface CoachActive {
  id: string;
  text: string;
  anchor: CoachAnchor;
}

export interface CoachController {
  // Sequence the marks against the latest run facts. Call once per world tick.
  step(obs: CoachObs): void;
  // The mark the player should see right now, or null.
  readonly active: CoachMarkSpec | null;
  // Retry: the run facts start over, but the done set survives (see above).
  newRun(): void;
  // True when there is nothing to teach — the game skips all per-tick coach
  // work (including the switch snapshot) on such boards.
  readonly empty: boolean;
}

export function createCoach(specs: CoachMarkSpec[]): CoachController {
  const done = new Set<string>();
  let active: CoachMarkSpec | null = null;
  return {
    step(obs: CoachObs) {
      if (obs.phase !== "playing") {
        active = null;
        return;
      }
      // Walk the authored order: complete every leading mark whose action has
      // already happened, stop at the first that still needs doing. Marks
      // after that stay unshown even if their predicate would pass — they get
      // their turn (and auto-complete) when the sequence reaches them.
      active = null;
      for (const s of specs) {
        if (done.has(s.id)) continue;
        if (s.done(obs)) {
          done.add(s.id);
          continue;
        }
        active = s;
        break;
      }
    },
    get active() {
      return active;
    },
    newRun() {
      active = null;
    },
    get empty() {
      return specs.length === 0;
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
  // The /test scenario for this mechanic in isolation (project rule: every
  // feature ships one). Only verbs the STAGE can perform — the build gesture
  // lives in PlayView, so the stage's pair is dispatch + switch.
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

// The hint list for a board, with every mark whose verb the mode has disabled
// filtered out (see CoachMarkSpec.needs).
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
