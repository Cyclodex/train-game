# KNOWHOW — train-game canon (dense; for the agent)

Facts we kept re-deriving/re-breaking. Read before touching tiles/curves/roads/
junctions. Terse on purpose. Companion docs: `road-network-progress.md` (road
status), `signaling-design.md`, `CLAUDE.md` (architecture).

## UPKEEP (do this every task)
After finishing any task, before the final summary: if you learned, corrected, or
disproved anything here → edit this file in the same commit. Add a fact, fix a
wrong one, delete a dead one. One-line bullets, cite `file.ts:symbol`. Keep it
lean — prune as much as you add. This file only stays useful if every task tends it.

## INVARIANTS
- Tiles are DATA, single source of truth. Rails: `connections: PortPair[]`. Roads:
  `road: Lane[]` = `{from,to[],index,kind?}` DIRECTED (undirected pairs can't do
  one-way/turn rules — never regress). Sim + renderer import same `src/tiles/*`.
- Renderer matches the SIM's lane indexing, not vice versa.
- Cyan/amber debug overlay = where cars actually drive (`game.ts couplerOffset`).
  Lane-graph overlay code must stay identical to it. Cyan ≠ painted dash/gore at a
  seam ⇒ the PAINT is the bug. Overlay is the diagnostic for all road geometry.

## CURVES — rail ≠ road (the #1 trap)
- RAIL curve = quadratic Bézier through TILE CENTRE (`Q centre`). `geometry.ts
  railPathsFor`, `pathGeometry.ts segmentPathD`.
- ROAD turn = 90° CIRCULAR ARC around the WRAPPED TILE CORNER, r=size/2, tangent
  at port edges (`A r r 0 0 sweep`). `roadSegmentPathD`, `turnCornerPoint` (=pa+pb−c).
  Centre-quad bulged into the junction box — fixed bug. Don't merge road turn → rail quad.
- ARC LENGTH not uniform: straight=size, rail curve≈0.8116×size (`curveUnitLength`),
  road turn=(π/2)(size/2)≈0.785×size (`roadSegmentLength`). Space coupled units by
  TRUE arc length (`segmentLength`/`roadSegmentLength` + `sampleAtArc`), else they
  overlap on curves. `scaleX` sprite-foreshorten was REVERTED (user hated it) —
  wrong cause. Kept: chord render (`UnitChord{front,rear}`) + `BOGIE_INSET_FRAC=0.2`.
- Constant-width road curve: offset the SAMPLED centreline ⟂ (`laneOffsetPointAt`),
  never the Bézier control point (pinches apex).
- Turn-LANE path = corner FILLET of the two lane lines (`pathGeometry.ts
  turnLaneFrame`/`turnLanePointAt`): straight-in, max arc tangent to both, straight-
  out. NOT the arc lerp(offEntry,offExit)-pushed (unequal offsets kink at seam =
  old "strange bend" on mixed-width junctions). =concentric arc when offsets equal.

## JUNCTIONS
- Lanes DERIVED by `deriveJunctionLanes` (`editOps.ts`), receiving-capacity rule:
  never more turning lanes than the dest has receiving lanes; every movement lane-
  true (no crossing arcs). idx0=kerb, high=inner. R-block kerb side, L-block inner
  side, S middle. N≥3 ⇒ inner = dedicated LEFT pocket. Dual turn shares straight
  onto the lane nearest the straight block. 1L→nL = nearest-lane landings, no fan-
  out. Capacities PER vehicle class (skip bus lanes for cars). Full table:
  `docs/superpowers/specs/2026-06-12-junction-lane-capacity-design.md`.
- Junctions NEVER lane-count-mismatch. `laneCountAt` over-counts a junction port ⇒
  naive seam check paints junctions+adjacent curves RED (recurring bug). Guard:
  `lanes.ts seamMismatch` + `game.ts roadIsJunctionAt`. Only simple curves must
  preserve lane count across a seam.
- Arm flare is REALISTIC not a defect: junction sizes turn ribbon to widest arm
  (`max(laneCountAt(a),laneCountAt(b),2)`); narrow arm into wide mouth = flare.
  Don't "fix" blind — true per-arm width = `roadCurvePolygonPath` refactor, user-watched.
- Box crossing gated by conflict-matrix arbiter (`roadArbiter.ts`, `roadJunction.ts`);
  `conflictKey` lane-indexed ⇒ parallel lanes cross independently.

## ROADS
- `LANE_WIDTH_FRAC=0.14` (`laneOffset.ts`). Same offset fns feed cars+paint+markings
  +overlay — keep lockstep.
- Bidirectional: lanes anchor to YELLOW centreline; kerb lane drops; gore
  `laneDropGore` (point upstream, widen down).
- One-way: no centreline; LEFT-ALIGN to run's widest count (`oneWayRunMaxAt`,
  `game.roadOneWayRunMax`) = motorway drop; RIGHTmost lane(s) end w/ hatched island
  (Sperrfläche)+arrows on +n. lane i offset=(i+0.5−R/2)·W. SIM UNCHANGED
  (`road.ts desiredLane` merges highest idx down). Renderer-only fork
  (`oneWayLaneOffsetPx`, `roadRibbonPolygonPath`, `oneWayClosingGore`). Centred
  symmetric squeeze = WRONG model, abandoned.
- Lane switch (G): `Car.laneIndex` is FLOAT (lateral pos); round()=occupied lane;
  eases to int `targetLane` on accepted gap; ending lane merges before taper (sim
  owns lateral motion, render taper gone).
- Approach lane discipline (`road.ts desiredLane` branch F): among the lanes that
  permit the upcoming turn (`lanesAllowingExitFor`), pick by `turnKind` — LEFT→inner
  (max idx), RIGHT/STRAIGHT→kerb (min idx). Works for both dedicated turn pockets
  (`allow` already a subset) AND unrestricted crosses (every lane permits → side is
  pure discipline). Test: `/test/lane-discipline`, `laneDiscipline.spec.ts`.
- Keep-right is delivered by F (kerb-most for straight/right on a junction APPROACH)
  + `junctionExitLane` kerb-aligning straight exits + overtake-return — NOT a blanket
  always-on kerb pull. A blanket `desiredLane` fallthrough→kerbMost RE-CREATES the
  post-junction "dip to kerb and back" (overtakeloop/fan-1→3 tests) — keep the
  fallthrough = hold `cur`.
- Vehicles are data (`vehicleSpec`): car/rigid truck/articulated semi (2 chords).
  Long bodies use full-occupancy sampling (trailer straddling a junction blocks).

## VERIFY
- `npm run build` (vue-tsc+vite) = fastest gate; `npm run test:unit` = math. Keep green.
- Every feature ships `/test/<id>` scenario (CLAUDE.md rule); registry test fails CI
  on a broken map. Debug from the scenario, not the full level.
- Visual change ⇒ `npm run shot -- <id> --label before|after` (overlay on, flat bg).
- rAF/hidden-tab: Chrome automation tab hidden ⇒ rAF paused ⇒ sim never steps (no
  cars, frozen) — env artifact. SVG geometry still inspects static. For behaviour use
  unit tests. To eyeball render: `window.__game.stop()` FIRST, then push synthetic
  entries into reactive arrays.
- `config.plainBackdrop` (🌳 BG in /test) = flat green for reading kerbs/markings/gores.

## WORKFLOW
- Trunk-based MASTER-ONLY (since 2026-06-11); develop deleted. Branch from / PR to master.
- Commit your scoped change as soon as done+green, unasked. Heavy parallel editing
  of same files (`road.ts`, `editOps.ts`, scenario `index.ts`) — stage only your
  hunks. NO AI attribution in commit msgs.
- Worktrees: node_modules usually resolves up to repo root (try tooling first). If
  junctioned, remove junction (`cmd /c rmdir`) BEFORE `git worktree remove` or it
  deletes the real install. Kill bg dev servers when done.
