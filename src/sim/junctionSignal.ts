import { Position } from "@/types";
import { Port } from "./topology";

// --- Street-junction traffic signals (ROAD / cars only) ----------------------
// A road junction can be turned into a SIGNALISED intersection: an approach arm
// may only be entered on GREEN, with a real AMBER clearance interval and a brief
// ALL-RED before the next phase so the box empties (no car stranded mid-junction).
// This is a phase layer ON TOP of the existing first-come conflict-matrix arbiter
// (roadJunction.ts + road.ts clearAhead): the matrix still prevents collisions
// between permitted movements within a green phase. Rail is untouched — this is
// the road equivalent of the train "stop / proceed" aspect (simulation.ts), and
// borrows that green/red vocabulary for consistency.
//
// The phase clock advances on SIM TIME (like the car spawner's spawnClock) so it
// is deterministic and unit-testable; each arm's aspect is derived each tick from
// the active phase. There is no override state to store (v1 decision 6) — the only
// player control is choosing the mode.

export type JunctionSignalMode = "off" | "two-phase" | "round-robin"; // v2: "four-phase", "actuated"

export interface JunctionSignal {
  mode: JunctionSignalMode;
  busPriority?: boolean; // v1 layer on the timed modes (transit signal priority)
  // Timing uses fixed module-level defaults in v1 (no per-tile greenSec/amberSec).
}

// An arm's current light. "amber" is a true interval (not just red): a car that
// can stop safely stops, one already in/too close to the junction clears.
export type SignalAspect = "green" | "amber" | "red";

// Fixed default timing (seconds), tuned by feel. v1 has no sliders (decision 3).
export const GREEN_SEC = 6;
export const AMBER_SEC = 1;
export const ALL_RED_SEC = 1;

// Bus-priority tuning (transit signal priority, decision 2 layer).
// A bus within this many tiles of the junction on an arm counts as "approaching".
export const BUS_PRIORITY_TILES = 4;
// Bus HEAD START (separate transit signal): when the upcoming phase carries an
// approaching/waiting bus, its arms show green FOR BUSES this many seconds
// before the cars get their green — the bus clears its lane before
// right-turning cars cross it, like a real transit pre-signal.
export const BUS_HEADSTART_SEC = 3;
// The most a green may be held past its base duration to let an approaching bus
// through (a hard cap so cross traffic is never starved).
export const GREEN_EXTEND_MAX_SEC = 5;

// Right-hand-traffic arm order, clockwise — the round-robin cycling order
// (N → E → S → W) and the canonical ordering for the two-phase pairs.
const ARM_ORDER: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

// The ordered phase plan for a mode over the arms actually PRESENT on the
// junction. Each phase is the set of arms that show green together; a T-junction
// simply omits the missing arm (decision 7), and 2-/3-lane arms don't change the
// plan (the conflict matrix handles within-phase lane conflicts as today).
//
//  • two-phase  — opposing pairs: N+S green together, then E+W. Highest throughput.
//  • round-robin — exactly one approach green at a time, cycling N→E→S→W.
export function phasePlan(mode: JunctionSignalMode, arms: Port[]): Port[][] {
  const present = ARM_ORDER.filter(a => arms.includes(a));
  if (present.length === 0) return [];
  if (mode === "round-robin") return present.map(a => [a]);
  if (mode === "two-phase") {
    const ns = present.filter(a => a === Position.Top || a === Position.Bottom);
    const ew = present.filter(a => a === Position.Left || a === Position.Right);
    return [ns, ew].filter(g => g.length > 0);
  }
  return []; // "off": no phases (the conflict-matrix yield runs unchanged)
}

// The next signal in the editor/play CYCLE for the one-button control (decision 6):
// off → two-phase → two-phase+bus → round-robin → round-robin+bus → off. One click
// reaches every mode and the bus-priority layer on each timed mode.
const CYCLE: JunctionSignal[] = [
  { mode: "off" },
  { mode: "two-phase" },
  { mode: "two-phase", busPriority: true },
  { mode: "round-robin" },
  { mode: "round-robin", busPriority: true },
];

export function cycleJunctionSignal(sig: JunctionSignal | undefined): JunctionSignal {
  const cur = sig ?? { mode: "off" };
  const idx = CYCLE.findIndex(
    s => s.mode === cur.mode && !!s.busPriority === !!cur.busPriority,
  );
  return CYCLE[(idx + 1) % CYCLE.length];
}

// A short label for the live mode chip / debug, e.g. "two-phase +bus".
export function signalModeLabel(sig: JunctionSignal | undefined): string {
  if (!sig || sig.mode === "off") return "off";
  return sig.busPriority ? `${sig.mode} +bus` : sig.mode;
}

type Stage = "green" | "amber" | "allred" | "headstart";

// A stateful per-junction signal controller. Advances on sim time; `aspect(arm)`
// is derived from the active phase each tick. Bus-priority (when enabled) extends
// the active green while a bus is approaching one of its arms, and brings the
// phase of a waiting bus forward at the all-red boundary.
export interface JunctionSignalController {
  signal(): JunctionSignal;
  setSignal(sig: JunctionSignal): void;
  // Advance one tick; `approaching` = arms with a bus within BUS_PRIORITY_TILES.
  step(dt: number, approaching: ReadonlySet<Port>): void;
  // The current light for an approach arm, per vehicle class: during the bus
  // HEAD START stage the active arms are green for buses but still red for
  // cars (the separate transit signal). An arm absent from the plan (or "off")
  // shows green so the gate is a no-op there.
  aspect(arm: Port, cls?: "car" | "bus"): SignalAspect;
}

export function createJunctionSignal(
  arms: Port[],
  initial: JunctionSignal,
): JunctionSignalController {
  let sig: JunctionSignal = initial;
  let plan = phasePlan(sig.mode, arms);
  let phaseIndex = 0;
  let stage: Stage = "green";
  let elapsed = 0; // seconds in the current stage

  function rebuild(): void {
    plan = phasePlan(sig.mode, arms);
    if (phaseIndex >= plan.length) phaseIndex = 0;
  }

  function activeArms(): Port[] {
    return plan[phaseIndex] ?? [];
  }

  function busOnActive(approaching: ReadonlySet<Port>): boolean {
    return activeArms().some(a => approaching.has(a));
  }

  // The duration of the current stage. Green can be extended for an approaching
  // bus up to the cap; amber / all-red / head-start are fixed intervals.
  function stageDuration(approaching: ReadonlySet<Port>): number {
    if (stage === "amber") return AMBER_SEC;
    if (stage === "allred") return ALL_RED_SEC;
    if (stage === "headstart") return BUS_HEADSTART_SEC;
    // green
    if (sig.busPriority && busOnActive(approaching)) {
      return GREEN_SEC + GREEN_EXTEND_MAX_SEC; // hold while a bus is coming (capped)
    }
    return GREEN_SEC;
  }

  // The phase to switch to after all-red. Normally the next in cyclic order, but
  // bus-priority brings forward the soonest phase carrying a waiting/approaching
  // bus (skipping empty phases toward it).
  function nextPhaseIndex(approaching: ReadonlySet<Port>): number {
    const n = plan.length;
    if (n <= 1) return 0;
    // Bus-priority brings the soonest OTHER phase carrying a bus forward (skipping
    // empty phases toward it). It never re-selects the phase just served, so a
    // standing bus can't monopolise the junction and starve cross traffic — that
    // phase's green is merely extended while the bus is there, not repeated.
    if (sig.busPriority) {
      for (let k = 1; k < n; k++) {
        const idx = (phaseIndex + k) % n;
        if ((plan[idx] ?? []).some(a => approaching.has(a))) return idx;
      }
    }
    return (phaseIndex + 1) % n;
  }

  function advanceStage(approaching: ReadonlySet<Port>): void {
    if (stage === "green") stage = "amber";
    else if (stage === "amber") stage = "allred";
    else if (stage === "headstart") stage = "green";
    else {
      // End of all-red: switch to the next phase. With bus priority, a bus
      // approaching/waiting on the NEW phase's arms gets its HEAD START first
      // (transit pre-signal: buses roll, cars still held), then full green.
      phaseIndex = nextPhaseIndex(approaching);
      stage =
        sig.busPriority && (plan[phaseIndex] ?? []).some(a => approaching.has(a))
          ? "headstart"
          : "green";
    }
  }

  return {
    signal: () => sig,
    setSignal(next: JunctionSignal) {
      sig = next;
      rebuild();
      // Restart the cycle cleanly from the first phase's green on a mode change.
      phaseIndex = Math.min(phaseIndex, Math.max(0, plan.length - 1));
      stage = "green";
      elapsed = 0;
    },
    step(dt: number, approaching: ReadonlySet<Port>) {
      if (sig.mode === "off" || plan.length === 0) return;
      elapsed += dt;
      // Resolve every stage boundary the elapsed time crossed (guarded against a
      // pathologically large dt). The remainder carries into the next stage.
      for (let guard = 0; guard < 100; guard++) {
        const dur = stageDuration(approaching);
        if (elapsed < dur) break;
        elapsed -= dur;
        advanceStage(approaching);
      }
    },
    aspect(arm: Port, cls: "car" | "bus" = "car"): SignalAspect {
      if (sig.mode === "off" || plan.length === 0) return "green";
      if (!activeArms().includes(arm)) return "red";
      if (stage === "green") return "green";
      if (stage === "amber") return "amber";
      if (stage === "headstart") return cls === "bus" ? "green" : "red";
      return "red"; // all-red clearance
    },
  };
}
