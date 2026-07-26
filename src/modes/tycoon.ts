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
// Deliberately NOT here (each with a reason in the design doc): the in-play
// build tool (phase 2 — needs the route-draw gesture pulled out of EditorView
// first), reversing trains (§5.2 — weeks of interlocking work to avoid with
// level design), crashes (§2.2 G7 — our interlocking makes them impossible and
// that is a feature), production chains (§5.1).

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

// Seed capital. Nothing spends it yet (building is phase 2), so it exists to
// make the balance readable as a number that moves rather than one that only
// grows from zero — and so phase 2 has a budget to start from.
export const STARTING_BALANCE = 1000;

// The share of the theoretical maximum payout that counts as "you dispatched
// promptly". Reachable but not free: it needs the trains sent as they appear,
// not one at a time.
const PAYDAY_FRACTION = 0.6;

export function fareFor(def: TrainDef): FareSpec {
  return {
    base: BASE_FARE + FARE_PER_WAGON * def.wagonIds.length,
    decayPerSec: FARE_DECAY_PER_SEC,
  };
}

export function economyFor(trains: TrainDef[]): EconomySetup {
  const fares: Record<string, FareSpec> = {};
  for (const def of trains) fares[def.id] = fareFor(def);
  return { startingBalance: STARTING_BALANCE, fares };
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

export const tycoonMode: GameMode = {
  id: "tycoon",
  label: "Tycoon / Dispatch",
  description:
    "Every train waits in its station with a fare that is already ticking " +
    "down. Send it, route it, bank whatever is left when it gets home.",
  setup(ctx: ModeContext): ModeSetup {
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
        stars: tycoonStars(maxPayoutOf(ctx.trains)),
      },
      economy: economyFor(ctx.trains),
    };
  },
  controls: {
    switches: true,
    signalHolds: true,
    crossingGate: false,
    // Phase 2. The build tool needs the route-draw gesture extracted from
    // EditorView first (design doc §6, "the one thing in its way").
    build: false,
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
