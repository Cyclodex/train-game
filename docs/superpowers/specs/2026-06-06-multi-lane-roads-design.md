# Multi-Lane Roads Design (Sub-projects B + C)

**Date:** 2026-06-06
**Status:** Approved
**Depends on:** `2026-06-06-directed-lane-road-model-design.md` (sub-project A — completed)

---

## Goal

Add visual and simulation support for 1–3 lanes per direction on road tiles. Cars occupy a specific physical lane, follow only cars in the same lane slot, and lane assignments persist across tile boundaries. Lane switching is explicitly out of scope (sub-project G).

---

## Background

Sub-project A replaced `road: PortPair[]` with `road: Lane[]` where each `Lane` has `{ from, to[], index, kind? }`. The `index` field was always intended as the lane slot — this sub-project activates it.

Currently every road tile uses `index: 0` only. Cars are offset cosmetically by `LANE_OFFSET_FRAC = 0.07` but there is no per-lane sim tracking.

---

## Data Model (Option A — derive from Lane[].index)

No new fields on `TileCell`. Lane count per direction is derived:

```ts
// src/tiles/lanes.ts — new helper
export function laneCount(road: Lane[] | undefined, from: Port): number {
  const lanes = lanesFrom(road, from);
  return lanes.length === 0 ? 0 : Math.max(...lanes.map(l => l.index)) + 1;
}
```

A 2-lane bidirectional road is authored as:

```ts
road: [
  { from: L, to: [R], index: 0 },
  { from: L, to: [R], index: 1 },
  { from: R, to: [L], index: 0 },
  { from: R, to: [L], index: 1 },
]
```

New authoring helper `nWayLanes(a, b, count)` generates all N index slots in both directions:

```ts
export function nWayLanes(a: Port, b: Port, count: number): Lane[] {
  return Array.from({ length: count }, (_, i) => [
    { from: a, to: [b], index: i },
    { from: b, to: [a], index: i },
  ]).flat();
}
```

Lane count is always `max(lane.index) + 1` across all lanes sharing the same `from`. Authoring invariant: every index from 0 to N-1 must be present for a given `from` direction (validated by `validateRoads`).

---

## Simulation

### Car struct

`RoadCar` gains `laneIndex: number` (0-based, default 0 for existing spawn paths).

### Occupancy

The per-tile occupancy set becomes keyed by `(tileId, from, laneIndex)`. Two cars in the same tile but different lane slots do **not** block each other's entry permission or body-point backstop.

### Car following (`clearAhead`)

Only cars whose `(from, laneIndex)` matches the follower's current stream are considered. The `opposing` skip flag is unchanged.

### Cross-tile lane continuity

At every tile transition (segment exit), the car's lane index is clamped:

```ts
car.laneIndex = Math.min(car.laneIndex, laneCount(nextTile.road, entryPort) - 1);
```

A 2-lane car entering a 1-lane segment collapses to index 0. A 1-lane car entering a 2-lane segment stays at index 0.

### Spawn lane assignment

Each new car picks a random valid lane index for its first road segment via the existing `routeRng` stream:

```ts
const count = laneCount(tile.road, exitPort);
car.laneIndex = count > 1 ? Math.floor(routeRng() * count) : 0;
```

### Junction exit lane

When a car finishes traversing a junction tile, its lane index on the outgoing segment is:

```ts
car.laneIndex = Math.min(car.laneIndex, laneCount(outgoingTile.road, entryPort) - 1);
```

No lateral movement — the car takes the nearest valid lane in the outgoing direction.

---

## Junction Conflict Matrix

The conflict key extends from `(entry, exit)` to `(entry, entryIndex, exit)`. Two lane-movements conflict if their geometrically-offset paths intersect inside the unit tile square.

`buildConflictMatrix(road: Lane[])` iterates all `(laneA, laneB)` movement pairs and computes intersection of their offset paths. The per-lane path offset uses the same formula as rendering (see below).

`conflictKey` signature becomes:

```ts
export function conflictKey(
  a: { entry: Port; entryIndex: number; exit: Port },
  b: { entry: Port; entryIndex: number; exit: Port }
): string
```

Existing callers pass `entryIndex: 0` (single-lane behaviour preserved).

---

## Rendering

### Road surface width

```ts
// Tile.vue
const maxLanes = Math.max(
  laneCount(tile.road, Port.Left) + laneCount(tile.road, Port.Right),
  laneCount(tile.road, Port.Top) + laneCount(tile.road, Port.Bottom),
  1
);
const roadWidth = maxLanes * LANE_WIDTH_PX;
```

`LANE_WIDTH_PX` is a constant (e.g. `tileSize * 0.12`). The road surface SVG rect/path scales accordingly.

### Lane markings (SVG)

Drawn as `<line>` elements offset from the path centreline:

- **Outer edges:** solid white lines at ±`roadWidth/2`
- **Centre divider** (opposing directions): solid yellow at offset 0
- **Between same-direction lanes:** dashed white lines at intermediate offsets

### Car positioning

`LANE_OFFSET_FRAC` is replaced. The lateral offset for a car in lane `i` of `count` total lanes going in a given direction:

```ts
const laneOffset = (i - (count - 1) / 2) * LANE_WIDTH_PX;
// positive = right of travel direction (right-hand traffic)
```

`game.ts` writes this as a secondary translate perpendicular to the along-path transform. The existing `sampleTrain()` path-position sampling is unchanged; only the perpendicular offset changes.

---

## Test Scenarios

### Upgraded: `roadtwolane`

Already exists. Upgrade to use `index: 0` and `index: 1` lanes with 2 cars spawning in separate lanes — they should pass each other without conflict.

### New: `roadmultilane`

3-lane road (horizontal). Spawn 3 cars going left→right in lanes 0, 1, 2 simultaneously. None should stall. Verifies per-lane following does not block same-direction neighbours.

### New: `roadlanemerge`

2-lane road narrowing to 1-lane at a straight junction. A car in lane 1 collapses to lane 0 at the merge point. Verifies cross-tile continuity clamping.

---

## Validation

Add to `validateRoads`:

- **lane-index-gap**: for a given `from`, lane indices must be 0..N-1 with no gaps (e.g. indices `0, 2` without `1` is invalid).

---

## Out of Scope

- Lane switching mid-tile (sub-project G)
- Overtaking logic
- Pre-turn lane positioning
- Bus lanes / vehicle-class restrictions (sub-project E)
- Editor UI for authoring multi-lane tiles (future; lanes authored in scenario code for now)

---

## Files Touched

| File | Change |
|------|--------|
| `src/tiles/lanes.ts` | Add `laneCount()`, `nWayLanes()` helpers |
| `src/tiles/validate.ts` | Add `lane-index-gap` validation |
| `src/sim/road.ts` | `RoadCar.laneIndex`; per-lane occupancy; lane-aware following; spawn + junction exit lane assignment |
| `src/sim/roadJunction.ts` | Extend `conflictKey` + `buildConflictMatrix` to include `entryIndex` |
| `src/components/Tile.vue` | Road surface width; lane markings SVG |
| `src/game.ts` | Car lateral offset from `laneIndex`; remove `LANE_OFFSET_FRAC` constant |
| `src/levels/test/scenarios/roadtwolane.ts` | Upgrade to real 2-lane indexing |
| `src/levels/test/scenarios/roadmultilane.ts` | New 3-lane scenario |
| `src/levels/test/scenarios/roadlanemerge.ts` | New merge scenario |
| `src/levels/test/index.ts` | Register new scenarios |
| `tests/unit/sim/road.spec.ts` | Per-lane following, spawn, merge tests |
| `tests/unit/sim/roadJunction.spec.ts` | Multi-lane conflict matrix tests |
