# Directed Lane Road Model — Design

**Date:** 2026-06-06
**Status:** Approved (brainstorm) — pending spec review before planning
**Sub-project:** A (keystone) of the road-network vision (multi-lane roads, turn
restrictions, one-way streets, bus lanes, lane switching). See
`memory/road-network-vision.md` for the full roadmap.

## Goal

Replace the undirected road tile model (`road: PortPair[]`) with a **directed,
lane-centric model** (`road: Lane[]`). This makes direction a first-class
property, which unlocks **one-way streets** and **per-junction turn
restrictions** — the capabilities the undirected model fundamentally cannot
express (a `{Left,Bottom}` pair is a right turn from one end and a left turn from
the other).

This sub-project wires up directedness **end-to-end at one lane per direction**.
The `Lane` type can describe N lanes, but multi-lane rendering, lane-aware
simulation, and lane switching are deliberately deferred to later sub-projects.

## Why this is the keystone

Today, road direction is an *emergent* property — the simulation infers it from
which map edge a car spawned at. Nothing in the data says "this road only flows
east" or "you may not turn left here." Every downstream feature in the vision
(one-way, bus lanes, turn rules, lane switching) needs direction and lane
identity to be **stored**, not inferred. This sub-project establishes that
foundation; everything else builds on it.

## The data model

```ts
// A lane's vehicle class, for restrictions. v1 stores the field but does not
// enforce it; bus-lane / vehicle-class enforcement lands in a later sub-project.
export type LaneKind = "all" | "bus"; // extensible

// One physical lane through a tile, directed. A car enters via `from` and may
// leave by any port listed in `to` (the permitted movements from this lane).
export interface Lane {
  from: Port;        // approach edge the car enters through
  to: Port[];        // permitted exit edges (turn options); length 1 on a plain
                     // road / one-way street
  index: number;     // physical position within the `from` approach group;
                     // 0 = kerb side (rightmost in the direction of travel),
                     // increasing toward the centreline
  kind?: LaneKind;   // reserved for restrictions (later sub-project); default "all"
}
```

The tile field changes from `road?: PortPair[]` to **`road?: Lane[]`** in
`src/tiles/model.ts`. The existing `roadPriority?: number` field (junction
main/side priority) is unchanged.

### What each concept becomes

| Concept | Expressed as |
|---|---|
| Two-way single-lane street | `{from:L,to:[R],index:0}` + `{from:R,to:[L],index:0}` |
| One-way street | only the one direction's lane exists |
| Turn ban at a junction | the approach lane's `to` omits the banned exit |
| Right-turn-only cross | each approach lane lists only its right exit |
| Multi-lane (later) | additional lanes per `from`, with `index` 1, 2, … |

### Invariants (enforced by validation)

- Within one `from` approach, `index` values are **unique**.
- Every port in a lane's `to` is a **real edge** of the tile (Top/Right/Bottom/Left).
- Each `to` either **continues into a neighbour lane** (the neighbour has a lane
  whose `from` is the opposite port) or **runs off the map edge** — no lane
  dead-ends in the middle of the grid.
- A junction approach must permit **at least one exit** (`to` non-empty).

## How each consumer changes

Direction becomes explicit, so several derivations get *simpler*. Changes are
otherwise mechanical.

| Module | Change |
|---|---|
| `src/tiles/roadGeometry.ts` | The paved surface ribbon is derived from the **set of undirected edge-pairs** the lanes touch, so a two-way road renders as a single ribbon (no double-draw). At one lane per direction this renders identically to today. Multi-lane lateral offsets are deferred to sub-project B. |
| `src/sim/road.ts` `roadEntries` | A **spawn entry** is a lane whose `from` port opens onto a map edge (off-grid neighbour). An **exit** is a lane `to` running off-map. Directedness makes both exact, replacing the old "infer direction from spawn side" approach. |
| `src/sim/road.ts` `roadTraverse` / `roadExitPort` | Given an entry port, find the lane whose `from` matches; its `to` list is the legal exits. One-way and turn bans are obeyed automatically (a movement that isn't listed can't be taken). |
| `src/sim/roadJunction.ts` `buildConflictMatrix` | Expands each lane into movements (`from → each port in to`) before running the existing per-movement geometry. This expansion is the only added step; the conflict geometry is unchanged. |
| `src/sim/roadRouter.ts` `planRoute` | BFS over directed edges `from → to[]`. Automatically respects one-way and turn bans — it cannot traverse a movement the lane does not list. |
| `src/sim/road.ts` (movement) | Reads lanes for traversal and routing. At one lane per direction, behaviour is identical to today's two-lane-pass model. Lane-aware occupancy is deferred to sub-project C. |

### Lane-count-agnostic helpers

To keep the 1→N transition smooth, v1 introduces and uses a helper such as
`lanesFrom(tile, fromPort): Lane[]` (and `exitsFrom(tile, fromPort): Port[]`)
everywhere a consumer needs the lanes/exits of an approach — **instead of
assuming exactly one lane**. At one lane per direction these return a single-
element group, but callers already iterate, so adding lanes later is additive.

## Authoring and migration

This is a **big-bang replacement** — no backward-compatibility layer.

- The default level (`src/levels/default.ts`), all test-world scenarios
  (`src/levels/test/scenarios/*.ts`), and the generator (`src/tiles/generate.ts`)
  are converted to emit `Lane[]`.
- Concise authoring helpers keep scenarios readable:
  - `twoWay(a, b): Lane[]` → both directions, one lane each.
  - `oneWay(from, to): Lane` → a single directed lane.
  - `turns(from, exits: Port[], index = 0): Lane` → an approach lane with explicit
    permitted exits (for junctions / turn restrictions).
- Old `road: PortPair[]` JSON — editor exports and `localStorage` saves — is **no
  longer supported**. This is acceptable at the current development stage.

### Editor

The editor keeps working with no new UI:

- Drawing a road (drag edge-dot → edge-dot) creates a **two-way single-lane**
  road: the two lane objects. Clicking a rail to delete removes both lanes.
- UI for authoring one-way streets, per-junction turn bans, and extra lanes is
  **deferred** to a later sub-project. Until then, those are authored in scenario
  code / level JSON.

## Validation

`src/tiles/validate.ts` `validateLevel` gains road-lane checks:

- Unique `index` per `from` approach on each tile.
- Every `to` port is a real tile edge.
- Each `to` continues into a neighbour lane or runs off the map edge (no
  mid-grid lane dead-ends).
- A junction approach permits at least one exit.

These run for every test-world scenario via `tests/unit/levels/testScenarios.spec.ts`,
so a malformed migration fails CI immediately.

## Proof scenarios

Two new test-world scenarios demonstrate the capabilities this sub-project
unlocks (both at one lane per direction):

- **`roadoneway`** — a one-way street: cars flow in a single direction only;
  the opposite direction has no lane, so nothing spawns or routes against it.
- **`rightturncross`** — the right-turn-only cross: a 4-way junction where every
  approach lane lists only its right-hand exit. Cars enter from all four arms,
  all turn right, and never conflict (the property proven in
  `tests/unit/sim/roadJunction.spec.ts`). This is the demo that the undirected
  model could not express.

Each ships as one `scenarios/<id>.ts` file plus one line in
`src/levels/test/index.ts`, per the project's feature-test-world rule.

## Testing

- **Unit** (`tests/unit/`):
  - Lane helpers (`lanesFrom`, `exitsFrom`, `twoWay`, `oneWay`, `turns`).
  - `roadTraverse` / `roadExitPort` obey one-way and turn bans.
  - `roadEntries` finds directed spawn entries and exits correctly.
  - `buildConflictMatrix` from lanes produces the same movements/conflicts as the
    equivalent explicit movement set.
  - `planRoute` cannot route against a one-way lane or through a banned turn.
  - `validateLevel` rejects each invariant violation.
- **Scenario validation:** `testScenarios.spec.ts` re-validates every migrated
  map (connectivity, reachability, grid fit).
- **Build:** `npm run build` (vue-tsc + vite) must pass.
- **E2E:** `npm run test:e2e` — the default level still renders and trains/cars
  still move with no console errors.

## Forward-compatibility: 1 → N lanes

The model needs **no change** to support multiple lanes — adding a lane is purely
additive (`index` 1, 2, …). This section records what *does* change when later
sub-projects light up multi-lane, so the transition is planned rather than a
surprise:

- **Rendering (B):** the road surface widens and each lane draws at
  `offset = (index + 0.5) · laneWidth` to the right of the centreline, using a
  derived per-direction lane count.
- **Occupancy (C):** a car carries a lane identity `(from, index)` and checks only
  same-lane cars ahead; a spawned car defaults to the kerb lane (`index 0`).
- **Cross-tile continuity:** a car in lane `index k` flows into the neighbour's
  lane `index k`. **Contract for v1 and beyond: lane count is constant along a
  straight run.** A change in lane count between adjacent tiles is a lane
  merge/drop, which requires lane switching (sub-project G); validation may
  enforce the constant-count rule when multi-lane rendering lands.
- **Lane assignment / turn lanes (F, G):** which lane a car chooses (and when it
  must change lanes to reach a turn lane) is route-planner-v2 + lane-switching
  work. The data model already supports turn lanes (an approach lane whose `to`
  lists only certain exits); the assignment *logic* is deferred.

## Out of scope (later sub-projects)

- Multi-lane geometry and rendering (B).
- Lane-aware simulation: per-lane occupancy, following, cross-tile lane
  continuity (C).
- Bus-lane / vehicle-class enforcement (E).
- Route planner that chooses lanes and obeys lane restrictions (F).
- Lane switching: overtaking, pre-turn positioning, merges/drops (G).
- Editor UI for one-way, turn bans, and multi-lane authoring.
```
