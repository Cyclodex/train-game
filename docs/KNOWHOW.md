# KNOWHOW — hard-won canon for the train game

The facts a new session needs **before** touching tiles, curves, roads, or
junctions. We kept re-deriving (and re-breaking) these; this is the single page
that stops the re-iteration. When something here is wrong, fix the code *and*
this doc in the same pass.

Living status docs that complement this one:
- `docs/road-network-progress.md` — current road sub-project status (A–G).
- `docs/signaling-design.md` — rail signalling/interlocking phases.
- `CLAUDE.md` — architecture overview + Vue conventions.

---

## 0. The one invariant: data is the single source of truth

A tile is **data**, not a class. Topology lives once and everything is derived:

- **Rails:** `TileCell.connections: PortPair[]` (unordered pairs over N/E/S/W/
  Center). `kindOf`, rail geometry, and the sim's exit-port routing all derive
  from it. Sim and renderer import the **same** `src/tiles/*` modules.
- **Roads:** `TileCell.road: Lane[]` (`{from, to[], index, kind?}`) — **directed**.
  This is the keystone: undirected `PortPair`s could not express one-way or
  turn restrictions (a `{Left,Bottom}` pair is a right turn from one end and a
  left turn from the other). Never regress roads to undirected pairs.

**Rule:** the renderer matches the sim's indexing, not the other way round. If
the painted markings and the sim disagree, the paint is the bug. The cyan/amber
**debug overlay draws where cars actually drive** (`couplerOffset` in `game.ts`);
the lane-graph overlay code must stay byte-for-byte consistent with it. When the
cyan lines and the painted dashes/gores disagree at a seam — that *is* the bug.

---

## 1. Curves — rail vs road are DIFFERENT geometries

This is the #1 thing sessions get wrong. There are **two** curve shapes:

| | Shape | Where | Why |
|---|---|---|---|
| **Rail curve** | Quadratic Bézier through the **tile centre** (`Q centre`) | `geometry.ts railPathsFor`, `pathGeometry.ts segmentPathD` | Trains sweep through the middle of the tile — correct for rail. |
| **Road turn** | 90° **circular arc** around the **wrapped tile corner**, radius `size/2`, tangent to both arms at the port edges (`A r r 0 0 sweep`) | `pathGeometry.ts roadSegmentPathD`, `turnCornerPoint` | A street corner wraps the corner, not the centre. The centre-quad version **bulged into the junction box** (every turn dipped toward the middle) — that was a real, fixed bug. Do not "simplify" the road turn back to the rail quad. |

`turnCornerPoint(a,b) = pa + pb − centre` (e.g. Top+Right → the NE corner).

### Arc length (the coupled-car overlap bug)

Distance along track is **NOT** uniform per tile. A tile's path length:
- straight / depot-Center link = `size` (the chord);
- **rail curve ≈ 0.8116 × size** (`curveUnitLength`, the quad's integrated length);
- **road turn = (π/2)(size/2) ≈ 0.785 × size** (`roadSegmentLength`, quarter-circle).

The classic bug: the sim once measured spacing in **normalised per-tile progress**
(every tile = "1"). On a curve (~0.81×) coupled cars/wagons sat ~20px closer and
overlapped, and the loco looked ~19% slower. **Fix (canonical):** space coupled
units by **true arc length** — `segmentLength()` / `roadSegmentLength()` +
`sampleTrain` walking segment-by-segment (`sampleAtArc`). Straights are unchanged;
only curves differ. If wagons bunch on curves, this is the lever — not sprite
scaling.

### Constant-width road curve (the apex pinch)

Offsetting a Bézier by moving its **control point** pinches the apex (the road
narrows mid-curve). The fix: a **true constant-distance offset** = a perpendicular
push of the *sampled* centreline (`laneOffsetPointAt` in `pathGeometry.ts`), not a
control-point-pushout approximation. All lane geometry — car positions
(`couplerOffset`), painted ribbon (`roadGeometry.ts`), and the debug overlay —
flow through this one analytic offset so they agree exactly.

### Turn-lane fillet (the "strange bend" at mixed-width junctions)

A turning **lane** is **not** the port-to-port arc pushed sideways by
`lerp(offEntry, offExit)`. With **unequal** offsets (any turn between arms of
different lane counts) that linear drift breaks the tangent at both seams — a
visible kink that spirals to the exit. That was the "strange bend" on every
mixed-width junction while equal-arm ones looked fine.

**Correct model (`turnLaneFrame`/`turnLanePointAt`):** the corner **fillet of the
two lane lines** — follow the entry lane line straight, take the largest constant-
radius arc tangent to both lane lines, then follow the exit lane line straight.
Tangent-continuous at both seams for **any** offset pair; collapses to the old
concentric arc (pixel-identical) when `offEntry === offExit`.

### Sprite rendering on curves (what was tried and rejected)

- **Chord rendering** (kept): a car/wagon is drawn as the **chord between its two
  couplers** (`UnitChord {front, rear}` from `sampleTrain`; midpoint + chord
  angle), so rigid sprites lean into curves instead of overlapping.
- **Bogie inset** (kept): each unit is sampled at two anchor points **inset from
  the body ends** by `BOGIE_INSET_FRAC = 0.2` (`simulation.ts`) — like real
  wheels — so the body hugs the rail with natural end overhang.
- **Auto-spread / `scaleX` foreshortening** (REVERTED): the user disliked the
  sprite distortion ("the bending"). Don't reintroduce sprite-stretching to fix
  curve overlap — the real cause was the arc-length metric (above).

---

## 2. Junctions — the rules that keep biting

### Receiving-capacity rule (which lanes may turn where)

Junction lanes (`Lane.to[]`) are derived, not free-hand, by
`deriveJunctionLanes` (`src/tiles/editOps.ts`, next to `syncJunctionBusGates`).
The rule (full table + cases in
`docs/superpowers/specs/2026-06-12-junction-lane-capacity-design.md`):

> Never more turning lanes toward a destination than that destination has
> **receiving** lanes — and every movement is **lane-true** (no crossing arcs).

Per approach (N lanes; index 0 = kerb, highest = inner):
- **Right** block on the kerb side, **Left** block on the inner side, **Straight**
  in the middle, all lane-true (kerb→kerb, inner→inner, concentric arcs).
- A floored single turn **shares** with straight (kerb = S+R; inner = L+S only
  when N ≤ 2). On **N ≥ 3** the inner-most lane is a **dedicated LEFT pocket**
  (a waiting left-turner must not block a through lane).
- A **dual** turn shares straight onto the lane closest to the straight block
  (the middle lane of a 3L→2L approach), so two through lanes survive.
- **1L → nL fan-out:** the single lane gets all movements; each lands in its
  **nearest** receiving lane (right→kerb, left→inner, straight→aligned). No free
  fan-out, no occupancy-based lane choice (deliberately rejected — it strands
  cars before their next turn without cross-junction planning we don't want).
- Capacities are **per vehicle class**: car derivation counts only non-bus
  receiving lanes and skips bus approach lanes; `busTo`/`syncJunctionBusGates`
  run after the car derivation, both inside the editor's `commit()`.

### Junctions NEVER lane-count-mismatch (recurring false-red)

`laneCountAt` **over-counts** a junction port (it counts every lane that can fan
through an arm), so a naive seam-equality check paints junctions — and curves next
to them — **red**. This bug recurred more than once. The rule: **only simple
curves must preserve lane count across a seam; junctions never mismatch.** Guard
with `seamMismatch()` (`lanes.ts`) + `Game.roadIsJunctionAt(coord)` to skip the
flag when the neighbour across the seam is a junction. Scenarios: `mixedcross`,
`mixedtee`.

### Arm flare is realistic, not a defect

A junction sizes its turn ribbon to its **widest** arm
(`max(laneCountAt(a), laneCountAt(b), 2)`). A narrower arm meeting a wider
junction **mouth** reads as a real intersection **flare** — verified on screen
(a 1-lane arm, 56px, into a ~140px junction). **Do not "fix" this pinch blind.**
A true per-arm-width junction needs per-END turn-ribbon widths (a
`roadCurvePolygonPath` refactor touching every junction scenario) — only with the
user watching.

### Conflict arbiter

Crossing a junction box is gated by a conflict-matrix arbiter
(`src/sim/roadArbiter.ts`, `roadJunction.ts`): `conflictKey` is **lane-indexed**,
so parallel lanes cross independently. One-way / right-turn-only / no-left-turn
are enforced both by directed topology and at the conflict-matrix level.

---

## 3. Roads — lane model & rendering

- **Lane offset:** `LANE_WIDTH_FRAC = 0.14` (`src/sim/laneOffset.ts`). A lane's
  lateral px offset feeds car couplers, painted ribbon, markings, and the debug
  overlay through the same functions — keep them in lockstep.
- **Bidirectional roads** anchor lanes to the **yellow centreline**; the outer
  (kerb) lane drops; gore = `laneDropGore` (point upstream, widens downstream).
- **One-way roads** carry lanes in one direction only and have **no centreline**.
  They **left-align to the run's widest lane count** (`oneWayRunMaxAt`,
  `game.roadOneWayRunMax`) — a motorway lane drop — so through lanes run dead
  straight and the **right-most** lane(s) end with a hatched closure island
  (Sperrfläche) + merge arrows on the **+n (right)** side. Lane `i` offset =
  `(i + 0.5 − R/2)·W`; lane 0 = leftmost/through, high index = kerb. **The sim is
  unchanged** — `desiredLane` keeps lanes `0..n-1` and merges the highest index
  down, which under left-align = "keep the left/through lanes, drop the right".
  Renderer-only fork (`oneWayLaneOffsetPx`, `roadRibbonPolygonPath`,
  `oneWayClosingGore`, `oneWayMergeArrowPath`). A centred symmetric squeeze was
  the WRONG model for one-way and was abandoned (a one-sided island can't sit on
  a symmetric narrowing).
- **Lane switching (G):** `Car.laneIndex` is a **float** (continuous lateral
  position); `Math.round` is the lane it occupies for following/conflict. It eases
  toward an integer `targetLane`, crossing only on an accepted gap; a car whose
  lane ends **merges before the taper**. The render-side taper is gone — the sim
  owns lateral motion, so a plain per-lane offset gives the smooth change.
- **Vehicles are data** (`vehicleSpec`): car, rigid truck, articulated semi
  (two chord segments → the trailer articulates like a train consist). Long bodies
  use full-occupancy sampling so a trailer straddling a junction blocks crossers.

---

## 4. Verification — what actually works here

- **`npm run build`** (vue-tsc + vite) is the fastest correctness gate;
  **`npm run test:unit`** covers the coordinate/lane/junction math. Keep both
  green before committing.
- **Every feature ships a `/test/<id>` scenario** (project rule, in CLAUDE.md).
  `tests/unit/levels/testScenarios.spec.ts` validates every scenario, so a broken
  map fails CI. Debug a feature from its scenario first — a mechanic in isolation
  on a 3-tile map beats it buried in the default level.
- **Visual changes need a screenshot.** Use `npm run shot -- <scenarioId> --label
  before|after` (loads `/test/<id>`, debug overlay on, flat backdrop). A fix PR
  carries a before/after pair.
- **rAF / hidden-tab gotcha:** when verifying via Chrome automation the tab is
  hidden → `requestAnimationFrame` is paused → the sim never steps (no cars spawn,
  trains frozen). This is an environment artifact, not a bug. SVG geometry (cyan
  lines, gores, markings) is **static and inspects fine**; for sim *behaviour* use
  unit tests, not the browser. To eyeball rendering: `window.__game.stop()` first
  (cancel rAF), then push synthetic entries into the reactive render arrays.
- **`config.plainBackdrop`** (🌳 BG button in `/test`) swaps the meadow for flat
  green so kerbs/markings/gores read clearly — essential for road geometry work.

---

## 5. Project workflow (current)

- **Branching: trunk-based, `master`-only** (since 2026-06-11). `develop` was
  **deleted**; all work goes to `master` via short-lived feature branches /
  worktrees. Older notes that say "merge to develop" are obsolete. (The
  develop/master split previously caused silent content loss via stale bot
  3-way merges — that's why it was collapsed.)
- **Commit as you go** — commit your scoped change as soon as it's done and green,
  every time, without being asked. This repo sees heavy **parallel editing** of the
  same files (`road.ts`, `editOps.ts`, scenario `index.ts`); stage only your hunks,
  never sweep in-flight WIP into your commit. **No AI attribution** in commit
  messages.
- **Worktrees** under `.claude/worktrees/` usually resolve `node_modules` by
  walking up to the repo root — try the tooling before adding a junction. If you
  do junction `node_modules` in, remove the **junction first**
  (`cmd /c rmdir`, a reparse-point delete) before `git worktree remove`, or it
  follows the link and deletes the real install.
- **Kill background dev servers** when done (orphaned Vite instances pile up on
  5173+).
