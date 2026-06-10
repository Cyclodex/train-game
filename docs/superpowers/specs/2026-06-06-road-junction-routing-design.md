# Road Junction Routing & Conflict-Point Reservation

**Date:** 2026-06-06
**Status:** Approved for implementation

## Context

The road simulation (`src/sim/road.ts`) models car traffic as ambient obstacles for
level-crossing scenarios. The current junction interlock is a whole-tile mutex:
any car inside the junction box blocks every other car. This serialises movements
that do not physically conflict (e.g. two right-turners from perpendicular arms)
and prevents a 4-way cross from ever feeling lively.

This spec is Phase B of a two-phase plan:

- **Phase B (this spec):** Turn intentions + per-movement conflict reservation +
  road-priority right-of-way. Single lane per direction throughout. The
  `road: PortPair[]` structure and the car-following core are unchanged so Phase C
  can layer on top.
- **Phase C (future):** Multi-lane roads, lane-change edges, turn-lane
  pre-selection, overtaking. Builds on the conflict matrix and route planner
  defined here.

---

## Core concepts

### Movement

A **movement** is a directed path through a junction: `(entryArm: Port, exitArm: Port)`.
For a standard 4-way cross (N, E, S, W arms) with straight and crossing
connections there are up to 12 movements (4 entries × 3 exits, U-turns excluded).
The movement is the unit of reservation — not the tile.

### Conflict matrix

Two movements **conflict** if their geometric paths through the 1×1 tile box
intersect. Computed once per junction at level-load time by checking the four
canonical cases:

| Movement pair | Conflict? |
|---|---|
| Straight vs the perpendicular straight | Yes — cross dead centre |
| Left turn vs opposing straight | Yes — left crosses oncoming |
| Left turn vs near-perpendicular stream | Yes |
| Right turn vs any other | No — stays near its corner |

Stored as `Set<string>` keyed by `"entryA:exitA|entryB:exitB"` (canonical order,
lower port first). Lookup is O(1).

### Road priority

`TileCell.roadPriority?: number` — 0 = side road (default), 1 = main road.
A car entering from a higher-priority road yields to nobody and is yielded to by
cars from lower-priority roads when movements conflict.

### Car route

At spawn each car runs a BFS over the road port-graph to a randomly chosen exit
edge (any map-edge road opening that is not the spawn point). The BFS extracts the
sequence of `{ junctionCoord, exitArm }` waypoints needed to reach the target.
Stored as `Car.routePlan`. If no path exists the car falls back to picking
`partners[0]` at each junction (today's behaviour).

---

## Data model changes

### `TileCell` (`src/tiles/model.ts`)

```ts
roadPriority?: number; // 0 = side (default), 1 = main
```

### `Car` (`src/sim/road.ts`)

```ts
routePlan: RouteTurn[];   // planned turns from spawn to exit edge
routeStep: number;        // index into routePlan (advances on each junction exit)
```

```ts
interface RouteTurn {
  junctionId: string; // getCoordinatesId of the junction tile
  exitArm: Port;      // which arm to leave through
}
```

### Junction state (ephemeral inside `createRoadSim`)

```ts
interface ActiveMovement {
  carId: string;
  entryArm: Port;
  exitArm: Port;
  priority: number; // road priority of the arm the car entered from
}
// keyed by junction tile id
const activeMovements: Map<string, Set<ActiveMovement>> = new Map();
```

Derived live from car positions each tick; not persisted across ticks.
A car is "active" in a junction while any part of its body occupies that tile.

---

## Junction arbiter

A single replaceable function — the only thing that changes when traffic lights
or more complex right-of-way rules are added:

```ts
interface WaitingCar {
  entryArm: Port;
  exitArm: Port;
  priority: number;
  waitSeconds: number;
}

interface JunctionArbiter {
  canEnter(
    candidate: WaitingCar,
    active: Set<ActiveMovement>,
    waiting: WaitingCar[],       // other cars stopped at this junction's entry edges
    conflictPairs: Set<string>,
  ): boolean;
}
```

`waiting` is derived each tick by scanning all stopped cars whose next tile is this
junction. This is the list the priority-yield check uses — a car that has not yet
entered but is already queued with a conflicting movement and higher priority causes
the candidate to hold.

### Default: `fcfsWithPriorityArbiter`

1. If any active movement conflicts with the candidate's movement → **deny**.
2. If any *waiting* car at this junction has higher road priority and a conflicting
   movement → **deny** (yield to the main road).
3. **Starvation guard:** if `waitSeconds > 5` bump the candidate's effective
   priority to 999 so a permanently-busy main road cannot starve a side-road car
   forever.
4. Otherwise → **grant**.

This function lives in a new file `src/sim/roadArbiter.ts` and is injected into
`createRoadSim`. Future arbiters (traffic-light phases, custom per-junction rules)
implement the same interface.

---

## Conflict matrix computation

Computed once in `src/sim/roadJunction.ts` when the level loads:

```ts
function buildConflictMatrix(road: PortPair[]): Set<string>
```

Enumerates all connected movements from the port-pairs, then for each pair
evaluates the geometric intersection rule above. The result is memoised by the
sorted JSON of the road pairs so repeated calls for the same junction topology
are free.

---

## Route planning

```ts
function planRoute(
  level: Level,
  spawnCoord: Coordinates,
  spawnEntry: Port,
  allEntries: RoadEntry[],
  rng: () => number,
): RouteTurn[]
```

- Picks a random exit entry from `allEntries` that is not the spawn entry.
- BFS over `roadTraverse` to find the shortest path of tiles from spawn to target.
- Walks the path and records a `RouteTurn` at every junction tile (where
  `isRoadJunction` is true and more than one exit is possible).
- Returns `[]` if no path is found (fallback: today's `partners[0]` behaviour).

---

## Changes to `createRoadSim`

1. **Startup**: build the conflict matrix for every junction tile in the level once.
2. **`trySpawn`**: call `planRoute` and attach `routePlan` / `routeStep = 0` to the
   new car.
3. **`roadExitPort` (per-car override)**: when the car is at a junction and has a
   matching `routePlan` entry for this tile, return that `exitArm` instead of
   `partners[0]`.
4. **`clearAhead`**: the existing perpendicular-occupant check (which implements
   the current whole-tile mutex for junctions) is **replaced** by the arbiter
   check. A car is held at the stop line (lead ≥ 0 to junction entry) when
   `arbiter.canEnter(...)` returns false.
5. **Per-tick bookkeeping**: before the advance loop, rebuild `activeMovements` by
   inspecting which cars currently occupy junction tiles and what their
   entry/exit arms are. This is cheap (O(cars × body tiles)) and avoids stale
   reservation state.
6. **`waitingCars` map**: track how long each car has been stopped at a junction
   entry (reset on movement; passed to the arbiter for starvation guard).

The public `RoadSim` interface is unchanged. `junctionOccupancy()` continues to
expose occupied junctions for the debug renderer.

---

## Test scenarios

Two new scenarios added to `src/levels/test/scenarios/`:

### `roadjunction.ts` — multi-direction turns
A 4-way cross where cars arrive from all four arms. Verifies:
- Right-turn cars from perpendicular arms flow simultaneously.
- Straight-through cars yield correctly to each other.
- Left-turners wait for opposing straight traffic.

### `roadpriority.ts` — main road vs side road
A T-junction where a horizontal main road (`roadPriority: 1`) meets a side road
(`roadPriority: 0`). Verifies that side-road cars yield to main-road cars, and
that the starvation guard eventually lets a side-road car through after 5 s of
continuous main-road traffic.

Both scenarios are registered in `src/levels/test/index.ts` and must pass the
existing `testScenarios.spec.ts` validation suite.

---

## What is explicitly out of scope

- Multi-lane roads (Phase C).
- Traffic-light phase cycles at junctions (Phase C+).
- U-turns.
- Car-to-car overtaking.
- Editor UI for setting `roadPriority` (can be set in scenario files; a UI toggle
  is a follow-up).

---

## Verification checklist

- [ ] `npm run build` passes (vue-tsc + vite).
- [ ] `npm run test:unit` passes (coordinate math + scenario validation).
- [ ] `/test/roadjunction` scenario: perpendicular right-turners flow together;
      straights and lefts serialise correctly.
- [ ] `/test/roadpriority` scenario: side-road car yields; eventually gets through
      (starvation guard fires within 5 s of sim time).
- [ ] `/test/roadcross` existing scenario: still works (no regression on the
      original 2-stream interlock).
- [ ] `npm run test:e2e` passes.
