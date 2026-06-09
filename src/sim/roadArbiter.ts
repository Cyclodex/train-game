import { Port } from "./topology";
import type { VehicleClass } from "@/tiles/lanes";

// A junction movement with its lane context: which arm it enters/leaves by,
// which approach lane it occupies (0 = kerb), and the vehicle's class. Lane and
// class let the conflict predicate decide LANE-AWARE cases the port pair alone
// cannot: two same-arm movements only cross when their lateral order inverts,
// and two merges onto the same arm only collide when they land on the same lane.
export interface JunctionMovement {
  entryArm: Port;
  exitArm: Port;
  lane: number;
  cls: VehicleClass;
}

export interface ActiveMovement extends JunctionMovement {
  carId: string;
}

export interface WaitingCar extends JunctionMovement {
  priority: number; // roadPriority of the approach tile (0=side, 1=main)
  waitSeconds: number;
}

// Whether two junction movements conflict. Supplied per junction by the sim
// (closing over the geometric conflict matrix, the junction's lanes and the
// exit arms' lanes) so the arbiter itself stays pure decision logic.
export type ConflictFn = (a: JunctionMovement, b: JunctionMovement) => boolean;

export interface JunctionArbiter {
  canEnter(
    candidate: WaitingCar,
    active: ActiveMovement[],
    waiting: WaitingCar[],
    conflicts: ConflictFn,
  ): boolean;
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
  canEnter(candidate, active, waiting, conflicts) {
    // Rule 1: block if any active movement conflicts with ours
    for (const a of active) {
      if (conflicts(candidate, a)) return false;
    }

    // Rule 2: yield to higher-priority waiting cars (unless starvation guard fires)
    if (candidate.waitSeconds < STARVATION_THRESHOLD) {
      for (const w of waiting) {
        if (w.priority <= candidate.priority) continue;
        if (conflicts(candidate, w)) return false;
      }
    }

    return true;
  },
};
