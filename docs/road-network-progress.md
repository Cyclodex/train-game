# Road Network — Sub-project Progress

_Last updated: 2026-06-07 (all work below is **merged to `develop`**, pushed to
`origin/develop`; `master` is intentionally far behind — we iterate on `develop`)._

The road network is the "big plan": grow the game from rail-only into a
Transport-Fever-like world where cars drive a real multi-lane road network with
lanes, turn rules, vehicle classes, and (eventually) lateral lane changes.

## Vision (ordered by dependency)

| # | Sub-project | Status |
|---|---|---|
| A | Directed lane model (`Lane { from, to[], index, kind? }`) | ✅ **Done & merged** |
| B+C | Multi-lane roads (render + sim) | ✅ **Done & merged** |
| D | Junction turn restrictions / one-way | ✅ **Done & merged** (editor authoring now real, see below) |
| E | Lane attributes / vehicle classes (bus lanes) | ✅ **Done & merged** (enforced + rendered + scenario) |
| F | Route planner v2 (lane- + restriction-aware; car destinations) | 🟡 **Partial** — cars route to destinations & obey turn bans; lane *choice* is still naive |
| G | Lane switching (overtake, pre-turn positioning, lateral changes) | ⬜ **Not started** — the main remaining behaviour |

## Where we stand

The **model + simulation foundation is complete** (A–E). Cars spawn on a directed
`Lane[]` graph, follow per-lane car-following, cross junctions through a
conflict-matrix arbiter (one-way, right-turn-only, no-left-turn all enforced and
tested), obey priority, and respect vehicle-class lanes (bus-only). The road
**renders cleanly** and the **editor can author roads** end-to-end.

### Landed since the last update (the polish + feature wave)

- **Rendering polish** (now visually solid at any lane count):
  - Constant-width road **curves** (fixed the apex pinch via a control-point
    offset factor).
  - Cars **lean into lane changes** (per-coupler lateral offset) instead of
    sliding sideways.
  - Lane dividers: tighter dash, **seam-aligned** across tiles; lane-drop
    dividers get a distinct tighter dash.
  - **Lane-drop markings**: Swiss-style open-chevron advance arrows + a **paved,
    white-hatched closure gore** on reducer tiles (3→2 / 2→1).
- **Cars density setting**: live `gameConfig.maxCars` **slider (0–100)** in both
  the play menu and the test stage; read live each spawn. Fixed a spawn bug it
  exposed (cars piling on a jammed multi-lane entry — the spawn now probes the
  lane it will actually use and skips when every lane is blocked).
- **Bus lanes (E)**: `Lane.kind` enforced; bus-tinted surface; `buslane` scenario.
- **Car destinations**: cars route to a target (not just off-map); `cardestination`
  scenario; lane-graph **debug overlay** (cyan car lanes / amber bus lanes).
- **Editor road UX**: lane-count selector (1L/2L/3L), repaint lanes, lane badge,
  persisted tool picker, mismatch tooltips. Road authoring is no longer JSON-only.
- **Robustness**: `migrateLevel()` upgrades old `PortPair[][]` localStorage to
  `Lane[]`; mismatched lane counts at non-straight seams render red.

Key files: `src/tiles/lanes.ts`, `src/tiles/roadGeometry.ts`, `src/sim/road.ts`,
`src/sim/roadRouter.ts`, `src/sim/roadArbiter.ts`, `src/sim/roadJunction.ts`,
`src/components/Tile.vue`, `src/views/EditorView.vue`.
Test scenarios (in `/test`): `roadoneway`, `roadtwolane`, `roadmultilane`,
`roadlanemerge`, `roadcross`, `roadjunction`, `rightturncross`, `noleftturn`,
`roadpriority`, `trucks`, `buslane`, `cardestination`, plus the car-traffic
demos (`carfollowing`, `carqueue`, `carcircle`, `carscurve`).

## What's next

### F — Route planner v2 (finish the partial)
Cars have destinations and obey turn bans, but **lane choice is naive** — a car
doesn't position itself in the correct lane ahead of a turn, and there's no
lane-cost in routing. Next:
- Pick the spawn/approach lane based on the *next* required turn (left-turn lane
  vs right-turn lane), not round-robin.
- Make `roadRouter` lane- and restriction-aware end-to-end (a route is a sequence
  of `(tile, lane)` not just tiles).

### G — Lane switching (the big remaining behaviour)
Lateral lane changes mid-tile: **overtaking** a slower leader, **pre-turn
positioning**, and **merging** when a lane ends (today a dropped-lane car just
queues at the taper; it should signal and merge across). This is the last piece
that makes traffic feel alive. Needs: a lane-change intent model, a gap-acceptance
check against the target lane, and the renderer already supports the lean so the
visual is mostly there.

### Beyond the lane model (game direction)
- **A road objective / game mode**: the scoring hooks exist (`roadScoring`,
  Crossing Keeper) but there's no dedicated "keep the city flowing" mode with
  win/lose. This is where the road network becomes a *game*, not a sandbox.
- **Bigger authored maps / a road generator** to exercise the network at scale.

## Open questions for the next session
- Do we push **F then G** (finish the traffic-realism arc), or pivot to a **road
  game mode** now that the sandbox looks good?
- Is per-lane routing (`(tile, lane)` paths) worth the planner rewrite, or is
  "choose lane at spawn + merge greedily" enough for the game's scale?
- Editor: is JSON import still needed, or is the visual lane authoring complete
  enough to drop it?

## History (superseded detail)
Sub-projects A and B+C were built on `worktree-road-junction-routing` and folded
into `develop` via fast-forward; that branch is no longer the source of truth.
Original specs/plans: `docs/superpowers/specs/2026-06-06-directed-lane-road-model-design.md`,
`docs/superpowers/plans/2026-06-06-{directed-lane-road-model,multi-lane-roads}.md`.
