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
- **One-way** (`/test/.../roadonewaylanes`): lanes **kerb-anchor (index 0 = kerb,
  +n right-of-travel) to the run's widest lane count** so the through lanes are dead
  straight and the road drops/adds lanes on the LEFT / centre side (−n). This matches
  the canonical `index 0 = kerb` used by the editor, sim and two-way junctions, so a
  one-way junction reads left-lane→left / mid→straight / right-lane→right like a normal
  cross. Gore = `oneWayClosingGore()` (point-upstream/widen-downstream).
  (Until 2026-06-15 one-way counted index0=LEFT, which split a junction lane's straight
  and turn arrows to opposite sides — fixed by flipping `oneWayLaneOffsetPx`, render only.)

## Key files / functions

- `src/sim/laneOffset.ts`
  - `oneWayLaneOffsetPx(lanePos, runMax, tileSize)` = `(runMax/2 - 0.5 - lanePos)·W`.
    The **car driving-line lateral offset for one-way**: lane 0 = kerb (right of
    travel), highest index = centre/left (the lane that ends). Same form as
    `laneOffsetConstPx`. No seam taper — a surviving lane has the same offset on
    every tile of the run, so it's straight; a merging car eases toward the kerb as
    its fractional `lanePos` drops.
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
    `0..n-1` and merges the highest index down → under kerb-anchor (index0=kerb)
    that's "keep the kerb lanes, drop the centre". The sim is pure index-space; the
    renderer defines which physical side an index sits on, so the renderer matches
    the sim's lane indexing, not the other way round.
- `src/components/Tile.vue`
  - `roadPaths` (surface + kerb edges + lane-divider markings): has a one-way
    branch (kerb-anchored ribbon `roadRibbonPolygonPath`, straight right/+n kerb,
    centre (−n) edge tapers, survivor dividers via `roadParallelLine`, opening
    dividers on a widen) and the bidirectional branch below it.
  - `laneGraphOverlay` (the cyan debug lines, debug mode): one-way calls the SAME
    `oneWayLaneOffsetPx` as the car (not a re-derived formula) — **must stay
    identical to `couplerOffset`** or the debug lines lie about where cars drive.
  - `laneDropOverlay` (gore + merge arrows): one-way branch uses `oneWayClosingGore`
    + `oneWayMergeArrowPath` on the −n (centre) side.
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

_Closed 2026-07-25 (see the "duplication" section above — it is now history):_

1. ~~Unify the gore/merge primitive.~~ **Done** — `laneClosureGore(entry, exit,
   size, {outerEntry, innerEntry, outerExit, innerExit})` is the single primitive;
   `laneDropGore` is a thin kerb-anchored wrapper and the one-way caller passes its
   own (negative, centre-anchored) offsets. `oneWayClosingGore` is gone. The hatch
   side is **derived** from the bounds rather than passed, so the backwards-gore
   drift cannot recur; it now has unit tests covering both sides.
2. ~~Remove the dead `centred` band-substitution branch in `laneSeamOffsetPx`.~~
   **Done** — no production caller survived the run-max kerb anchor; the branch and
   its four tests (which documented a one-way model that no longer exists) are gone.
   `laneSeamOffsetPx` is now explicitly bidirectional-only.
4. ~~Advance merge arrows for one-way.~~ **Done** — a one-way tile whose *successor*
   drops a lane now paints the merge arrows a tile early (`Tile.vue`
   `laneDropOverlay`, the `exitCount === entryCount` branch), the counterpart of
   `laneDropArrowPlan`'s lookahead. Verified on `roadonewaylanes`: the two tiles
   preceding each taper gained a pair of arrows, and the widening row stays clean.

_Still open:_

3. Possibly give the bidirectional path the same "straight through-lanes" feel via
   a shared anchor abstraction. The anchor (centreline vs run-max kerb) is now the
   only fork left in the closure geometry, so this is the natural next step if the
   two ever need to converge further.
