# Data-driven tiles + auto-tiling editor + procedural generation

Date: 2026-06-05
Status: Approved design (pre-implementation)

## Problem

A tile's connectivity and geometry are currently encoded **twice**: once in each
Vue tile component's `initRoutes()` (to draw rails/paths) and once in the
simulation (`src/sim/topology.ts`'s `CURVE`/`INTERSECTION`/`tileExitPort`, plus
`src/sim/pathGeometry.ts`). The code comments admit it ("mirrors
TileCurve.initRoutes", "mirrors the allRoutes table"). Editing one side silently
desyncs renderer and simulation.

Secondary problems:

- Geometry is expressed two ways — a fragile string-replace DSL in
  `TileBase.getCoordinates` vs. clean numeric `segmentPathD` in the sim.
- Rotation is modelled three different ways (per-rotation route tables for
  straight/curve; switch-index shuffling for the intersection).
- Every junction shape other than the full 4-way is built by *disabling arms* of
  the complete intersection (`disabledRoutes`) — indirect and error-prone.
- The level is hand-authored, verbose (`x`/`y` duplicated in each cell,
  `component: ""` empty markers), and has no validation or tooling.

The sim/renderer **separation is correct** and stays. The fix is to share one
tile *definition* across that boundary instead of re-encoding it on each side.

## Goals

1. **One canonical tile model**, shared by sim and renderer, from which kind,
   geometry, and routing are all *derived*. Remove the duplicated tables/DSL.
2. **Collapse the four tile components into a single `Tile.vue`** that renders any
   tile from the model.
3. **Auto-tiling**: a pure rule that derives a cell's connections from its
   neighbours, so levels can be "painted" rather than hand-specified.
4. **In-browser editor** on its own route, with a tile palette.
5. **Procedural generation** of solvable levels, gated by a connectivity
   validator.
6. Existing behaviour (interlocking/reservations, signals, depot colour-match,
   pause/speed/delivery) is preserved; build + unit + e2e stay green.

Non-goals (explicitly deferred): multiplayer, level sharing/server, diagonal or
multi-track-per-cell tiles, animated editor polish, undo/redo history beyond a
single step (see Open Questions).

## Canonical model

Per-cell truth is a **set of connections**, each an unordered pair of ports over
`{N, E, S, W, Center}`. A set of *pairs* (not just a set of edges) is required so
that a cross doing only straight-throughs is distinguishable from a full
any-to-any junction, and so today's `disabledRoutes` nuance is subsumed (a T is a
cross minus some pairs).

```ts
// src/tiles/model.ts
export type Port = Position;            // reuse existing N/E/S/W/Center enum
export type PortPair = [Port, Port];    // unordered

export interface TileCell {
  connections: PortPair[];              // canonical
  role?: "depot";                       // behaviour flag (parking/colour), not a shape
  // runtime/derived (not authored): kind label, geometry, switch & signal state
}
```

Everything else is derived from `connections`:

- **Kind label** (`straight | curve | tjunction | cross | depot | dead-end |
  empty`) — for sprite selection, debug, and editor display only.
- **Geometry** — each pair → `segmentPathD(a, b, size)` (already exists) for the
  train path; rails are the same path offset by `railDistanceFromPath`. Single
  code path; the string DSL is removed.
- **Sim routing** — `tileExitPort(entry, switchState)` = the connection
  containing `entry`; when several connections share `entry` (a junction), the
  per-entry switch state selects which.

This module lives in **`src/tiles/`** and is imported by both `src/sim/*` and the
Vue components, replacing `topology.ts`'s `CURVE`/`INTERSECTION`/`tileExitPort`
internals and `TileBase`'s geometry DSL.

### Switches & signals

- A **junction** is any cell where an entry port participates in more than one
  connection. Its switch state is a map `entryPort -> chosen connection`, with a
  deterministic default derived from `connections`. The player still throws
  switches; interlocking/lock-mode logic is unchanged — it reads switch state
  from the new model instead of the old `intersectionSwitch`.
- Signals remain a per-exit-port property the sim already owns
  (`signalAspects`/`signalOverrides`); `Tile.vue` renders them when present.

## Authoring sugar + migration

Hand-authored levels use **named kinds** that expand to `connections`:

```ts
"3,1": { kind: "curve", rotation: 0 }          // -> [[N,E]] (rotated)
"1,0": { kind: "straight", rotation: 1, signals: true }
"2,3": { kind: "cross", disable: [[N,E],[N,W]] } // optional parity with disabledRoutes
"0,4": { kind: "depot", rotation: 1 }
```

- `expandKind(kind, rotation, opts) -> TileCell` is the sugar resolver.
- `App.vue`'s ~40-cell level is rewritten to this format. `x`/`y` are dropped
  (the `"x,y"` key already encodes them); empty cells are simply absent rather
  than `component: ""`.
- Depot/intersection **behaviours** (interlocking, signals, colour match) read
  the new model; their logic is not rewritten.

A thin back-compat note: the old `LevelDefinition`/`TileObject` shape is replaced,
not adapted — there is only one in-repo level and we migrate it directly.

## Single `Tile.vue`

Replaces `TileStraight.vue`, `TileCurve.vue`, `TileDepot.vue`,
`TileIntersectionComplete.vue` (all deleted, along with `TileBase.ts`'s DSL; the
base may remain as a thin shared class or be folded in).

- Renders rails/paths from derived geometry for the cell's `connections`.
- Renders signal widgets when the cell has signals (logic/markup lifted from
  today's `TileStraight`).
- Renders switch widgets when the cell is a junction (lifted from
  `TileIntersectionComplete`), including the lock-mode visual.
- Renders depot art + colour dot when `role === "depot"`.
- Click rotates in play mode; in build mode, paints/erases (see Editor).

## Auto-tiling rule

```ts
// src/tiles/autotile.ts (pure, unit-tested)
deriveConnections(self: CellInput, neighbours: NeighbourInfo): PortPair[]
```

A painted track cell links to each orthogonally-adjacent track cell, and to a
depot on the shared edge. The resulting pairing defaults to: stub for 1 edge, the
single pair for 2 edges, **full junction** (all distinct-edge pairs) for 3–4
edges. Depots are placed explicitly (not painted as track) and link on their one
outer edge. This pure function is the editor's brain and is testable on its own.

Deliberate non-connecting crossings are out of scope this pass (adjacent painted
track always connects).

## Connectivity validator

```ts
// src/tiles/validate.ts
validateLevel(level, trains): { ok: boolean; issues: Issue[] }
```

Checks: every depot reachable from the track graph; no dangling/dead-end track
(a 1-connection non-depot cell is flagged); each train's start depot and its
destination depot are connected. Used by the editor for live warnings and as the
procgen acceptance gate.

## Editor (separate route)

Introduce **`vue-router`** (not currently present) with two routes:

- `/play` — the current game screen (default).
- `/editor` — the editor: the grid plus a **tile palette** side panel.

Editor behaviour:

- Click/drag cells to paint or erase track; tiles re-derive live via
  `deriveConnections`. A depot tool places depots. A select/rotate tool cycles a
  junction's default switch and rotates depots.
- Live validation panel surfaces `validateLevel` issues.
- **Persistence**: autosave to `localStorage`; Export/Import JSON buttons for the
  level format.
- The simulation is paused while editing; entering `/play` (re)seeds the sim from
  the edited level.

## Procedural generator

```ts
// src/tiles/generate.ts
generateLevel(seed: number, opts: { width; height; depotPairs }): Level
```

Deterministic (seeded PRNG). Places colour-matched depot pairs, carves connecting
paths with occasional junctions, writes `connections`, then **rejects and retries
until `validateLevel` passes**. A "Random map" action (in the editor and/or play
controls) wires it to the running game. Reuses the same model + validator; nothing
bespoke.

## Testing

Unit (Vitest):

- `expandKind` and `deriveConnections` produce expected connections.
- Kind-label derivation from connections.
- **Geometry parity**: the derived path/rails for each legacy tile equal what the
  old components produced (guards the migration).
- `tileExitPort` over the new model matches the old `topology.ts` for all
  kinds/rotations/switches (snapshot the old behaviour first).
- `validateLevel` accepts the migrated level and rejects seeded broken levels.
- `generateLevel` output always passes `validateLevel` across many seeds.

e2e (Playwright):

- Existing assertions still pass on the migrated level (40 tiles, 2 trains leave
  depots, no console errors).
- Smoke: `/editor` paints a cell; "Random map" yields a valid playable level.

## Execution plan

The mechanical refactor (model module, sim rewire, `Tile.vue` collapse, level
migration) is the noisy part and is dispatched to a background subagent; the
editor and generator can be parallelized. Build + unit + e2e are the integration
gate kept green throughout. A detailed step-by-step plan follows in the
writing-plans phase.

## Open questions / defaults chosen

- Editor undo/redo: single-step erase only this pass; full history deferred.
- "Random map" entry point: editor for sure; also a play-screen button (default
  yes, low cost).
- Whether `TileBase` survives as a thin shared class or is fully folded into
  `Tile.vue`: decided during implementation (no behavioural impact).
