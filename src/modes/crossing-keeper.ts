import { GameMode, ModeContext, ModeSetup, objectiveFromSpec } from "@/modes/types";
import { Counters, StarSpec } from "@/sim/objectives";

// The longest any single car may wait at a crossing before the level is lost — a
// gridlocked crossing. Generous enough that calm play never trips it, tight
// enough that ignoring the roads while a train sits on the crossing eventually
// does. Tuned against the sim's slow car speed (~0.5 tiles/sec).
const MAX_CAR_WAIT_SEC = 30;
// The "Smooth operator" threshold: earn the star if no car ever waited longer
// than this at a crossing. Tighter than the fail bound, so it rewards keeping
// traffic genuinely flowing rather than merely avoiding gridlock.
const SMOOTH_WAIT_SEC = 12;

function crossingStars(starTime: number): StarSpec[] {
  return [
    {
      id: "speedrun",
      label: "Speedrun",
      predicate: (c: Counters) => c.elapsedSec <= starTime,
    },
    {
      id: "smooth-operator",
      label: "Smooth operator",
      predicate: (c: Counters) => c.maxCarWaitSec <= SMOOTH_WAIT_SEC,
    },
    {
      id: "flawless",
      label: "Flawless",
      predicate: (c: Counters) => c.crossingIncidents === 0,
    },
  ];
}

// Crossing Keeper: deliver every train while keeping the road traffic flowing
// through the level crossings. The crossing is promoted from atmosphere to a
// scored mechanic — cars accrue patience while held at a closed gate, and letting
// one wait too long (a gridlocked crossing) fails the level. The player still
// wins by routing the trains home; the pressure is doing it without choking the
// roads. The managed-crash variant (a train meeting a car on the crossing →
// incident) is gated behind a per-level spec flag and lands as a follow-up; the
// default automatic crossing here is patience-scored and crash-free.
export const crossingKeeperMode: GameMode = {
  id: "crossing-keeper",
  label: "Crossing Keeper",
  description:
    "Deliver every train while keeping the roads flowing through the level " +
    "crossings. Don't let a car sit stuck at the gate too long.",
  setup(ctx: ModeContext): ModeSetup {
    const trainCount = ctx.trains.length;
    const starTime = Math.max(20, trainCount * 8);
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: {
        deliveriesRequired: trainCount,
        fail: {
          maxCarWaitSec: MAX_CAR_WAIT_SEC,
          onCrossingIncident: true,
        },
        stars: crossingStars(starTime),
      },
    };
  },
  controls: {
    switches: true, // still route the trains to clear the crossings
    signalHolds: false, // the crossing is the manual tool here, not signals
    crossingGate: true, // the level-crossing gate is this mode's control
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
