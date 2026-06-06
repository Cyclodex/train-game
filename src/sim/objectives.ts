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
