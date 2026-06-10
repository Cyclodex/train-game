import { Lane, laneMovements, turnKind } from "@/tiles/lanes";
import { Position } from "@/types";
import { Port } from "./topology";

export interface Movement {
  entry: Port;
  exit: Port;
}

// Lateral order of a movement's exit relative to its approach, right-hand
// traffic: a RIGHT turn leaves on the kerb side (rank 0), STRAIGHT in the middle
// (1), a LEFT turn on the centre side (2). U-turns rank like straights.
export function turnRank(entry: Port, exit: Port): number {
  const k = turnKind(entry, exit);
  return k === "right" ? 0 : k === "left" ? 2 : 1;
}

// Do two movements entering a junction from the SAME arm, in lanes `laneA` /
// `laneB` (0 = kerb), cross inside the junction? They cross exactly when their
// lateral order inverts between entry and exit: the kerb-ward vehicle heads
// "more left" than the inner one (e.g. a kerb bus lane going straight while the
// inner lane turns right across it), so one path sweeps over the other. Same
// lane (a queue) or same lateral order (parallel paths) never cross. The old
// matrix hard-coded same-entry pairs as never conflicting — a single-lane-era
// assumption that let an inner-lane right-turner drive through a kerb-lane bus.
export function sameEntryConflict(
  entry: Port,
  exitA: Port,
  laneA: number,
  exitB: Port,
  laneB: number,
): boolean {
  if (exitA === exitB) return false; // same path: car-following handles queues
  return (laneA - laneB) * (turnRank(entry, exitA) - turnRank(entry, exitB)) < 0;
}

// ---------------------------------------------------------------------------
// Right-hand traffic lane positions inside the unit tile square.
//
// Entry positions: where a car enters the tile through a port (inbound lane).
//   - Southbound traffic enters at the west / right side of the top edge.
//   - Northbound traffic enters at the east / right side of the bottom edge.
//   - Eastbound traffic enters at the south / right side of the left edge.
//   - Westbound traffic enters at the north / right side of the right edge.
//
// Exit positions: where a car exits the tile through a port (outbound lane).
//   Mirror of entry: the outbound lane is on the opposite side of the centreline.
// ---------------------------------------------------------------------------
const ENTRY_POS: Record<Port, [number, number]> = {
  [Position.Top]: [0.35, 0.0],
  [Position.Bottom]: [0.65, 1.0],
  [Position.Left]: [0.0, 0.65],
  [Position.Right]: [1.0, 0.35],
  [Position.Center]: [0.5, 0.5],
};

const EXIT_POS: Record<Port, [number, number]> = {
  [Position.Top]: [0.65, 0.0],
  [Position.Bottom]: [0.35, 1.0],
  [Position.Left]: [0.0, 0.35],
  [Position.Right]: [1.0, 0.65],
  [Position.Center]: [0.5, 0.5],
};

// ---------------------------------------------------------------------------
// 2D line-segment intersection using parametric form.
// Returns true iff segment P1→P2 and segment P3→P4 intersect *strictly*
// inside both segments (both parameters t and u in (0,1) exclusive).
// Parallel / collinear lines → false (denominator near zero).
// ---------------------------------------------------------------------------
const EPS = 1e-6;

function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];

  // denominator = d1 × d2  (2D cross product)
  const denom = d1x * d2y - d1y * d2x;

  if (Math.abs(denom) < EPS) {
    // Parallel or collinear — treat as non-intersecting.
    return false;
  }

  const dx = p3[0] - p1[0];
  const dy = p3[1] - p1[1];

  // t: parameter along P1→P2
  const t = (dx * d2y - dy * d2x) / denom;
  // u: parameter along P3→P4
  const u = (dx * d1y - dy * d1x) / denom;

  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if movements `a` and `b` geometrically conflict — i.e. their
 * right-hand-traffic path segments intersect strictly inside the unit tile.
 *
 * Trivially false when:
 *  - both movements share the same entry port (same car can't be in two places)
 *  - either movement is a U-turn (entry === exit)
 */
export function movementsConflict(a: Movement, b: Movement): boolean {
  if (a.entry === b.entry) return false;
  if (a.entry === a.exit) return false;
  if (b.entry === b.exit) return false;

  return segmentsIntersect(
    ENTRY_POS[a.entry],
    EXIT_POS[a.exit],
    ENTRY_POS[b.entry],
    EXIT_POS[b.exit],
  );
}

/**
 * Order-independent string key for a conflict pair.
 * Movements are encoded as "entry:exit" (the geometric conflict depends only on
 * the entry/exit ports, not the lane index); the two keys are sorted
 * alphabetically so conflictKey(a,b) === conflictKey(b,a). The matrix, the
 * arbiter, and the per-car perpendicular check therefore all key the same way —
 * so a car in ANY lane (not just lane 0) is gated by a conflicting cross stream.
 */
export function conflictKey(a: Movement, b: Movement): string {
  const ka = `${Position[a.entry]}:${Position[a.exit]}`;
  const kb = `${Position[b.entry]}:${Position[b.exit]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * Given the lanes for a tile, enumerate every directed movement
 * (each lane contributes {entry:from, exit:to} for each permitted exit),
 * deduplicate, then return the set of conflict keys for all conflicting pairs.
 */
export function buildConflictMatrix(road: Lane[]): Set<string> {
  // Directed movements from the lanes (from -> each permitted exit).
  const movements: Movement[] = laneMovements(road).map(m => ({
    entry: m.from,
    exit: m.to,
  }));

  const matrix = new Set<string>();
  for (let i = 0; i < movements.length; i++) {
    for (let j = i + 1; j < movements.length; j++) {
      if (movementsConflict(movements[i], movements[j])) {
        matrix.add(conflictKey(movements[i], movements[j]));
      }
    }
  }
  return matrix;
}
