# Handoff: road lane rendering (one-way highway drops + car driving lines)

Context for an agent picking up the **visual car driving lines** and the road
lane-drop rendering. Current as of develop @ commits d007492, b29e71b, +gore fix.

## What exists now

Two render paths for a **straight road tile** that changes lane count at a seam.
A tile is just `road: Lane[]` (data-driven). "One-way" = lanes in one direction
only (other direction's `laneCount` is 0); "bidirectional" = both.

- **Bidirectional** (e.g. `/test` `road-taper 2L`, yellow centreline): the
  ORIGINAL code. Lanes anchor to the tile **centreline**; the outer/kerb lane
  drops; gore = `laneDropGore()` (point upstream, widens downstream). This was
  already correct and is the reference look.
- **One-way** (`/test/.../roadonewaylanes`): NEW code I added. Lanes **left-align
  to the run's widest lane count** so the through lanes are dead straight and the
  road drops/adds lanes on the RIGHT (motorway style). Gore = `oneWayClosingGore()`
  (now also point-upstream/widen-downstream after a fix).

## Key files / functions

- `src/sim/laneOffset.ts`
  - `oneWayLaneOffsetPx(lanePos, runMax, tileSize)` = `(lanePos + 0.5 - runMax/2)·W`.
    The **car driving-line lateral offset for one-way**: lane 0 = leftmost
    (through), highest index = right kerb (the lane that ends). No seam taper —
    a surviving lane has the same offset on every tile of the run, so it's
    straight; a merging car eases left as its fractional `lanePos` drops.
  - `laneOffsetPx(...)` + `laneSeamOffsetPx(..., centred)`: the **bidirectional**
    offset (centred clamp). NOTE: the `centred=true` branch (an old one-way
    "band-substitution" attempt) is now **unused in production** — dead-ish code,
    still has unit tests in `tests/unit/sim/laneOffset.spec.ts`. Candidate for removal.
- `src/game.ts`
  - `couplerOffset(s, fallbackLane)`: where car couplers get their lateral px.
    One-way straight → `oneWayLaneOffsetPx`; bidirectional straight → `laneOffsetPx`
    clamp; curve/junction → `laneOffsetConstPx`. **This is THE function driving the
    on-screen car lines** (per coupler, front+rear, so the body leans on a lane change).
  - `oneWayRunMaxAt(coord, entry)` + `isOneWayStraightAt`: walk the contiguous
    one-way straight run for its max lane count. Exposed as `game.roadOneWayRunMax`.
  - The **simulation is unchanged**: `src/sim/road.ts` `desiredLane` keeps lanes
    `0..n-1` and merges the highest index down → under left-align that's "keep the
    left/through lanes, drop the right". The renderer must match the sim's lane
    indexing, not the other way round.
- `src/components/Tile.vue`
  - `roadPaths` (surface + kerb edges + lane-divider markings): has a one-way
    branch (left-aligned ribbon `roadRibbonPolygonPath`, straight left kerb,
    survivor dividers via `roadParallelLine`, opening dividers on a widen) and the
    bidirectional branch below it.
  - `laneGraphOverlay` (the cyan debug lines, debug mode): one-way uses
    `oneWayLaneOffsetPx`-equivalent; **must stay identical to `couplerOffset`** or
    the debug lines lie about where cars drive.
  - `laneDropOverlay` (gore + merge arrows): one-way branch uses `oneWayClosingGore`
    + `oneWayMergeArrowPath` on the +n (right) side.
- `src/tiles/roadGeometry.ts`: `roadRibbonPolygonPath`, `roadParallelLine`,
  `oneWayClosingGore`, `oneWayMergeArrowPath` (one-way); `laneDropGore`,
  `laneDropArrowPath/Plan`, `roadSurfacePolygonPath`, `roadLaneMarkingPaths`
  (bidirectional/shared).

## The duplication to resolve (most important)

One-way and bidirectional lane drops are **conceptually the same feature**. The
gore is duplicated: `laneDropGore` (lane-count / centreline-relative) vs
`oneWayClosingGore` (explicit offset bounds). They drifted (the one-way one was
backwards until just fixed). **Recommended: extract ONE gore/merge primitive that
takes explicit offset bounds and have both call it; keep only the lateral ANCHOR
as the fork** (centreline for bidirectional, run-max left-align for one-way). The
anchor is the only irreducible difference — bidirectional gets it free from the
yellow centreline; one-way has no centreline so it left-aligns to `runMax`.

## Debugging aids

- `config.plainBackdrop` (🌳 BG button in `/test` TestStage): swaps the meadow
  backdrop for flat green so kerbs/markings/gores read clearly. Essential here.
- Debug mode (Debug button) shows the **cyan lane graph** = where cars actually
  drive. Compare it against the painted dashes/gore: they must line up. If the
  cyan and the paint disagree at a seam, that's the bug.
- Browser automation tab is hidden → rAF paused → cars freeze, but all SVG
  geometry (cyan lines, gores, markings) is static and inspects fine.

## Open follow-ups for the driving-lines work

1. Unify the gore/merge primitive (above).
2. Remove the dead `centred` band-substitution branch in `laneSeamOffsetPx` + its
   now-misleading tests.
3. Possibly give the bidirectional path the same "straight through-lanes" feel via
   a shared anchor abstraction.
4. Advance merge arrows (warn one tile upstream) aren't drawn for one-way yet
   (bidirectional has `laneDropArrowPlan` lookahead; one-way only marks the taper tile).
