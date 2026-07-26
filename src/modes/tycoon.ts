import {
  EconomySetup,
  GameMode,
  ModeContext,
  ModeSetup,
  TrainDef,
  objectiveFromSpec,
} from "@/modes/types";
import { Counters, StarSpec } from "@/sim/objectives";
import { FareSpec } from "@/sim/economy";

// Tycoon — the build-and-dispatch loop, phase 1.
//
// Train Valley's level-1 sentence, minus the building: a train WAITS in its
// station showing a fare that is already ticking down; you send it with a click,
// route it with the switches, and it pays whatever the fare has decayed to when
// it parks in its matching station. Money is the only score.
//
// The decay starting while the train waits (not when it departs) is the whole
// point — see design doc §1.2 M7. A fare that only fell in transit would reward
// leaving trains on the platform.
//
// Phase 2 (2026-07-26) added the missing verb: BUILD. `controls.build` arms
// PlayView's in-play build tool, which routes with the editor's extracted
// gesture (routeDrawController) and commits through `game.buildRoute` — spend
// then lay, atomically, at TRACK_COST_PER_TILE per new piece.
//
// Deliberately NOT here (each with a reason in the design doc): reversing
// trains (§5.2 — weeks of interlocking work to avoid with level design),
// crashes (§2.2 G7 — our interlocking makes them impossible and that is a
// feature), production chains (§5.1).

// What a delivery is worth before any decay. A loco is the fixed part; each
// wagon is cargo, so a longer consist is a bigger prize AND a slower one — the
// mass model already makes heavy trains accelerate and brake more gently.
export const BASE_FARE = 400;
export const FARE_PER_WAGON = 200;

// How fast the fare falls, in money per second. This is the mode's genre dial
// (design doc §4.2): steep → a twitchy dispatch game, shallow → a planning game.
// 20/sec against a ~800 fare gives roughly 20 seconds of "prompt", which is about
// one lap of a small board.
export const FARE_DECAY_PER_SEC = 20;

// Seed capital — the build budget (phase 2 spends it at TRACK_COST_PER_TILE).
// Three tiles of track: enough to close a small gap the direct way, not enough
// to wander, so an over-long route is refused and the refusal is a real
// mechanic rather than a theoretical branch.
export const STARTING_BALANCE = 3000;

// The share of the theoretical maximum payout that counts as "you dispatched
// promptly". Reachable but not free: it needs the trains sent as they appear,
// not one at a time.
const PAYDAY_FRACTION = 0.6;

export function fareFor(
  def: TrainDef,
  decayPerSec: number = FARE_DECAY_PER_SEC
): FareSpec {
  return {
    base: BASE_FARE + FARE_PER_WAGON * def.wagonIds.length,
    decayPerSec,
  };
}

export function economyFor(
  trains: TrainDef[],
  tuning: TycoonTuning = GENERIC_TUNING
): EconomySetup {
  const fares: Record<string, FareSpec> = {};
  for (const def of trains) fares[def.id] = fareFor(def, tuning.fareDecayPerSec);
  return { startingBalance: tuning.startingBalance, fares };
}

// The most this board could ever pay: every fare collected at its base value.
export function maxPayoutOf(trains: TrainDef[]): number {
  return trains.reduce((sum, def) => sum + fareFor(def).base, 0);
}

// Three stars on three different axes, as the design doc insists (§5.3): money,
// hands-off routing, and colour discipline. You cannot get all three casually.
function tycoonStars(maxPayout: number): StarSpec[] {
  const payday = Math.round(maxPayout * PAYDAY_FRACTION);
  return [
    {
      id: "payday",
      label: `Payday (${payday})`,
      predicate: (c: Counters) => (c.earned ?? 0) >= payday,
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

// --- per-board tuning --------------------------------------------------------
//
// The generic numbers above work on any board the mode is dropped onto, but a
// hand-authored opening level tunes its budget and its goals against its own
// geometry — Train Valley's levels each name their own targets. Keyed by the
// BOARD id, i.e. the levelId tail: PlayView passes "board:<scenario>" and the
// /test stage passes "test:<scenario>", so both routes into the same board get
// the same game.
export interface TycoonTuning {
  startingBalance: number;
  fareDecayPerSec: number;
  stars: (maxPayout: number) => StarSpec[];
}

const GENERIC_TUNING: TycoonTuning = {
  startingBalance: STARTING_BALANCE,
  fareDecayPerSec: FARE_DECAY_PER_SEC,
  stars: tycoonStars,
};

// Lake Valley opening state (`lakevalley-open`): the rebuild the board asks for
// is 7 pieces / $7,000 — 5 to close the ring along row 5, 2 more to rebuild the
// yellow station's T-junction entry at 2,5 (see the scenario file for the
// geometry). The budget covers that with exactly one spare piece: comfortable,
// not lavish. A lean 6-piece build also wins but needs a mid-run switch flip.
export const LAKEVALLEY_OPEN_BALANCE = 8000;
// Slower burn than the generic dial: the fares tick while the player is still
// buying track, and at 20/sec everything would sit at its floor before the
// first train could possibly move. 10/sec keeps roughly half a fare alive
// through a practised ~40s build-and-dispatch, so promptness stays worth money.
export const LAKEVALLEY_OPEN_DECAY = 10;
// "Under budget": win while spending at most this — the lean 6-piece build.
export const LAKEVALLEY_OPEN_LEAN_SPEND = 6000;
// "Rail baron": buy at least the full 7-piece restoration.
export const LAKEVALLEY_OPEN_RING_PIECES = 7;
// "Payday": gross income target. Tuned against a played run (see the design
// doc): a prompt build-then-dispatch banks ~$1,4xx of the $2,200 maximum; a run
// that lets every fare hit its floor banks $550.
export const LAKEVALLEY_OPEN_PAYDAY = 1100;

// Three goals that pull in different directions, Train Valley style (§1.2 M9 —
// level 1 asks for an extra train, 46 track pieces AND $5,000, and you cannot
// chase them all in one run): Payday wants prompt dispatch, Under budget wants
// the lean build, Rail baron wants the full one. Under budget and Rail baron
// are mutually exclusive by arithmetic (6 pieces max vs 7 pieces min), so the
// board is worth at least two runs. "Deliver every train" is not a star — it is
// the win condition itself (deliveriesRequired).
function lakevalleyOpenStars(): StarSpec[] {
  return [
    {
      id: "payday",
      label: `Payday ($${LAKEVALLEY_OPEN_PAYDAY.toLocaleString("en-US")})`,
      predicate: (c: Counters) => (c.earned ?? 0) >= LAKEVALLEY_OPEN_PAYDAY,
    },
    {
      id: "under-budget",
      label: `Under budget ($${LAKEVALLEY_OPEN_LEAN_SPEND.toLocaleString("en-US")})`,
      predicate: (c: Counters) => (c.spent ?? 0) <= LAKEVALLEY_OPEN_LEAN_SPEND,
    },
    {
      id: "rail-baron",
      label: `Rail baron (${LAKEVALLEY_OPEN_RING_PIECES} pieces)`,
      predicate: (c: Counters) =>
        (c.tilesBuilt ?? 0) >= LAKEVALLEY_OPEN_RING_PIECES,
    },
  ];
}

const LAKEVALLEY_OPEN_TUNING: TycoonTuning = {
  startingBalance: LAKEVALLEY_OPEN_BALANCE,
  fareDecayPerSec: LAKEVALLEY_OPEN_DECAY,
  stars: lakevalleyOpenStars,
};

// The board id is the levelId tail ("board:x" from /play, "test:x" from /test).
export function boardIdOf(levelId: string): string {
  const i = levelId.indexOf(":");
  return i < 0 ? levelId : levelId.slice(i + 1);
}

export function tuningFor(levelId: string): TycoonTuning {
  return boardIdOf(levelId) === "lakevalley-open"
    ? LAKEVALLEY_OPEN_TUNING
    : GENERIC_TUNING;
}

export const tycoonMode: GameMode = {
  id: "tycoon",
  label: "Tycoon / Dispatch",
  description:
    "Every train waits in its station with a fare that is already ticking " +
    "down. Send it, route it, bank whatever is left when it gets home.",
  setup(ctx: ModeContext): ModeSetup {
    const tuning = tuningFor(ctx.levelId);
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: {
        deliveriesRequired: ctx.trains.length,
        // Every train is in play from t=0 — waiting counts as in play, since its
        // fare is already burning. Without this the tracker's live `active`
        // backlog counts down through zero into negatives.
        initialActiveTrains: ctx.trains.length,
        stars: tuning.stars(maxPayoutOf(ctx.trains)),
      },
      economy: economyFor(ctx.trains, tuning),
    };
  },
  controls: {
    switches: true,
    signalHolds: true,
    crossingGate: false,
    // Phase 2: the Train Valley loop's missing half. Track costs
    // TRACK_COST_PER_TILE out of the same pool the fares fill.
    build: true,
    dispatch: true,
  },
  createObjective: objectiveFromSpec,
  hud: {
    deliveries: true,
    timer: true,
    stars: true,
    startOverlay: true,
    endOverlay: true,
    money: true,
  },
};
