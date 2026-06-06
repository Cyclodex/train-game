// The game-phase state machine that drives start/end overlays.
export type GamePhase = "ready" | "playing" | "won" | "lost";

// The running tallies every star/lose predicate reads. Pure data.
export interface Counters {
  delivered: number;
  mismatchedArrivals: number;
  elapsedSec: number;
  manualHolds: number;
  manualGreens: number;
  // Crossing-flow tallies (Crossing Keeper). All zero-defaulted so modes that
  // don't observe the road (Puzzle/Sandbox) leave them at 0 and existing star/
  // fail predicates are unaffected.
  // The worst single-car wait at a crossing seen so far this session, in seconds
  // (a high-water mark — it does not fall when that car is released, so the
  // "Smooth operator" star can judge the whole run).
  maxCarWaitSec: number;
  // Cars that used a crossing and reached the map edge — the road throughput.
  carsDelivered: number;
  // Managed-crossing incidents (a train met a car on a crossing). 0 in the
  // automatic/default model where an incident is impossible.
  crossingIncidents: number;
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
    // A single car waiting longer than this (seconds) at a crossing fails the
    // level — a gridlocked crossing. Off by default.
    maxCarWaitSec?: number;
    // A managed-crossing incident (a car caught on a closing crossing) fails the
    // level. Off by default; only the managed variant ever emits one.
    onCrossingIncident?: boolean;
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
  // Crossing-flow inputs (Crossing Keeper). All optional so existing callers that
  // build a plain Observation (Puzzle/Sandbox) need no change. `maxCarWaitSec` and
  // `carsDelivered` are the road frame's absolute current values (the tracker
  // folds them into the high-water/throughput counters); `crossingIncidentDelta`
  // is a per-tick count of new incidents.
  maxCarWaitSec?: number; // current worst live car wait, seconds
  carsDelivered?: number; // current cumulative road throughput
  crossingIncidentDelta?: number; // new managed-crossing incidents this tick
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
    maxCarWaitSec: 0,
    carsDelivered: 0,
    crossingIncidents: 0,
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
      // Crossing flow: the road frame reports an absolute worst-wait + throughput;
      // keep the high-water mark and the latest throughput. Incidents are a delta.
      if (obs.maxCarWaitSec !== undefined)
        counters.maxCarWaitSec = Math.max(counters.maxCarWaitSec, obs.maxCarWaitSec);
      if (obs.carsDelivered !== undefined)
        counters.carsDelivered = obs.carsDelivered;
      counters.crossingIncidents += obs.crossingIncidentDelta ?? 0;

      // Win takes priority over any same-tick fail.
      if (counters.delivered >= spec.deliveriesRequired) {
        phase = "won";
        return;
      }
      if (spec.fail?.onCrossingIncident && counters.crossingIncidents > 0) {
        phase = "lost";
        lostReason = "A car was caught on the crossing";
        return;
      }
      if (
        spec.fail?.maxCarWaitSec !== undefined &&
        counters.maxCarWaitSec >= spec.fail.maxCarWaitSec
      ) {
        phase = "lost";
        lostReason = "A car was stuck at the crossing too long";
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
