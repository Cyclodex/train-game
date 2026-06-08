# Lane-path unification + turn glide + editor bus-lane tool

Date: 2026-06-08
Status: approved (approach A), implementing autonomously

## Problem

A road vehicle's on-screen path and the debug lane overlay are computed by **two
separate implementations**, so the overlay can disagree with where cars really
drive — and worse, both do the naive thing on turns:

- **Renderer** (`game.ts` `sampleWorld`): builds the tile centreline with
  `segmentPathD`, materialises it as a hidden `<svg>` `<path>`, samples it with
  `getPointAtLength`, then pushes the point perpendicular (right-of-travel) by a
  lateral offset from `couplerOffset`.
- **Overlay** (`Tile.vue` `laneGraphOverlay`/`laneArrow`): analytically offsets a
  straight line or a quadratic Bézier (control point pushed out by a factor `k`).

On a **turn/junction tile** (`exit !== oppositePort(entry)`), `couplerOffset`
returns `laneOffsetConstPx(...)` — a *constant* offset based on the **approach**
lane band — for the whole tile. The overlay likewise holds a constant approach
offset. So a vehicle turning from a wide arm onto a narrow one (e.g. a 2-lane road
onto a 1-lane side road) keeps the wide arm's kerb offset across the junction,
exits the tile at a lateral position that is *outside* the narrow arm's only lane,
then **snaps/eases** to the correct lane on the *next* tile. The overlay arrow
faithfully ends in that gap ("a bus going left→bottom ends on a lane that doesn't
exist"). The routing layer is already correct — `junctionExitLane` returns an
index taken from the exit arm's real lanes — the defect is purely the lateral
*glide*.

## Goal

One source of truth for "the path a vehicle follows across a tile", consumed by
both the renderer and the overlay, with the lateral offset **interpolated from the
approach lane to the exit arm's lane across a turn** so vehicles glide to the
correct lane (and the overlay shows exactly that). Plus an editor tool to mark an
individual lane as a bus lane.

## Approach A (chosen)

### 1. Shared lane-path geometry (`src/sim/pathGeometry.ts`, Vue-free)

Add a pure function that returns a point + tangent at parameter `t ∈ [0,1]` along
the lane path across one tile:

```ts
laneSegmentPointAt(
  entryPort, exitPort, size,
  offEntry, offExit,   // lateral offset px, right-of-travel, at t=0 and t=1
  t,
): { x, y, tangentDeg }
```

- Centreline sampled **analytically** (no DOM): a straight line for
  opposite/Center ports, the quadratic Bézier `a → centre → b` for adjacent ports
  (the same curve `segmentPathD` draws and `quadLength` already integrates).
- Lateral offset at `t` = `lerp(offEntry, offExit, t)`, applied along the **local
  right-of-travel normal** of the centreline tangent (`(-dy, dx)/|..|`, the
  existing convention).
- Tangent for sprite/arrow heading taken from the **offset** path (finite
  difference), so a tapering/turning lane's heading matches the drawn curve.

Add `laneSegmentPathD(entryPort, exitPort, size, offEntry, offExit, samples?)`
that returns an SVG `d` polyline of the same sampled points (for the overlay
shaft), plus a small helper for the arrowhead chevron from the end point+tangent.

This subsumes both the renderer's "centreline + perpendicular push" and the
overlay's "offset Bézier"; the analytic curve removes the hidden-SVG sampler.

### 2. Renderer refactor (`src/game.ts`)

`sampleWorld` computes its point+tangent from `laneSegmentPointAt` instead of the
DOM `getPointAtLength` sampler; delete the hidden `<svg>` sampler and `pathFor`.
Trains pass `offEntry = offExit = 0` (centreline) — behaviour identical. For road
couplers, `offEntry`/`offExit` come from `couplerOffset` split into its entry-seam
and exit-seam values (straights already compute both via `seamBand`; see §3 for
turns). Keep the per-coupler, per-tile sampling so the body-lean on lane changes
is preserved.

### 3. Turn lateral interpolation (`src/game.ts` + sim)

On a turn/junction tile, instead of a constant approach offset, compute:

- `offEntry` = lateral offset of the vehicle's lane on the **approach** band
  (today's `laneOffsetConstPx`).
- `offExit` = lateral offset of the **target exit lane** on the exit arm's band,
  where the target lane is `junctionExitLane(...)` (already used at the boundary
  handoff) and the band is the exit arm's centred band.

`laneSegmentPointAt` then glides the vehicle from approach lane to exit lane
across the junction tile, so it arrives at the exit arm already on the correct
lane — no boundary snap. The boundary handoff keeps setting the lane index; this
change only makes the *visual/positional* transition happen across the turn tile
rather than after it.

Care: `offExit` needs the exit arm's lane count + band. The sim already resolves
the next tile/entry at the boundary; expose enough (target lane index + exit
band) for the sampler. Where the exit arm is unknown (level edge), fall back to
the constant approach offset (today's behaviour).

### 4. Overlay refactor (`src/components/Tile.vue`)

`laneGraphOverlay` builds each movement's arrow with `laneSegmentPathD(from, to,
size, offEntry, offExit)` + the shared arrowhead helper. `offEntry` is the lane's
offset on its approach band; `offExit` is the offset of the movement's target lane
on the exit arm's band (same computation as §3, so the picture equals the path).
Delete `laneArrow`'s bespoke Bézier-offset math. Straights keep their existing
seam taper (now expressed as offEntry≠offExit through the same function).

### 5. Editor mark-a-lane bus tool (`src/tiles/editOps.ts`, `EditorView.vue`)

- `toggleLaneKind(cell, from, index)`: pure reducer flipping a single lane's
  `kind` between `undefined`/`"all"` and `"bus"`. No-op if the lane is absent.
- A **Bus lane** tool in `EditorView`: clicking a road tile hit-tests which drawn
  lane the cursor is over (lateral offset via the shared offset math + the lane's
  approach), and toggles that lane's kind. Live validation + the gold bus band and
  amber overlay already render `kind:"bus"`, so the visual feedback is automatic.

### 6. Tests + scenario

- Unit: `laneSegmentPointAt`/`laneSegmentPathD` — straight offset, curve offset,
  offEntry→offExit interpolation endpoints, tangent direction.
- Unit: turning onto a narrower arm lands the vehicle at the exit arm's lane
  offset by t=1 (no gap), for both car and bus.
- Unit: `toggleLaneKind` round-trips a lane's kind.
- `/test` scenario: a turn from a multi-lane arm onto a 1-lane arm, asserting a
  vehicle's sampled lateral position converges to the exit lane (glide, not snap).

## Non-goals

- No change to the bus-lane data model (`kind:"bus"` on a `Lane` is correct).
- No change to routing/interlocking, junction arbitration, or collision logic.
- No "extra vs replace" lane concept toggle — that is purely an authoring/editor
  count choice and already works both ways.

## Risk / rollback

The renderer change is on the hot path; analytic sampling of a line/quad Bézier is
cheaper than DOM `getPointAtLength`, so no perf regression is expected. Each step
is committed separately and gated by `npm run build` + the unit suite (666 tests),
so any regression is isolable and revertible.
