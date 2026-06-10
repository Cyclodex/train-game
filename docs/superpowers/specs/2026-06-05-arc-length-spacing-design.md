# Arc-length car spacing (curve overlap, real cause)

**Status:** implemented
**Date:** 2026-06-05
**Area:** `src/sim/pathGeometry.ts` (+ `segmentLength`) and `src/sim/simulation.ts`
(`sampleTrain`).

## Root cause (confirmed)

Cars bunched up and overlapped on curves. The real cause is a **distance-metric
bug**, not the rendering or the curve sharpness:

- The simulation measured along-track distance in **normalised per-tile progress**
  — every tile counts as "1", and `headProgress` runs 0→1 across a tile regardless
  of the tile's shape.
- But a **curve tile's path is only ~0.81× as long as a straight** (0.8116 vs 1.0,
  verified by integrating the quadratic Bézier).
- So a coupler spaced "0.52 tile behind" sits at 0.52 × 0.81 ≈ 0.42 tile of *real*
  arc on a curve — about **20 px closer** than intended → the sprites overlap.
  (Same reason the loco looks ~19 % slower through curves.)

This is purely the spacing metric: even frozen in time the cars are too close,
because distance was counted in tiles, not real length.

## Fix

Space cars by **true arc length**.

- `pathGeometry.ts` `segmentLength(entryPort, exitPort, size)` — pure: a straight /
  depot-centre link is the line `a→b` (1.0 / 0.5 tile); an adjacent-port curve is
  the quadratic Bézier arc length (~0.8116 tile, memoised — all curves are the same
  shape).
- `simulation.ts` `sampleTrain` — the per-coupler `sampleAt` becomes `sampleAtArc`:
  it walks segment by segment from the head, subtracting each segment's real
  `segLen`, so a coupler `d` tiles of arc behind the head lands at the point that is
  genuinely `d` of arc back. On straights (`segLen = 1`) this is identical to the
  old behaviour — only curves change.

No change to movement, reservation, or the coupler offsets themselves; the cars
stay chained to the loco exactly as before, just spaced by real length so they no
longer bunch.

## Not done (deliberately)

- **Constant on-curve speed.** The loco still advances in normalised tiles, so the
  whole train runs ~19 % slower through a curve. This is a separate, minor (and
  arguably realistic) effect and touches the momentum model (`clearDistanceAhead`
  counts tiles); left as an optional follow-up.
- **Residual corner overlap on the sharpest bends.** With arc-correct spacing the
  big (~20 px) overlap is gone, but two rigid half-tile-long sprites meeting at a
  very steep joint can still clip slightly at the inner corner — the genuine
  "curves a bit too sharp for these wagons" limit. The clean long-term answers are
  gentler curve tiles or shorter wagons; not pursued now. (The earlier
  auto-spread/scaleX attempt was reverted — it distorted the sprites.)

## Testing

- `pathGeometry.spec.ts`: `segmentLength` — straight = 1, depot link = 0.5, curve
  ≈ 0.8116, symmetric across rotations, scales with size.
- `simulation.spec.ts`: a straight→curve→straight path; with the head parked 0.2
  into the second straight, the loco's rear coupler (0.5 tile of arc back) lands at
  `t ≈ 0.63` on the curve tile — the arc-correct point — not `0.7`, the old
  normalised answer that bunched the cars. Existing straight-corridor spacing tests
  are unchanged (proving no regression on straights).

`npm run test:unit` (68) + `npm run build` + e2e (4) all green.
