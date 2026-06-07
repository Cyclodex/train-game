# Multi-Lane Roads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual and simulation support for 1–3 lanes per direction on road tiles; cars occupy a specific physical lane, follow only cars in the same lane slot, and lane assignments persist across tile boundaries.

**Architecture:** The `Lane.index` field (already in the model) becomes the physical lane slot. `laneCount(road, from)` derives how many lanes exist for a given approach direction. Cars gain `laneIndex: number`; following, occupancy, and rendering all key off it.

**Tech Stack:** TypeScript 5, Vue 3, Vitest. No new dependencies. All changes are in `src/tiles/`, `src/sim/`, `src/components/Tile.vue`, `src/game.ts`, and test files.

---

## Context for implementers

- **Branch:** `worktree-road-junction-routing` (a git worktree — run `npm run build` and `npm run test:unit` from `E:\git\github\train-game\.claude\worktrees\road-junction-routing`)
- **Lane model:** `src/tiles/lanes.ts` — `Lane { from, to[], index, kind? }`. `lanesFrom(road, from)` gets all lanes for an approach. Currently every road tile uses `index: 0` only.
- **Sim:** `src/sim/road.ts` — `Car` struct has `path`, `headIndex`, `headProgress`. `clearAhead()` is the car-following / gating function. `bodyPoints(car)` returns the car's body as sample points. `sample()` returns `CarChord[]` for rendering.
- **Rendering:** `src/game.ts` calls `roadSim.sample()` and uses a fixed `LANE_OFFSET_FRAC = 0.07` to push all cars to the right side of their travel direction. This will become per-lane computed offset.
- **Tile.vue:** `roadPaths` getter calls `roadEdges(tile.road)` to get undirected edges, then passes each to `roadSurfacePath` / `roadMarkingPath`. The surface is stroked at 56px (2-lane road). This will scale with lane count.
- **Validation:** `src/tiles/validate.ts` has `validateRoads`. Already has `lane-index-clash` check; needs `lane-index-gap`.
- **Test scenarios:** `src/levels/test/scenarios/`. Add files → register in `src/levels/test/index.ts` → validated automatically by `tests/unit/levels/testScenarios.spec.ts`.
- **No AI attribution in commits.** No co-author lines.

---

## Task 1: `laneCount()` + `nWayLanes()` helpers in `lanes.ts`

**Files:**
- Modify: `src/tiles/lanes.ts`
- Test: `tests/unit/tiles/lanes.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
// in tests/unit/tiles/lanes.spec.ts — add at end of describe block
import { laneCount, nWayLanes } from "@/tiles/lanes";
import { Position } from "@/types";

describe("laneCount", () => {
  it("returns 0 for undefined/empty road", () => {
    expect(laneCount(undefined, Position.Left)).toBe(0);
    expect(laneCount([], Position.Left)).toBe(0);
  });

  it("returns 1 for a single-lane approach (index 0 only)", () => {
    const road = twoWay(Position.Left, Position.Right);
    expect(laneCount(road, Position.Left)).toBe(1);
    expect(laneCount(road, Position.Right)).toBe(1);
    expect(laneCount(road, Position.Top)).toBe(0); // no lanes from Top
  });

  it("returns N when indices 0..N-1 are all present", () => {
    const road = nWayLanes(Position.Left, Position.Right, 3);
    expect(laneCount(road, Position.Left)).toBe(3);
    expect(laneCount(road, Position.Right)).toBe(3);
  });
});

describe("nWayLanes", () => {
  it("generates count lanes per direction", () => {
    const road = nWayLanes(Position.Left, Position.Right, 2);
    // 2 lanes L->R + 2 lanes R->L = 4 total
    expect(road).toHaveLength(4);
    expect(road.filter(l => l.from === Position.Left).map(l => l.index).sort()).toEqual([0, 1]);
    expect(road.filter(l => l.from === Position.Right).map(l => l.index).sort()).toEqual([0, 1]);
  });

  it("count=1 produces the same structure as twoWay", () => {
    const a = nWayLanes(Position.Left, Position.Right, 1);
    const b = twoWay(Position.Left, Position.Right);
    expect(a).toHaveLength(2);
    expect(a[0].index).toBe(0);
    expect(a[1].index).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npm run test:unit -- --reporter=verbose tests/unit/tiles/lanes.spec.ts
```

Expected: fail with "laneCount is not a function" / "nWayLanes is not a function"

- [ ] **Step 3: Implement helpers in `lanes.ts`**

Add AFTER the `roadEdges` function, BEFORE the `isRoadJunction` function:

```ts
// The number of physical lanes for a given approach direction: max(index)+1 across
// all lanes whose `from` equals `from`. Returns 0 if no lanes enter from that port.
export function laneCount(road: Lane[] | undefined, from: Port): number {
  const lanes = lanesFrom(road, from);
  return lanes.length === 0 ? 0 : Math.max(...lanes.map(l => l.index)) + 1;
}

// Generate `count` index slots in both directions between ports `a` and `b`.
// Produces a multi-lane bidirectional road: indices 0..count-1 each way.
export function nWayLanes(a: Port, b: Port, count: number): Lane[] {
  return Array.from({ length: count }, (_, i) => [
    { from: a, to: [b], index: i },
    { from: b, to: [a], index: i },
  ]).flat();
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npm run test:unit -- --reporter=verbose tests/unit/tiles/lanes.spec.ts
```

Expected: all pass

- [ ] **Step 5: Build to verify no type errors**

```
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/tiles/lanes.ts tests/unit/tiles/lanes.spec.ts
git commit -m "feat: add laneCount() and nWayLanes() helpers to lanes.ts"
```

---

## Task 2: `lane-index-gap` validation in `validate.ts`

**Files:**
- Modify: `src/tiles/validate.ts`
- Test: `tests/unit/tiles/lanes.spec.ts` (extend existing validate section) or a new spec

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/tiles/lanes.spec.ts — add in a describe("validateRoads") block
import { validateRoads } from "@/tiles/validate";
import { nWayLanes } from "@/tiles/lanes";
import { Position } from "@/types";

describe("validateRoads — lane-index-gap", () => {
  it("flags a gap in lane indices (e.g. indices 0, 2 without 1)", () => {
    const level = {
      "0,0": {
        connections: [],
        road: [
          { from: Position.Left, to: [Position.Right], index: 0 },
          { from: Position.Left, to: [Position.Right], index: 2 }, // gap: missing index 1
          { from: Position.Right, to: [Position.Left], index: 0 },
        ],
      },
    };
    const result = validateRoads(level);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.type === "lane-index-gap")).toBe(true);
  });

  it("passes for contiguous indices 0..N-1", () => {
    const level = {
      "0,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
    };
    expect(validateRoads(level).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
npm run test:unit -- --reporter=verbose tests/unit/tiles/lanes.spec.ts
```

Expected: fail with "lane-index-gap is not a valid issue type"

- [ ] **Step 3: Add `lane-index-gap` to `RoadIssueType` and the validation loop**

In `validate.ts`, change:
```ts
export type RoadIssueType =
  | "dangling-road"
  | "lane-index-clash"
  | "lane-no-exit";
```
to:
```ts
export type RoadIssueType =
  | "dangling-road"
  | "lane-index-clash"
  | "lane-index-gap"
  | "lane-no-exit";
```

Then inside `validateRoads`, AFTER the existing `indexByFrom` loop (after `seen.add(lane.index)` line), add:

```ts
    // After the per-lane loop — check each approach for index gaps.
    for (const [key, seen] of indexByFrom) {
      const count = seen.size;
      for (let i = 0; i < count; i++) {
        if (!seen.has(i)) {
          issues.push({
            type: "lane-index-gap",
            tileId: id,
            detail: `lanes from ${Position[Number(key)]} of ${id} are missing index ${i} (present: [${[...seen].sort().join(",")}])`,
          });
        }
      }
    }
```

Note: The loop body structure in validate.ts (lines ~160-181) already groups lanes by `from` into `indexByFrom`. Insert the gap-check loop RIGHT AFTER `seen.add(lane.index)` closes (after the `}` for the per-lane loop, still inside the `for (const [id, tile] of ...)` block).

Full updated structure inside `validateRoads`:
```ts
    const indexByFrom = new Map<string, Set<number>>();
    for (const lane of road) {
      if (lane.to.length === 0) {
        issues.push({ type: "lane-no-exit", ... });
      }
      const key = String(lane.from);
      if (!indexByFrom.has(key)) indexByFrom.set(key, new Set());
      const seen = indexByFrom.get(key)!;
      if (seen.has(lane.index)) {
        issues.push({ type: "lane-index-clash", ... });
      }
      seen.add(lane.index);
    }
    // Check for index gaps after all lanes for this tile are visited.
    for (const [key, seen] of indexByFrom) {
      for (let i = 0; i < seen.size; i++) {
        if (!seen.has(i)) {
          issues.push({
            type: "lane-index-gap",
            tileId: id,
            detail: `lanes from ${Position[Number(key)]} of ${id} are missing index ${i} (present: [${[...seen].sort().join(",")}])`,
          });
        }
      }
    }
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npm run test:unit -- --reporter=verbose tests/unit/tiles/lanes.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/tiles/validate.ts tests/unit/tiles/lanes.spec.ts
git commit -m "feat: validate lane-index-gap (contiguous 0..N-1 indices required per approach)"
```

---

## Task 3: Core sim changes — `Car.laneIndex`, per-lane following, spawn, tile continuity

**Files:**
- Modify: `src/sim/road.ts`
- Test: `tests/unit/sim/road.spec.ts`

**What changes and why:**
1. `Car.laneIndex: number` — each car occupies a specific physical lane slot.
2. `bodyPoints` returns `laneIndex` so `clearAhead` can skip different-lane same-direction cars.
3. `clearAhead` car-following loop: skip `p.laneIndex !== car.laneIndex` when not perpendicular and not opposing. Without this, two cars in lanes 0 and 1 going the same way would block each other as if sharing a lane.
4. Tile transition (line ~784 in `advance`): clamp `car.laneIndex = min(laneIndex, laneCount(nextTile, entryPort) - 1)`. This is how a 2-lane car enters a 1-lane section: collapse to lane 0.
5. Spawn: pick `laneIndex` via `rng()` after `clearAhead` passes.
6. Probe car: `laneIndex: 0` (a spawn probe always checks lane 0 — conservative).
7. `CarChord` gains `laneIndex: number` and `laneCount: number` so `game.ts` can compute the per-car visual offset.
8. `sample()` returns these values.

- [ ] **Step 1: Write failing tests in `road.spec.ts`**

```ts
// Add at end of road.spec.ts

describe("createRoadSim — per-lane following", () => {
  // A 3-tile, 2-lane (per direction) straight road.
  // Cars in different lanes of the same direction must NOT follow each other.
  function twoLaneRoad(): Level {
    const road = nWayLanes(Position.Left, Position.Right, 2);
    return {
      "0,0": { connections: [], road },
      "1,0": { connections: [], road },
      "2,0": { connections: [], road },
    };
  }

  it("cars in different lanes of the same direction flow independently (no cross-lane stalling)", () => {
    const sim = createRoadSim({
      level: twoLaneRoad(),
      width: 3,
      height: 1,
      seed: 1,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 0.05, // aggressive spawn to fill both lanes fast
      carSpeed: 0.5,
      maxCars: 6,
    });

    // Run long enough for multiple cars to be in-flight simultaneously.
    let stalledTicks = 0;
    for (let i = 0; i < 400; i++) {
      sim.step(0.05, () => false);
      // Count ticks where ALL live cars are stopped (gridlock indicator).
      const cars = sim.cars();
      if (cars.length >= 2) {
        // Two cars in different lanes can each be moving even when physically side-by-side.
        const moving = cars.filter(c => c.velocity > 0.01);
        if (moving.length === 0 && cars.length >= 2) stalledTicks++;
      }
    }
    // A gridlock (all cars stopped simultaneously) is the failure mode for cross-lane
    // blocking. Some brief stalls at spawns are acceptable (< 30 ticks).
    expect(stalledTicks).toBeLessThan(30);
  });

  it("sample() includes laneIndex and laneCount fields", () => {
    const sim = createRoadSim({
      level: twoLaneRoad(),
      width: 3,
      height: 1,
      seed: 1,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 0.3,
      carSpeed: 0.5,
      maxCars: 4,
    });
    for (let i = 0; i < 100; i++) sim.step(0.1, () => false);
    const samples = sim.sample();
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(typeof s.laneIndex).toBe("number");
      expect(typeof s.laneCount).toBe("number");
      expect(s.laneIndex).toBeGreaterThanOrEqual(0);
      expect(s.laneCount).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("createRoadSim — lane merge (cross-tile continuity)", () => {
  // A 2-lane road that narrows to 1-lane.
  function mergingRoad(): Level {
    const twoLane = nWayLanes(Position.Left, Position.Right, 2);
    const oneLane = fromPairs([[Position.Left, Position.Right]]);
    return {
      "0,0": { connections: [], road: twoLane },
      "1,0": { connections: [], road: twoLane },
      "2,0": { connections: [], road: oneLane }, // narrows here
      "3,0": { connections: [], road: oneLane },
    };
  }

  it("cars entering the merge point clamp to lane 0 and keep flowing", () => {
    const sim = createRoadSim({
      level: mergingRoad(),
      width: 4,
      height: 1,
      seed: 3,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 0.4,
      carSpeed: 0.5,
      maxCars: 6,
    });
    let completed = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(0.05, () => false);
      completed += sim.cars().filter(c => c.velocity < -0.001).length; // despawned count
    }
    // With lane merging (no crash), multiple cars complete the road.
    // The sim doesn't track completed cars directly; check they keep flowing.
    const allCars = sim.cars();
    // No cars should be permanently stalled (velocity 0 on the open road).
    const stuck = allCars.filter(c => c.velocity < 0.001);
    expect(stuck.length).toBeLessThan(allCars.length); // not ALL stuck
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npm run test:unit -- --reporter=verbose tests/unit/sim/road.spec.ts
```

Expected: fail — `sample()` doesn't return `laneIndex`/`laneCount`, and `nWayLanes` may not be imported.

Add imports at top of road.spec.ts:
```ts
import { fromPairs, oneWay, turns, nWayLanes } from "@/tiles/lanes";
```

- [ ] **Step 3: Add `laneIndex` to `Car` interface in `road.ts`**

In the `Car` interface (around line 185-218), add after the `crossedCrossing` field:

```ts
  // The physical lane slot this car occupies: 0 = rightmost (kerb-side),
  // count-1 = innermost (centre-adjacent). Set at spawn; clamped at each tile
  // boundary when the next tile has fewer lanes than the current one.
  laneIndex: number;
```

- [ ] **Step 4: Add `laneIndex` + `laneCount` to `CarChord`**

Change `CarChord` (around line 237):
```ts
export interface CarChord {
  id: string;
  units: CarUnit[];
  // Lane slot this car currently occupies and count of same-direction lanes
  // on its current tile — used by game.ts to compute the visual offset.
  laneIndex: number;
  laneCount: number;
}
```

- [ ] **Step 5: Update `bodyPoints` to return `laneIndex`**

Change the function signature and return type (~line 552):
```ts
function bodyPoints(
  car: Car
): { tileId: string; entry: Port; exit: Port | null; t: number; laneIndex: number }[] {
  const pts: { tileId: string; entry: Port; exit: Port | null; t: number; laneIndex: number }[] = [];
  for (let a = 0; a < car.length; a += BODY_SAMPLE_STEP) {
    const s = sampleAtArc(car, a);
    pts.push({ tileId: getCoordinatesId(s.coord), entry: s.entryPort, exit: s.exitPort, t: s.t, laneIndex: car.laneIndex });
  }
  const tail = sampleAtArc(car, car.length);
  pts.push({ tileId: getCoordinatesId(tail.coord), entry: tail.entryPort, exit: tail.exitPort, t: tail.t, laneIndex: car.laneIndex });
  return pts;
}
```

- [ ] **Step 6: Update `clearAhead` car-following to skip different-lane same-direction cars**

In the `clearAhead` function, inside the car-following loop (around lines 658-700), the inner body-point check currently reads:

```ts
        if (proj.opposing) continue;
        if (proj.perpendicular && isRoadJunction(level[p.tileId]?.road)) {
```

Change to:

```ts
        if (proj.opposing) continue;
        // Different lane, same direction: cars travel side-by-side without blocking.
        if (!proj.perpendicular && !proj.opposing && p.laneIndex !== car.laneIndex) continue;
        if (proj.perpendicular && isRoadJunction(level[p.tileId]?.road)) {
```

- [ ] **Step 7: Clamp `car.laneIndex` at tile transitions in `advance`**

In the `advance` function, find the tile-transition code (around line 781-786):

```ts
      const nextEntry = oppositePort(exitPort);
      const nextExit =
        carExitAtConsume(car, nextCoord) ?? roadExitPort(level, nextCoord, nextEntry);
      car.path.push({ coord: nextCoord, entryPort: nextEntry, exitPort: nextExit });
      car.headIndex += 1;
      car.headProgress -= 1;
```

Add after `car.path.push(...)`:

```ts
      // Clamp lane to the capacity of the next tile (a 2-lane car entering a 1-lane
      // segment collapses to lane 0; a 1-lane car entering a 2-lane stays at 0).
      const nextLaneCount = laneCount(nextTile.road, nextEntry);
      if (nextLaneCount > 0) car.laneIndex = Math.min(car.laneIndex, nextLaneCount - 1);
```

Add `laneCount` import from `@/tiles/lanes` at the top of `road.ts`. Check the existing imports:
```ts
import { exitsFrom, isRoadJunction } from "@/tiles/lanes";
```
Change to:
```ts
import { exitsFrom, isRoadJunction, laneCount } from "@/tiles/lanes";
```

- [ ] **Step 8: Initialize `laneIndex: 0` in probe car and pick lane for spawned car**

In `trySpawn` (around line 811-880):

Probe car — add `laneIndex: 0` to the probe object literal:
```ts
    const probe: Car = {
      ...
      waitedSec: 0,
      crossedCrossing: false,
      laneIndex: 0,          // probe always checks lane 0 (conservative)
    };
```

Spawned car — add lane selection AFTER the speed draw and BEFORE `planRoute`:
```ts
    const speed = carSpeed * (1 - speedSpread + rng() * 2 * speedSpread);
    // Pick a lane: random slot within the entry tile's lane count for this approach.
    const entryLaneCount = laneCount(level[getCoordinatesId(entry.coord)]?.road, entry.entryPort);
    const chosenLane = entryLaneCount > 1 ? Math.floor(rng() * entryLaneCount) : 0;
    const routePlan = planRoute(level, entry.coord, entry.entryPort, allMapEntries, routeRng);
```

And in the car literal:
```ts
    cars.push({
      ...
      waitedSec: 0,
      crossedCrossing: false,
      laneIndex: chosenLane,
    });
```

- [ ] **Step 9: Update `sample()` to return `laneIndex` and `laneCount`**

In the `sample()` implementation (~line 943):
```ts
    sample() {
      return cars.map(c => {
        const spec = vehicleSpec(c.kind, carLength);
        const units: CarUnit[] = [];
        let lead = 0;
        for (const seg of spec.segments) {
          units.push({
            front: sampleAtArc(c, lead),
            rear: sampleAtArc(c, lead + seg.length),
            lengthTiles: seg.length,
            part: seg.part,
          });
          lead += seg.length + spec.gap;
        }
        const headSeg = c.path[c.headIndex];
        const curLaneCount = laneCount(level[getCoordinatesId(headSeg.coord)]?.road, headSeg.entryPort);
        return { id: c.id, units, laneIndex: c.laneIndex, laneCount: Math.max(1, curLaneCount) };
      });
    },
```

- [ ] **Step 10: Build to catch type errors**

```
npm run build
```

Fix any TypeScript errors (e.g., `car.laneIndex` used where Car type doesn't have it yet — should be resolved after Step 3).

- [ ] **Step 11: Run tests**

```
npm run test:unit -- --reporter=verbose tests/unit/sim/road.spec.ts
```

Expected: new per-lane tests pass.

- [ ] **Step 12: Run full test suite**

```
npm run test:unit
```

Expected: all 448+ tests pass.

- [ ] **Step 13: Commit**

```bash
git add src/sim/road.ts src/tiles/lanes.ts tests/unit/sim/road.spec.ts
git commit -m "feat: per-lane car following + laneIndex on Car + sample() lane data"
```

---

## Task 4: `conflictKey` lane-aware extension in `roadJunction.ts`

**Files:**
- Modify: `src/sim/roadJunction.ts`
- Modify: `src/sim/road.ts` (update callers)
- Test: `tests/unit/sim/roadJunction.spec.ts`

**What changes:** Extend `Movement` with optional `entryIndex?: number` (default 0) and include it in the conflict key string. This is backward-compatible (all existing callers pass index 0, giving the same keys as before). Update `clearAhead` to pass `car.laneIndex` and `p.laneIndex`.

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/sim/roadJunction.spec.ts — add after existing tests
describe("conflictKey — lane-indexed", () => {
  it("two movements from different entry arms with different lane indices have distinct keys", () => {
    const ka = conflictKey({ entry: Position.Left, entryIndex: 0, exit: Position.Right },
                           { entry: Position.Top, entryIndex: 1, exit: Position.Bottom });
    const kb = conflictKey({ entry: Position.Left, entryIndex: 0, exit: Position.Right },
                           { entry: Position.Top, entryIndex: 0, exit: Position.Bottom });
    expect(ka).not.toBe(kb);
  });

  it("is order-independent (swap a and b gives same key)", () => {
    const a = { entry: Position.Left, entryIndex: 1, exit: Position.Right };
    const b = { entry: Position.Top, entryIndex: 0, exit: Position.Bottom };
    expect(conflictKey(a, b)).toBe(conflictKey(b, a));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
npm run test:unit -- --reporter=verbose tests/unit/sim/roadJunction.spec.ts
```

- [ ] **Step 3: Update `Movement` interface and `conflictKey` in `roadJunction.ts`**

Change:
```ts
export interface Movement {
  entry: Port;
  exit: Port;
}
```
to:
```ts
export interface Movement {
  entry: Port;
  exit: Port;
  entryIndex?: number; // lane slot (default 0); included in key for multi-lane conflict resolution
}
```

Change `conflictKey`:
```ts
export function conflictKey(a: Movement, b: Movement): string {
  const ai = a.entryIndex ?? 0;
  const bi = b.entryIndex ?? 0;
  const ka = `${Position[a.entry]}[${ai}]:${Position[a.exit]}`;
  const kb = `${Position[b.entry]}[${bi}]:${Position[b.exit]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}
```

- [ ] **Step 4: Update `clearAhead` in `road.ts` to pass `car.laneIndex` and `p.laneIndex`**

Find the two `conflictKey` calls in `clearAhead`:

**Arbiter section (junction entry check):**
```ts
      const candidate: WaitingCar = {
        entryArm: myEntry,
        exitArm: myExit,
        priority: ...,
        waitSeconds: car.waitSeconds,
      };
```
No `conflictKey` call here — the arbiter uses `conflictPairs.has(conflictKey(...))` internally.

Actually looking at the arbiter section and the body-point section: `conflictKey` is called at the body-point perpendicular check (~line 690):

```ts
          conflictPairs.has(
            conflictKey(
              { entry: myEntry, exit: myExit },
              { entry: p.entry, exit: p.exit }
            )
          );
```

Update to:
```ts
          conflictPairs.has(
            conflictKey(
              { entry: myEntry, entryIndex: car.laneIndex, exit: myExit },
              { entry: p.entry, entryIndex: p.laneIndex, exit: p.exit }
            )
          );
```

- [ ] **Step 5: Verify `buildConflictMatrix` still works**

`buildConflictMatrix` calls `conflictKey` internally with `movements` that don't have `entryIndex`. Since `entryIndex` defaults to `0` (via `?? 0`), the matrix keys now encode `[0]` in the index part. Callers that previously had `conflictKey({entry, exit}, ...)` without `entryIndex` now produce keys like `Bottom[0]:Top|Left[0]:Right` instead of `Bottom:Top|Left:Right` — these are DIFFERENT strings, so the conflict check in `clearAhead` (which now passes `entryIndex`) would match correctly.

Verify: existing tests in `roadJunction.spec.ts` still pass because `buildConflictMatrix` and `conflictKey` callers are consistent.

```
npm run test:unit -- --reporter=verbose tests/unit/sim/roadJunction.spec.ts
```

- [ ] **Step 6: Run full suite**

```
npm run test:unit
```

- [ ] **Step 7: Commit**

```bash
git add src/sim/roadJunction.ts src/sim/road.ts tests/unit/sim/roadJunction.spec.ts
git commit -m "feat: extend conflictKey with optional entryIndex for lane-indexed conflict resolution"
```

---

## Task 5: `Tile.vue` — dynamic road surface width

**Files:**
- Modify: `src/components/Tile.vue`

**What changes:** `roadPaths` getter computes `totalLanes` per edge (sum of lane counts on both sides of the edge) and returns `strokeWidth` for each path. The template binds it. A 2-lane road stays at current width; a 4-lane road doubles.

**Lane width per lane = 28px** (current 56px / 2 = 28px per lane, for a 2-lane road = 1 per direction).

- [ ] **Step 1: Update `roadPaths` getter in `Tile.vue`**

Import `laneCount` at the top (alongside existing `roadEdges` import):
```ts
import { roadEdges, laneCount } from "@/tiles/lanes";
```

Change the `roadPaths` getter:
```ts
  get roadPaths(): { surface: string; marking: string; strokeWidth: number }[] {
    const size = this.config.tileSize;
    const LANE_WIDTH_PX = size * 0.14; // 28px at 200px tile — matches game.ts LANE_WIDTH_PX
    return roadEdges(this.tile.road).map(([a, b]) => {
      const lanesA = laneCount(this.tile.road, a);
      const lanesB = laneCount(this.tile.road, b);
      const totalLanes = Math.max(lanesA + lanesB, 2); // minimum 2 (1 per direction)
      return {
        surface: roadSurfacePath(a, b, size),
        marking: roadMarkingPath(a, b, size),
        strokeWidth: totalLanes * LANE_WIDTH_PX,
      };
    });
  }
```

- [ ] **Step 2: Bind `strokeWidth` in the template**

In the `<path>` for road-surface (~lines 14-19), add `:style`:
```vue
      <path
        v-for="(r, i) in roadPaths"
        :key="'rs' + i"
        :d="r.surface"
        class="road-surface"
        :style="{ strokeWidth: r.strokeWidth + 'px' }"
      />
```

The inline style overrides the CSS `stroke-width: 56px` fallback.

- [ ] **Step 3: Build**

```
npm run build
```

Expected: clean build. The `roadPaths` return type changed (added `strokeWidth`) — Vue will be happy since the template now uses it.

- [ ] **Step 4: Run unit tests**

```
npm run test:unit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Tile.vue
git commit -m "feat: scale road surface width with lane count (28px per lane)"
```

---

## Task 6: `game.ts` — per-car lane offset (replace fixed `LANE_OFFSET_FRAC`)

**Files:**
- Modify: `src/game.ts`

**What changes:** Replace the single `LANE_OFFSET_FRAC = 0.07` constant with a per-car computed offset based on `sample.laneIndex` and `sample.laneCount`. The formula keeps single-lane roads at the same offset as before.

**Formula:** `offset = (laneCount - 0.5 - laneIndex) * LANE_WIDTH_PX`

Check for single-lane (count=1, index=0): `(1 - 0.5 - 0) * LANE_WIDTH_PX = 0.5 * LANE_WIDTH_PX = 0.5 * 0.14 * tileSize = 0.07 * tileSize` ✓ (same as before)

For 2-lane (count=2):
- Lane 0 (kerb): `(2 - 0.5 - 0) * 0.14 * T = 1.5 * 0.14 * T = 0.21 * T`
- Lane 1 (inner): `(2 - 0.5 - 1) * 0.14 * T = 0.5 * 0.14 * T = 0.07 * T`

- [ ] **Step 1: Replace `LANE_OFFSET_FRAC` in `game.ts`**

Find (~line 88-93):
```ts
// How far (px at the default 200px tile) to push a car off the road centreline
// toward its right-hand side, so cars drive in the right lane instead of straddling
// the dashed centre. ...
const LANE_OFFSET_FRAC = 0.07;
```

Replace with:
```ts
// Physical width of one lane as a fraction of tile size. At 200px this is 28px.
// Multi-lane roads widen to totalLanes × LANE_WIDTH_FRAC × tileSize.
// Single-lane (count=1, index=0): offset = (1-0.5-0) × LANE_WIDTH_FRAC = 0.07 — same as before.
const LANE_WIDTH_FRAC = 0.14;
```

- [ ] **Step 2: Update `updateRoadCars` to use per-car offset**

Find the `updateRoadCars` function (~line 446). Change:
```ts
    const laneOffset = tileSize * LANE_OFFSET_FRAC;
    for (const s of samples) {
      for (let u = 0; u < s.units.length; u++) {
        const unit = s.units[u];
        const id = `${s.id}#${u}`;
        seen.add(id);
        const { x, y, angle } = positionUnit(unit as unknown as UnitChord, laneOffset);
```

to:
```ts
    for (const s of samples) {
      const laneOffset = (s.laneCount - 0.5 - s.laneIndex) * tileSize * LANE_WIDTH_FRAC;
      for (let u = 0; u < s.units.length; u++) {
        const unit = s.units[u];
        const id = `${s.id}#${u}`;
        seen.add(id);
        const { x, y, angle } = positionUnit(unit as unknown as UnitChord, laneOffset);
```

- [ ] **Step 3: Build to confirm type errors are gone**

```
npm run build
```

TypeScript will complain if `s.laneIndex` or `s.laneCount` don't exist on `CarChord` — they were added in Task 3. Verify the `CarChord` interface changes from Task 3 are present.

- [ ] **Step 4: Run tests**

```
npm run test:unit
```

- [ ] **Step 5: Commit**

```bash
git add src/game.ts
git commit -m "feat: per-car lane offset in game.ts (replaces fixed LANE_OFFSET_FRAC)"
```

---

## Task 7: Test scenarios — upgrade `roadtwolane`, add `roadmultilane` + `roadlanemerge`

**Files:**
- Modify: `src/levels/test/scenarios/roadtwolane.ts`
- Create: `src/levels/test/scenarios/roadmultilane.ts`
- Create: `src/levels/test/scenarios/roadlanemerge.ts`
- Modify: `src/levels/test/index.ts`

- [ ] **Step 1: Upgrade `roadtwolane.ts` to 2-lane-per-direction**

Replace the current content with:

```ts
import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Two-lane-per-direction road: each direction has 2 physical lanes.
// Opposing streams use opposite sides of the centre divider; same-direction cars in
// different lanes ride side-by-side without following each other.
// This upgrades the old single-lane two-way demo to exercise the full Lane.index model.
export const roadtwolane: TestScenario = {
  id: "roadtwolane",
  name: "Two-lane road: 2 lanes per direction",
  description:
    "A 2-lane-per-direction straight road open at both ends. Cars spawn from both edges and ride their own lane; same-direction cars in different lanes flow independently without stacking.",
  level: {
    "0,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "1,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "2,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "3,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "4,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
  },
  trains: {},
  size: { cols: 5, rows: 3 },
};
```

- [ ] **Step 2: Create `roadmultilane.ts`**

```ts
import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Three-lane-per-direction road: demonstrates multi-lane rendering and that
// same-direction cars in different lane slots don't block each other.
export const roadmultilane: TestScenario = {
  id: "roadmultilane",
  name: "Multi-lane road: 3 lanes per direction",
  description:
    "A 3-lane-per-direction straight road. Six parallel streams flow simultaneously; a car in lane 2 never waits behind a car in lane 0 going the same way.",
  level: {
    "0,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
    "1,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
    "2,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
    "3,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
    "4,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
  },
  trains: {},
  size: { cols: 5, rows: 3 },
  traffic: {
    spawnInterval: 0.4,
    maxCars: 16,
  },
};
```

- [ ] **Step 3: Create `roadlanemerge.ts`**

```ts
import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes, fromPairs } from "@/tiles/lanes";

// Lane merge: a 2-lane-per-direction road narrows to 1-lane-per-direction.
// A car in lane 1 clamped to lane 0 when entering the narrow section; no crash.
export const roadlanemerge: TestScenario = {
  id: "roadlanemerge",
  name: "Lane merge: 2→1 lane",
  description:
    "A 2-lane road narrows to 1 lane mid-map. Cars in lane 1 are clamped to lane 0 at the merge; traffic keeps flowing without a crash.",
  level: {
    "0,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "1,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "2,1": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) }, // 1-lane
    "3,1": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
    "4,1": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
  },
  trains: {},
  size: { cols: 5, rows: 3 },
  traffic: {
    spawnInterval: 0.5,
    maxCars: 8,
  },
};
```

- [ ] **Step 4: Register in `index.ts`**

Add imports:
```ts
import { roadmultilane } from "@/levels/test/scenarios/roadmultilane";
import { roadlanemerge } from "@/levels/test/scenarios/roadlanemerge";
```

In the Road group `scenarios` array, add after `roadtwolane`:
```ts
    scenarios: [
      carfollowing, carqueue, carcircle, carscurve,
      roadoneway, roadtwolane, roadmultilane, roadlanemerge, roadcross, roadjunction,
      rightturncross, noleftturn, roadpriority, trucks,
    ],
```

- [ ] **Step 5: Run scenario validation test**

```
npm run test:unit -- --reporter=verbose tests/unit/levels/testScenarios.spec.ts
```

Expected: all scenarios validate (connectivity, grid fit, trains-in-depots).

- [ ] **Step 6: Build**

```
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/levels/test/scenarios/roadtwolane.ts src/levels/test/scenarios/roadmultilane.ts src/levels/test/scenarios/roadlanemerge.ts src/levels/test/index.ts
git commit -m "feat: upgrade roadtwolane to 2-lane + add roadmultilane and roadlanemerge scenarios"
```

---

## Task 8: Final verification + build + full test run

- [ ] **Step 1: Run full unit test suite**

```
npm run test:unit
```

Expected: all tests pass (was 448 before; new tests add ~8 more).

- [ ] **Step 2: Build**

```
npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 3: Check scenario count is correct**

After adding `roadmultilane` and `roadlanemerge` to the Road group, the scenario count should be 20.

```
npm run test:unit -- --reporter=verbose tests/unit/levels/testScenarios.spec.ts
```

- [ ] **Step 4: Commit if any loose changes remain**

```bash
git status
# commit anything uncommitted
```

---

## Self-review checklist

Before reporting complete:

1. **`laneCount()` and `nWayLanes()` exported from `lanes.ts`** ✓
2. **`lane-index-gap` in `validate.ts`** ✓
3. **`Car.laneIndex` initialized in probe (0) and spawned car (random)** ✓
4. **`clearAhead` skips `p.laneIndex !== car.laneIndex` for non-perpendicular, non-opposing points** ✓
5. **Tile transition clamps `car.laneIndex`** ✓
6. **`CarChord.laneIndex` + `laneCount` in `sample()`** ✓
7. **`conflictKey` includes `entryIndex` in key string** ✓
8. **`Tile.vue` `roadPaths` returns `strokeWidth` per edge, bound in template** ✓
9. **`game.ts` uses per-car `laneOffset` from `LANE_WIDTH_FRAC`** ✓
10. **Three new/upgraded scenarios registered and validated** ✓
11. **Build clean, all tests pass** ✓
