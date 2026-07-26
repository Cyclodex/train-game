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
  // Time Attack: trains injected by the spawner so far (a running total). The
  // tracker always sets these; they're optional so existing hand-built Counters
  // fixtures (Puzzle/Crossing Keeper tests) stay valid without change.
  spawned?: number;
  // Trains currently in play: spawned (plus any init trains) minus delivered.
  // The live backlog the Time Attack overflow rule watches.
  active?: number;
  // The highest `active` seen this run (a high-water mark), for a "kept it calm"
  // style star.
  peakActive?: number;
  // Economy (Tycoon). Mirrors of the ledger in `sim/economy.ts` so a star
  // predicate can score money without the tracker knowing what a fare is. The
  // tracker always sets these (zeroCounters); they're optional for the same
  // reason `spawned`/`active` are — hand-built Counters fixtures in the mode
  // specs stay valid without being rewritten. A mode with no economy never
  // reports them, so they stay 0 and every existing predicate is unaffected.
  balance?: number; // money in hand right now
  earned?: number; // lifetime income this run
  spent?: number; // lifetime outgoings this run (positive)
  // Track pieces bought in play (Tycoon build, phase 2): the count of NEW rail
  // connections `game.buildRoute` laid this run. What a Train Valley style
  // "buy ≥ N track pieces" star reads. Optional like the other economy fields,
  // and for the same fixture-compatibility reason.
  tilesBuilt?: number;
  // Money committed to TRACK this run, net of bulldoze refunds — i.e. `spent`
  // minus everything that was not a build. It exists because `spent` now also
  // carries the annual TAX, and a "win while spending at most $X" star must
  // keep measuring build discipline: charged to `spent`, the tax would turn
  // that star into a second time star (dawdle and lose it), which is exactly
  // the axis Payday already scores. Same netting rule as `tilesBuilt`, so the
  // two always agree about what the player kept.
  trackSpent?: number;
  // Upkeep the company could not pay — the shortfall on the first annual levy
  // that outran the balance. Non-zero means BANKRUPT. A number rather than a
  // flag, to match every other counter here and because how badly you missed is
  // worth knowing. Only the TAX can produce it: an unaffordable build is
  // refused up front, and a refusal is a choice, not insolvency.
  unpaidTax?: number;
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
  // Trains in play at t=0 (present without a spawn schedule). The live `active`
  // backlog counter starts here; spawned trains add to it, deliveries subtract.
  // Defaults to 0 (no init trains / modes that don't track a backlog).
  initialActiveTrains?: number;
  fail?: {
    onTimeout?: boolean;
    // A single car waiting longer than this (seconds) at a crossing fails the
    // level — a gridlocked crossing. Off by default.
    maxCarWaitSec?: number;
    // A managed-crossing incident (a car caught on a closing crossing) fails the
    // level. Off by default; only the managed variant ever emits one.
    onCrossingIncident?: boolean;
    // Time Attack overflow: lose if more than this many trains are active (in
    // play, undelivered) at once — the backlog the player let pile up. Off by
    // default so other modes never trip it.
    maxActiveTrains?: number;
    // BANKRUPTCY (Tycoon): lose when an annual levy outruns the balance. Off by
    // default, and inert on any board with no calendar — no tax, no shortfall.
    // Note what it deliberately is NOT: "the balance reached zero". Being broke
    // with the railway already built and the trains running is not a failure,
    // it is a tight win, and several measured lines finish exactly like that.
    // The failure is owing money you cannot pay.
    onBankruptcy?: boolean;
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
  spawnedDelta?: number; // trains injected by the spawner this tick (Time Attack)
  // Economy (Tycoon): the ledger's ABSOLUTE current totals, not deltas — the
  // ledger is already the running total, so re-deriving it from per-tick deltas
  // would be a second source of truth that can drift. Omitted → unchanged.
  balance?: number;
  earned?: number;
  spent?: number;
  // Money committed to track so far, net of refunds. An ABSOLUTE for the same
  // reason the three above are: `game.ts` already keeps this running total
  // beside `boughtPieces`, so re-deriving it from deltas here would be a second
  // source of truth that can drift.
  trackSpent?: number;
  // Upkeep the company could not pay, cumulative. An ABSOLUTE, like the ledger
  // figures above; `game.ts` owns the running total.
  unpaidTax?: number;
  // Track pieces bought this tick (Tycoon build). A DELTA, unlike the ledger
  // absolutes above: a purchase is an event, not a running total the game
  // already owns elsewhere.
  tilesBuiltDelta?: number;
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
    spawned: 0,
    active: 0,
    peakActive: 0,
    balance: 0,
    earned: 0,
    spent: 0,
    trackSpent: 0,
    unpaidTax: 0,
    tilesBuilt: 0,
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
      // The init trains are active from the first tick (Time Attack adds more).
      counters.active = spec.initialActiveTrains ?? 0;
      counters.peakActive = counters.active;
      lostReason = undefined;
    },
    observe(obs, dt) {
      if (phase !== "playing") return;
      counters.delivered += obs.deliveredDelta;
      counters.mismatchedArrivals += obs.mismatchedDelta;
      counters.manualHolds += obs.manualHoldDelta;
      counters.manualGreens += obs.manualGreenDelta;
      counters.spawned = (counters.spawned ?? 0) + (obs.spawnedDelta ?? 0);
      // Live backlog: init + spawned − delivered. Mismatched bounces stay active
      // (the train keeps circulating until it parks in a matching depot).
      counters.active =
        (spec.initialActiveTrains ?? 0) + counters.spawned - counters.delivered;
      counters.peakActive = Math.max(counters.peakActive ?? 0, counters.active);
      counters.elapsedSec += dt;
      // Crossing flow: the road frame reports an absolute worst-wait + throughput;
      // keep the high-water mark and the latest throughput. Incidents are a delta.
      if (obs.maxCarWaitSec !== undefined)
        counters.maxCarWaitSec = Math.max(counters.maxCarWaitSec, obs.maxCarWaitSec);
      if (obs.carsDelivered !== undefined)
        counters.carsDelivered = obs.carsDelivered;
      counters.crossingIncidents += obs.crossingIncidentDelta ?? 0;
      // Economy: absolutes straight off the ledger (see the Observation note).
      if (obs.balance !== undefined) counters.balance = obs.balance;
      if (obs.earned !== undefined) counters.earned = obs.earned;
      if (obs.spent !== undefined) counters.spent = obs.spent;
      if (obs.trackSpent !== undefined) counters.trackSpent = obs.trackSpent;
      if (obs.unpaidTax !== undefined) counters.unpaidTax = obs.unpaidTax;
      counters.tilesBuilt =
        (counters.tilesBuilt ?? 0) + (obs.tilesBuiltDelta ?? 0);

      // Win takes priority over any same-tick fail.
      if (counters.delivered >= spec.deliveriesRequired) {
        phase = "won";
        return;
      }
      // Bankruptcy first among the fail checks: it is the most specific reason
      // the run ended, and telling the player "you ran out of money" beats any
      // symptom of it that another check might notice on the same tick.
      if (spec.fail?.onBankruptcy && (counters.unpaidTax ?? 0) > 0) {
        phase = "lost";
        lostReason =
          "Bankrupt — the upkeep outgrew the railway. Build leaner, " +
          "or bulldoze track you no longer need.";
        return;
      }
      if (
        spec.fail?.maxActiveTrains !== undefined &&
        (counters.active ?? 0) > spec.fail.maxActiveTrains
      ) {
        phase = "lost";
        lostReason = "Too many trains backed up";
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
