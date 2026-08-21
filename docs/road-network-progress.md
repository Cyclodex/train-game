# Road Network — Sub-project Progress

_Last updated: 2026-07-25. All work below is **on `master`**, which is the trunk:
the repo went trunk-based master-only on 2026-06-11 and `develop` is dead (285
commits behind). Branch from and PR to `master`._

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
| F | Route planner v2 (lane- + restriction-aware; car destinations) | ✅ **Done & merged** — cars sort into the turn lane their route needs; routes target off-map exits (one-way networks route) |
| G | Lane switching (overtake, pre-turn positioning, lateral changes) | ✅ **Done & merged** — continuous lane position, gap-accepted lane changes, merge before a lane drop |
| H | Bicycles (slow vehicle kind, cycle lanes, racks, citizen travel mode) | 🚧 **Phases A+B+C+C′ done** (A+B 2026-08-05: `bike` kind + per-kind speed + `cycle` LaneKind + editor tool; C 2026-08-20: `bikerack` walk-in stalls + `BayClass "bike"` + bike-and-ride split/transfer + per-rider `BIKE_RANGE_TILES`; C′ 2026-08-21: `TravelMode "bike"`/`"bikeAndRide"`, citizens ride real bikes, the rack→platform leg walked by a real figure, `citizenbike`); shared paths (D) planned — spec: `docs/superpowers/specs/2026-08-05-bicycle-travel-mode-design.md` |

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

## Recently landed: F + G (the traffic-realism arc)

Cars now drive a **continuous lateral lane position** and change lanes with **gap
acceptance**, so traffic sorts and merges instead of queueing (`src/sim/road.ts`):

- **G — lane switching:** `Car.laneIndex` is a float (the lateral position);
  `Math.round` is the lane it occupies for following/conflict. It eases toward an
  integer `targetLane`, crossing into the next lane only when that lane has a
  clear gap ahead and behind. A car whose lane ends **merges before the taper**.
  The render-side taper is gone — the sim owns the lateral motion, so a plain
  per-lane offset gives the smooth change for free.
- **F — lane-aware routing:** cars look a few tiles ahead (`junctionAhead`) and
  move into a lane whose `to` permits their next turn (`lanesAllowingExit`),
  preferring to **spawn** in that lane. `roadExits()` makes routing destinations
  the off-map openings a car can drive *out* of, so one-way networks route.
- Demo: `turnlanes` scenario (kerb lane turns right, inner lane turns left). Plus
  the 1/2/3-lane `roadcrossNlane` scenarios. Tests: cars always merge out of a
  dropping lane; every car turns from a permitting lane; crosses never gridlock.
- Turn-lane junctions no longer false-flag as lane-count mismatches (the seam
  check is now per-port via `laneCountAt`).

## What's next (polish + game direction)

### F/G follow-ups
- **Overtaking + driver behaviour:** driver profiles (overtaker vs disciplined)
  and **same-direction (multi-lane) overtaking** are **DONE & merged** — an
  overtaker held behind a slow leader pulls into the lane to its left, passes,
  and returns, gated by gap acceptance; `overtakeFraction` is configurable;
  scenario `overtaketwolane`. Still TODO (deferred): **oncoming-lane passing** on
  1-lane-each-way roads with the distance/speed feasibility math + abort — see
  `docs/superpowers/specs/2026-06-07-overtaking-driver-behaviour-design.md` §3b.
- **Lean into the change:** DONE — the body now angles into a lane change (the
  sim tracks lateral speed and lags the rear coupler; the renderer offsets each
  coupler independently).
- **Per-`(tile, lane)` routing:** routes are still tile sequences with lane
  positioning layered on; a true lane-cost planner would handle dense turn-lane
  networks more robustly.

### Beyond the lane model (game direction)
- **A road objective / game mode**: the scoring hooks exist (`roadScoring`,
  Crossing Keeper) but there's no dedicated "keep the city flowing" mode with
  win/lose. This is where the road network becomes a *game*, not a sandbox.
- **Bigger authored maps / a road generator** to exercise the network at scale.

## Open questions for the next session
- The lane model (A–G) is **feature-complete**. The next big lever is a **road
  game mode** (a "keep the city flowing" win/lose loop over the existing scoring
  hooks) — is that the priority, or more traffic realism (overtaking) first?
- Is per-lane routing (`(tile, lane)` paths) worth the planner rewrite, or is
  "choose lane at spawn + sort on approach" enough for the game's scale?
- Editor: is JSON import still needed, or is the visual lane authoring complete
  enough to drop it?

See `docs/road-future-improvements.md` for a structured breakdown of these opportunities and a recommended priority order.

## History (superseded detail)
Sub-projects A and B+C were built on `worktree-road-junction-routing` and folded
into `develop` via fast-forward; that branch is no longer the source of truth.
Original specs/plans: `docs/superpowers/specs/2026-06-06-directed-lane-road-model-design.md`,
`docs/superpowers/plans/2026-06-06-{directed-lane-road-model,multi-lane-roads}.md`.
