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

// How close (in tiles) the head must be to a stop line before we snap onto it,
// so braking resolves to a real halt instead of approaching it asymptotically.
export const ARRIVAL_EPS = 0.02;

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
