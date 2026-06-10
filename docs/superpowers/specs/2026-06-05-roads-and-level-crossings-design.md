# Roads & level crossings — shared contract (design)

Status: **foundation landed** on branch `feat/roads-foundation` (2026-06-05).
This is the *seam* two parallel tracks build on. Anything in here is the agreed
interface; everything else is each track's freedom.

## Why this exists

We're adding **roads with cars** and **level crossings (Bahnübergänge)** in two
parallel tracks (see below). For the small crossing stub to later migrate into the
full road system without a rewrite, both tracks must agree on a thin data seam up
front. That seam is this document + the code already committed on this branch.

Grounded in the data-driven tile model (`src/tiles/model.ts`): a cell is
`{ connections: PortPair[], role?, signals? }`, with kind/geometry/routing all
*derived* from `connections`. Roads are the same idea on a second layer.

## The seam (already committed on this branch — do not redefine)

1. **Roads are a second layer on the cell.** `TileCell` now has an optional
   `road?: PortPair[]`, in the **same `Port` space** (Top/Right/Bottom/Left/Center)
   and using the same rotation helpers as rail. A pure road tile is
   `{ connections: [], road: [[Left, Right]] }`. A **level crossing** is a cell with
   **both** a rail pair and a road pair that geometrically cross but are *not*
   connected, e.g. `{ connections: [[Top, Bottom]], road: [[Left, Right]] }`.
2. **Derivations** (`src/tiles/model.ts`): `hasRoad(cell)` and
   `isLevelCrossing(cell)`. Roads derive geometry/routing from `road` the *same way*
   rail derives from `connections` — reuse `partnersOf`, `portsOf`,
   `connectionsToExitPort`, `rotateConnections`, etc. against the road pairs.
3. **Cars are deterministic sim actors.** A car advances along the **road
   port-graph** exactly like a train advances along the rail graph
   (`network.ts traverse()`), as `(roadSegment, progress)` with a `speed`. Cars
   live in the **headless, deterministic sim** (seedable spawns) so they stay
   unit-testable — never in animation callbacks. The renderer samples car positions
   the way `game.ts` samples train positions.
4. **The gate derives from rail reservation — no new interlocking.** A crossing is
   *closed* ⇔ its tile is reserved or occupied by a train (state `simulation.ts`
   already computes for signaling). A closed crossing holds cars via the **road
   occupancy gate** (a car never enters a closed crossing tile), mirroring the
   train occupancy gate. When the train's tail clears and the reservation releases,
   the gate opens and waiting cars proceed. Default identity stays **no crashes** —
   cars *wait*, they don't collide.
5. **Two `gameConfig` flags** (already committed): `roads` (simulate + render the
   road layer at all; default `false`, keeps the game rail-only) and `roadScoring`
   (optional, toggleable score over road traffic; independent of rendering). A game
   mode can turn roads on without scoring, or both.

## The two tracks

### Track A — Road system (background agent, ambitious/autonomous)

Owns the **full, flexible foundation** for roads as a first-class layer:

- Road geometry render (a road surface + markings layer under/around rails),
  derived from `road` pairs — sibling of `tiles/geometry.ts` rail paths.
- A **road brush in the editor** (`EditorView.vue` + `editOps.ts`), parallel to the
  rail connect tool: drag edge-dot → edge-dot to draw road pairs; click to delete.
  Live validation of road connectivity (sibling of `tiles/validate.ts`).
- **Car simulation**: a deterministic car actor system in the sim (new
  `src/sim/road.ts` or similar) — spawn policy (seedable), traversal along the road
  graph, the occupancy gate, gate-from-reservation coupling at crossings.
- Optional **road generation** in procgen (`tiles/generate.ts`) — a road or two
  with a crossing.
- The **scoring** layer behind `roadScoring` (throughput / max wait), emitting
  events like the delivery/score system does.
- Unit tests for road traversal, the gate, and crossing behaviour (TDD, like the
  signaling tests).

Freedom: car visuals, spawn/scoring formulas, how many road junction types,
multiple game modes. Stay flexible — these are config/data, not hardcoded.

### Track B — Crossing stub (built in parallel, thin, migratable)

The **smallest visible Bahnübergang** that proves the drama, on the *same seam*:

- One or two **authored crossing cells** in the default level
  (`src/levels/default.ts`) using the `road?` shape above — no editor needed.
- A handful of cars spawning at a road end, driving the authored road, holding at
  the closed gate, proceeding when it opens, despawning at the far end. May use a
  minimal internal car representation, but **reads the shared `road` data** so it
  migrates to Track A's car system by deletion, not rewrite.
- Render: the **boom barrier** (down when closed, up when open), flashing red
  lights, the Andreas cross, a road surface across the tile. SVG-drawn for the stub
  (consistent with how `Tile.vue` draws rails); real sprites later (see Assets).
- Gate state read from the sim's existing reservation/occupancy for the crossing
  tile (`isLevelCrossing` + reservation lookup) — the contract's item 4.

Explicitly throwaway-friendly: when Track A lands, the stub's authored road becomes
editor/procgen road (same data), its bespoke car loop is replaced by A's car sim,
and its render merges into the road-layer render.

## Determinism & testing (non-negotiable, matches house style)

- All car movement and gate logic in the **headless sim**, advanced by `step(dt)`,
  no DOM/animation logic. Seedable spawns. Unit tests first.
- The renderer only *draws* sampled state (`game.ts` pattern). `markRaw` any
  controller stored in reactive state (the train-game GSAP hazard).
- `npm run build` (vue-tsc) + `npm run test:unit` stay green; e2e unaffected when
  `roads: false`.

## Assets

`src/assets/railway-asssets.png` is a top-down railway sheet containing **cars**
(sedans, trucks, a police car), **boom barriers** (red/white striped), **red signal
lights**, and **road tiles**. Trains already render as PNG sprites
(`Train.vue`, `background-image: url(...)`), so cars can follow that pattern once
sprites are sliced out. No image tooling (imagemagick/sharp) is available in this
environment yet, so: **stub uses SVG-drawn cars/barriers now**; sliced PNG sprites
are a later polish pass (ask the repo owner to export specific sprites, or add
`sharp` as a dev dependency, when we get there).

## Out of scope (for now)

- Player-buildable road *junctions* with their own routing UI beyond a basic brush.
- Car-vs-car collisions / crashes (identity is "cars wait"). A scored/managed-gate
  crash mode is a later, opt-in addition (see `docs/brainstorm/02` §2.3 open Q).
- Road vehicles as cargo/economy actors.

## References

- `docs/brainstorm/02-terrain-and-tile-types.md` §2.3 (level crossings),
  `docs/brainstorm/04-world-and-atmosphere.md` §4.1 (road network).
- `docs/signaling-design.md` — the reservation/occupancy model the gate reuses.
- `src/tiles/model.ts`, `src/sim/network.ts`, `src/sim/simulation.ts`,
  `src/game.ts` — the rail patterns roads mirror.
