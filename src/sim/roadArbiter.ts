import { Port } from "./topology";
import { conflictKey, Movement } from "./roadJunction";

export interface ActiveMovement {
  carId: string;
  entryArm: Port;
  exitArm: Port;
}

export interface WaitingCar {
  entryArm: Port;
  exitArm: Port;
  priority: number; // roadPriority of the approach tile (0=side, 1=main)
  waitSeconds: number;
}

export interface JunctionArbiter {
  canEnter(
    candidate: WaitingCar,
    active: ActiveMovement[],
    waiting: WaitingCar[],
    conflictPairs: Set<string>,
  ): boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function conflicts(a: Movement, b: Movement, pairs: Set<string>): boolean {
  return pairs.has(conflictKey(a, b));
}

// ---------------------------------------------------------------------------
// Default arbiter: first-come-first-served with road-priority yielding.
//
// Rules (applied in order):
//  1. Block if any currently-active movement conflicts with ours.
//  2. Yield to any higher-priority waiting car whose movement conflicts with
//     ours — unless we have been waiting long enough to trigger the starvation
//     guard (STARVATION_THRESHOLD seconds).
// ---------------------------------------------------------------------------

const STARVATION_THRESHOLD = 5; // seconds

export const fcfsWithPriorityArbiter: JunctionArbiter = {
  canEnter(candidate, active, waiting, conflictPairs) {
    const cMov: Movement = { entry: candidate.entryArm, exit: candidate.exitArm };

    // Rule 1: block if any active movement conflicts with ours
    for (const a of active) {
      if (conflicts(cMov, { entry: a.entryArm, exit: a.exitArm }, conflictPairs)) return false;
    }

    // Rule 2: yield to higher-priority waiting cars (unless starvation guard fires)
    if (candidate.waitSeconds < STARVATION_THRESHOLD) {
      for (const w of waiting) {
        if (w.priority <= candidate.priority) continue;
        if (conflicts(cMov, { entry: w.entryArm, exit: w.exitArm }, conflictPairs)) return false;
      }
    }

    return true;
  },
};
