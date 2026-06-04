# Chord-based car rendering on curves

**Status:** design / approved direction
**Date:** 2026-06-05
**Area:** sim↔renderer body sampling (`sampleTrain` + `positionUnit`).

## Problem

On curves the loco and wagons appear to overlap / "drive into each other." Cause:
each car is a **rigid rectangular sprite spaced by *arc length* but drawn from a
single centre point + the path *tangent***. On a curve the straight-line (chord)
distance between two along-track points is shorter than the arc length between
them, so centre points that are "one car apart" along the track end up closer than
a car-length apart in pixels, and the tangent-aligned rectangles poke into each
other.

Real rail cars connect at **couplers at their two ends**, each riding the rail;
the body is the **chord** between those two points, so the car sits slightly
*inside* the curve and the couplers stay on the line.

## Goal

Draw each car as the chord between its front and rear coupler points sampled on
the path: position at the midpoint of those two points, angle along the chord.
Adjacent cars then share coupler positions along the track, so they stop
overlapping and gain the authentic "leaning into the curve" look. One change fixes
both the overlap and the realism.

## Non-goals

- Do **not** change the underlying curve geometry (`segmentPathD` stays the
  quadratic Bézier). The drawn rails follow the same per-tile path, so changing it
  would cascade into all rail rendering for little payoff. Cars riding the
  existing path as chords is what sells it.
- No simulation/movement/reservation changes. Pure rendering of the existing
  body positions.

## Design

### Sim: `sampleTrain` returns coupler pairs

Today `sampleTrain(id): SampledUnit[]` returns one centre point per unit
(`sampleAt(headDistance - unitOffsets[i])`).

Change it to return, per unit, the **front and rear** sampled points:

```ts
export interface UnitChord {
  front: SampledUnit; // toward the loco head
  rear: SampledUnit;  // toward the tail
}
sampleTrain(id: string): UnitChord[];
```

For unit `i` with centre offset `O = unitOffsets[i]` and length `L =
unitLengths[i]` (both in tiles, distance measured back from the head):

- `front = sampleAt(headDistance - (O - L/2))`
- `rear  = sampleAt(headDistance - (O + L/2))`

`sampleAt` is unchanged (clamps to `[0, headDistance]`, maps a distance to the
`(coord, entryPort, exitPort, t)` of the segment it falls in). The loco's front
(`O = L/2` ⇒ distance 0) is the head itself; consecutive units share a coupler:
`rear` of unit `i` and `front` of unit `i+1` differ only by the coupling gap along
the track, so with gap 0 they sample the *same* point.

`unitOffsets` / `bodyLength` are unchanged.

### Renderer: midpoint + chord angle

`game.ts` `positionUnit` takes a `UnitChord` instead of a `SampledUnit`:

```ts
function sampleWorld(s: SampledUnit) {        // existing point math, factored out
  const exit = s.exitPort ?? s.entryPort;
  const path = pathFor(segmentPathD(s.entryPort, exit, tileSize));
  const len = path.getTotalLength();
  const d = s.t * len;
  const at = path.getPointAtLength(d);
  const ahead = path.getPointAtLength(Math.min(len, d + 1));
  return {
    x: s.coord.x * tileSize + at.x,
    y: s.coord.y * tileSize + at.y,
    tangent: Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180 / Math.PI,
  };
}

function positionUnit(body: UnitChord) {
  const f = sampleWorld(body.front), r = sampleWorld(body.rear);
  const dx = f.x - r.x, dy = f.y - r.y;
  const chord = Math.hypot(dx, dy);
  // Fall back to the tangent when the chord collapses (e.g. a unit bunched at the
  // depot exit before the train has extended), avoiding an atan2(0,0) flip.
  const angle = chord > 0.5 ? Math.atan2(dy, dx) * 180 / Math.PI : f.tangent;
  return { x: (f.x + r.x) / 2, y: (f.y + r.y) / 2, angle };
}
```

`renderTrains` keeps iterating `sim.sampleTrain(def.id)` and feeding each
`UnitChord` to `positionUnit`. The sprite keeps its fixed CSS pixel length (no
scaling): on a curve the chord is a touch shorter than the real car length, so the
sprite overhangs its couplers by a hair — natural, and far better than the current
overlap.

Cross-boundary cars (front and rear in different tiles, e.g. mid-curve) just work:
each endpoint is sampled in its own tile and converted to world coordinates, then
the midpoint/chord are computed in world space.

## Files

- `src/sim/simulation.ts` — add `UnitChord`; `sampleTrain` returns
  `UnitChord[]` (front/rear per unit via the existing `sampleAt`).
- `src/game.ts` — factor `sampleWorld`; `positionUnit(body: UnitChord)` uses
  midpoint + chord angle; update the `Game` interface type.

## Testing

Sim unit tests (`tests/unit/sim/simulation.spec.ts`):

- **Coupler continuity:** with `coupling = 0`, the `rear` of unit `i` and the
  `front` of unit `i+1` sample to the same along-track point (they meet) — the
  property that removes the overlap.
- **Loco front at the head:** unit 0's `front` is at the train head
  (`headDistance`).
- **Front leads rear:** each unit's `front` is ahead of its `rear` by ~its length
  along a straight corridor; units remain ordered head→tail.
- **On a curve the chord is a real chord:** the two coupler points of a unit
  spanning a curve are distinct (sanity that we're using endpoints, not a single
  centre).

Existing `sampleTrain` tests (centre-based spacing) are updated to the new
front/rear contract, preserving their intent (ordered trailing, spacing reflects
real lengths) via the coupler-continuity assertions. `bodyLength` test is
unchanged.

Renderer wiring is covered by `npm run build` (vue-tsc) + the e2e smoke test
(trains render, leave depots, no console errors). For feel, `npm run dev` and
watch a multi-wagon train round a curve.

## Risks / trade-offs

- Fixed-length sprite over a shorter chord overhangs couplers slightly on tight
  curves — intended and natural (real cars overhang couplers on curves). Scaling
  the sprite to the chord would make couplers meet exactly but squashes cars on
  curves; rejected.
- Degenerate near-zero chord (unit bunched at a depot exit) handled by the tangent
  fallback.
