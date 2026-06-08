# Lane-path unification + turn glide + editor bus-lane tool

Date: 2026-06-08
Status: approved (approach A); scope expanded after a full-codebase audit ("go
for gold — correct paths AND their visualisation, every tile kind").

## Problem

"The path a vehicle follows across a tile" is computed by **four different
implementations** that only partly agree. The amber bus-turn arrow ending on a
lane that doesn't exist is one visible symptom; the deeper issue is that what is
*drawn* (painted lanes, debug arrows, route line) is not derived from what is
*driven*.

### Audit — every path-geometry site (worktree, 2026-06-08)

Centreline (the one shared truth): `pathGeometry.ts` `segmentPathD` — a straight
line for opposite/Center ports, a quadratic Bézier `a→centre→b` for adjacent
ports. Trains ride it directly (offset 0).

Lateral-offset sites and how each builds its curve:

| Site | Straight | Curve | Turn / junction |
|------|----------|-------|-----------------|
| Car driving — `game.ts` `sampleWorld`+`couplerOffset` | true offset, seam-tapered (`laneOffsetPx`) | **true** sampled offset at constant distance (centreline via DOM `getPointAtLength` + perpendicular push) | holds **approach** offset (`laneOffsetConstPx`), snaps to the new lane on the *next* tile |
| Road surface / markings / kerb / bus band — `roadGeometry.ts` | exact (trapezoid + `taperedParallel`) | **k-Bézier approximation** (`roadCurvePolygonPath`, `curvedParallelPath`, `controlOffsetFactor`) | centreline only |
| Lane-graph overlay — `Tile.vue` `laneArrow` | exact (offset line, `offA`/`offB` taper — matches car) | **k-Bézier** (matches paint, **not** the car) | holds **approach** offset → **arrow ends on a phantom lane** |
| Car-route overlay — `game.ts` `CarRouteSeg` | **centreline only** (no lane offset) | centreline only | centreline only |
| Rails — `geometry.ts` `railPathsFor` | offset line | offset endpoints, control point unchanged → **no apex correction** (rails pinch ~15% mid-curve) | n/a |

The three curve methods (true sampled offset / k-Bézier / uncorrected-endpoint)
are mutually inconsistent, so on a bend a car drives slightly off the painted
lane, and the overlay traces the paint rather than the car. On a turn onto a
narrower arm, *nothing* interpolates the lateral offset toward the exit arm's
lane, so the vehicle holds the wide-arm offset across the junction and snaps at
the boundary — and the overlay arrow faithfully ends in the gap. Routing is
already correct (`junctionExitLane` returns a real exit-arm lane); only the
lateral **glide** is wrong.

## Goal

One Vue-free family of functions producing the **true sampled offset curve** of a
lane across a tile, with the offset interpolated `offEntry → offExit` so it covers
seam tapers AND turn-to-exit-arm glide. Every consumer — car driving, painted
surface, lane markings, kerb edges, bus-lane band, lane-graph overlay,
car-route overlay, and (for consistency) rails — derives from it. The k-Bézier
approximation and the renderer's hidden-SVG DOM sampler are retired.

## Design

### 1. Shared lane-path geometry (`src/sim/pathGeometry.ts`, Vue-free)

```ts
laneSegmentPointAt(entry, exit, size, offEntry, offExit, t)
  : { x, y, tangentDeg }                 // renderer + any point sampling
laneSegmentPathD(entry, exit, size, offEntry, offExit, samples = 24)
  : string                               // SVG polyline (paint, overlay, edges)
arrowHeadD(tip, tangentDeg, s)
  : string                               // shared chevron head
```

- Centreline sampled analytically (line, or the quadratic `a→centre→b`) — no DOM.
- Lateral offset at `t` = `lerp(offEntry, offExit, t)` applied along the **local
  right-of-travel normal** of the centreline tangent. This is the *true* parallel
  (offset) curve at constant distance when `offEntry === offExit`, exactly what
  the car already does — so the k-Bézier apex correction is no longer needed.
- Heading from a finite difference of the **offset** path (matches the drawn
  curve through tapers/turns).
- A constant-offset straight collapses to a 2-point line (cheap, pixel-identical
  to today).

### 2. Renderer (`src/game.ts`)

`sampleWorld` takes its point + tangent from `laneSegmentPointAt`; delete the
hidden `<svg>` sampler, `pathFor`, and `pathCache`. Trains pass `0,0` (unchanged).
Road couplers pass `offEntry`/`offExit` from `couplerOffset` (see §3).

### 3. Turn lateral interpolation (`src/game.ts` + sim seam data)

`couplerOffset` returns a `{ offEntry, offExit }` pair, not a single number:

- Straight tile: the existing seam-tapered ends (`laneSeamOffsetPx` at the entry
  and exit bands) — already computed, just surfaced as two values.
- Turn / junction tile: `offEntry` = the vehicle's lane offset on the **approach**
  band; `offExit` = the **target exit lane** offset on the **exit arm** band,
  where the target lane = `junctionExitLane(...)` (the same lane the boundary
  handoff already picks) and the band is the exit arm's centred band. Edge of map
  / unknown exit → `offExit = offEntry` (today's constant behaviour).

The vehicle then glides from approach lane to exit-arm lane across the junction
tile and arrives already on the correct lane. The sim still sets the lane index
at the boundary; this only moves the *visual* transition onto the turn tile.
Needs the sim to expose, per sampled unit on a turn tile, the resolved exit arm
(next coord + entry port) so the renderer can compute the exit band + target lane
— `road.ts` already resolves this at the boundary; surface it on the sample.

### 4. Road painting (`src/tiles/roadGeometry.ts`)

Re-express every curved primitive as a polyline from `laneSegmentPathD`:

- `roadCurvePolygonPath` → the `+halfW` edge polyline followed by the `−halfW`
  edge reversed, closed (an exact ribbon; no `k`).
- `curvedParallelPath` (inner dividers, curved kerb edge) → `laneSegmentPathD`.
- Curved bus-lane band (`roadLaneBandPath` currently straight-only) → a closed
  strip between two offset polylines, so bus lanes can be tinted on curves too.
- Delete `controlOffsetFactor` and the k-Bézier code once nothing calls it.

Straight primitives (`taperedParallel`, trapezoid, gores, lane-drop arrows) are
already exact and stay, but share `laneSegmentPathD`/`arrowHeadD` where it tidies.

### 5. Lane-graph overlay (`src/components/Tile.vue`)

`laneGraphOverlay` builds each movement with `laneSegmentPathD(from, to, size,
offEntry, offExit)` + `arrowHeadD`; `offEntry`/`offExit` computed identically to
§3 (approach offset → exit-arm target-lane offset). Delete `laneArrow`'s bespoke
Bézier-offset math. Result: the overlay is pixel-identical to the driven path.

### 6. Car-route overlay (`src/game.ts` `CarRouteSeg` + `sim.routePath`)

Build each route segment with the lane offset (the car's lane on that segment),
so the highlighted route traces where the car actually drives, not the centreline.
`routePath` must include the per-segment lane (or we offset by the car's current
lane as a documented approximation where the per-segment lane isn't tracked).

### 7. Rails (`src/tiles/geometry.ts`) — consistency follow-on

`railPathsFor` adopts `laneSegmentPathD` for the two flanking rails (offset
`±railDistance`), removing the uncorrected-apex pinch. Cosmetic (trains ride the
centreline) but unifies the last offset-curve method. Lowest priority; isolated.

### 8. Editor mark-a-lane bus tool (`src/tiles/editOps.ts`, `EditorView.vue`)

- `toggleLaneKind(cell, from, index)` — pure reducer flipping one lane's `kind`
  between `undefined`/`"all"` and `"bus"`; no-op if absent.
- A **Bus lane** tool: clicking a road tile hit-tests which drawn lane is under
  the cursor (lateral offset via the same shared math + the lane's approach) and
  toggles its kind. The gold band + amber overlay already render `kind:"bus"`.

### 9. Tests + scenario

- `laneSegmentPointAt`/`laneSegmentPathD`/`arrowHeadD`: straight, curve, taper
  (offEntry≠offExit) endpoints, tangent direction, constant-offset == old line.
- Curve ribbon: a vehicle's sampled position stays within the painted curved
  surface at several `t` (car-on-paint agreement — would have failed before).
- Turn glide: turning onto a 1-lane arm, the sampled lateral offset converges to
  the exit-arm lane by `t=1` (no gap), car and bus.
- `toggleLaneKind` round-trip.
- `/test` scenario: a wide→narrow turn demonstrating the glide; reuse/extend
  `buscross` for the bus turn.

## Sequencing (to minimise conflict with concurrent agents)

Land in small, independently-green commits, rebasing onto `develop` before each:
1. shared functions + unit tests (additive, no behaviour change);
2. renderer onto shared sampler (delete DOM sampler) — visual parity check;
3. turn interpolation (the reported bug) + overlay onto shared path;
4. road painting onto shared polylines (retire k-Bézier);
5. car-route overlay offset; rails consistency;
6. editor bus-lane tool;
7. scenario + final suite + merge.

## Non-goals

- No change to the bus-lane data model (`kind:"bus"` on a `Lane` is correct).
- No change to routing/interlocking, junction arbitration, collision, or
  coupled-car spacing (still by centreline arc length — a pre-existing, accepted
  approximation).
- No "extra vs replace" lane-count concept toggle — already an authoring choice.

## Risk / rollback

The renderer change is on the hot path; analytic sampling of a line/quad is
cheaper than DOM `getPointAtLength`, so no perf regression is expected. Painted
curves become 24-point polylines (smooth at tile scale; tiles are static).
Concurrent agents are editing the same geometry files, so each step rebases onto
`develop` first and is gated by `npm run build` + the unit suite, keeping every
step isolable and revertible.
