// Train dynamics: the momentum model's tunable constants and the per-train
// acceleration/braking rates derived from a train's mass. Plain TS, no Vue/DOM
// (mirrors trainDimensions.ts) so the headless simulation can consume it.
//
// Distances are in tiles, time in seconds; accel/brake are tiles/sec². The
// simulation integrates a current velocity toward maxSpeed using `accel`, and
// brakes with `brake`, looking ahead so a train coasts to rest exactly at the
// next stop line (red signal, train ahead, depot, dead end).

export type TrainKind = "people" | "fraight";

// Base rates for the lightest train (a lone people locomotive). Tuned so a
// light train reaches a typical cruise speed in ~1 second and brakes over a
// similar distance, while the heaviest enabled train still feels responsive.
export const BASE_ACCEL = 0.8; // tiles/sec²
// Gentler than acceleration so trains glide to a stop rather than stopping
// sharply — a lower value lengthens the braking distance / time.
export const BASE_BRAKE = 0.5; // tiles/sec²

// How much each unit of "weight" softens the rates. massK = 1 + (weight-1)*S.
export const MASS_SENSITIVITY = 0.12;

// Per-wagon weight by kind — freight wagons are heavier than people wagons. The
// locomotive itself is the base unit of weight (1).
export const PEOPLE_WAGON_WEIGHT = 1.0;
export const FRAIGHT_WAGON_WEIGHT = 1.6;

// Total "weight" of a train: the loco plus its wagons (heavier per freight wagon).
function trainWeight(kind: TrainKind, wagonCount: number): number {
  const perWagon =
    kind === "fraight" ? FRAIGHT_WAGON_WEIGHT : PEOPLE_WAGON_WEIGHT;
  return 1 + wagonCount * perWagon;
}

// Acceleration and braking rates for a train of the given kind and length. A
// heavier train scales both rates down by its mass factor, so it pulls away and
// stops more gently.
export function trainDynamics(
  kind: TrainKind,
  wagonCount: number
): { accel: number; brake: number } {
  const massK = 1 + (trainWeight(kind, wagonCount) - 1) * MASS_SENSITIVITY;
  return { accel: BASE_ACCEL / massK, brake: BASE_BRAKE / massK };
}

// --- Grades ------------------------------------------------------------------
// How hard one height step fights a CLIMBING train. The speed on a grade is
// maxSpeed / (1 + GRADE_DRAG * grade * weightK): a light passenger shuttle
// keeps most of its pace up a single step, a loaded freight crawls — which is
// what finally makes train weight a routing decision (the flat detour vs the
// short pass), not just a feel. GRADE_MASS spreads the trains: it scales how
// much each unit of weight beyond the lone loco adds to the drag.
export const GRADE_DRAG = 0.35;
export const GRADE_MASS = 0.5;

/**
 * The cruise-speed multiplier on a grade. `grade` is the height step of the
 * tile ahead minus the tile under the head: positive = climbing. Flat and
 * DOWNHILL return exactly 1 — descending earns no bonus (the brakes hold, and
 * a speed bonus would poison the braking-distance maths in the sim).
 */
export function gradeSpeedFactor(
  kind: TrainKind,
  wagonCount: number,
  grade: number
): number {
  if (grade <= 0) return 1;
  const weightK = 1 + (trainWeight(kind, wagonCount) - 1) * GRADE_MASS;
  return 1 / (1 + GRADE_DRAG * grade * weightK);
}
