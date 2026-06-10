# Directed Lane Road Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the undirected road tile model (`road: PortPair[]`) with a directed, lane-centric model (`road: Lane[]`), wiring up one-way streets and per-junction turn restrictions end-to-end at one lane per direction.

**Architecture:** A new pure `src/tiles/lanes.ts` module owns the `Lane` type and all lane helpers. `TileCell.road` becomes `Lane[]`. Every road consumer (geometry, entries, traversal, conflict matrix, router, editor, validation) reads lanes through the helpers `exitsFrom` / `lanesFrom` / `roadPortsOf` / `laneMovements`, so they already iterate lanes and extend to multi-lane later without re-model. All existing authored levels migrate by wrapping their pair arrays in `fromPairs(...)`, which is behavior-preserving. Two new scenarios prove the new capabilities.

**Tech Stack:** Vue 3 + TypeScript 5, Vitest, Vite. `Port` is `Position` (a numeric enum). Path alias `@/` → `src/`.

**Spec:** `docs/superpowers/specs/2026-06-06-directed-lane-road-model-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/tiles/lanes.ts` | `Lane`/`LaneKind` types + pure lane helpers + `isRoadJunction` | **Create** |
| `src/tiles/model.ts` | `TileCell.road` type | Modify (field type + import) |
| `src/sim/road.ts` | `roadExitPort`, `roadTraverse`, `roadEntries`, conflict-matrix build, `forwardRoute` | Modify (read lanes) |
| `src/sim/roadJunction.ts` | `buildConflictMatrix` | Modify (accept `Lane[]`) |
| `src/sim/roadRouter.ts` | `planRoute` BFS | Modify (read lanes; import `isRoadJunction` from lanes) |
| `src/tiles/validate.ts` | `validateRoads` + new lane invariants | Modify |
| `src/components/Tile.vue` | `roadPaths` render getter | Modify (dedupe undirected edges) |
| `src/tiles/editOps.ts` | road edit reducers | Modify (edge ⇒ two-way lanes) |
| `src/levels/default.ts`, `src/levels/test/scenarios/*.ts` (10 files) | authored road data | Modify (wrap in `fromPairs`) |
| `src/levels/test/scenarios/roadoneway.ts` | one-way proof scenario | **Create** |
| `src/levels/test/scenarios/rightturncross.ts` | right-turn-only proof scenario | **Create** |
| `src/levels/test/index.ts` | scenario registry | Modify (register 2 new) |
| `tests/unit/tiles/lanes.spec.ts` | lane helper unit tests | **Create** |

---

## Task 1: The `lanes.ts` module (types + pure helpers)

This task is fully standalone — it adds a new file and does not touch the `road` field yet, so the build stays green.

**Files:**
- Create: `src/tiles/lanes.ts`
- Test: `tests/unit/tiles/lanes.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/tiles/lanes.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import {
  Lane,
  fromPairs,
  oneWay,
  twoWay,
  turns,
  lanesFrom,
  exitsFrom,
  roadPortsOf,
  laneMovements,
  isRoadJunction,
} from "@/tiles/lanes";

const { Top: T, Right: R, Bottom: B, Left: L } = Position;

describe("lane authoring helpers", () => {
  it("oneWay makes a single directed lane", () => {
    expect(oneWay(L, R)).toEqual({ from: L, to: [R], index: 0 });
  });

  it("twoWay makes one lane each direction", () => {
    expect(twoWay(L, R)).toEqual([
      { from: L, to: [R], index: 0 },
      { from: R, to: [L], index: 0 },
    ]);
  });

  it("turns makes an approach lane with explicit exits", () => {
    expect(turns(L, [R, B])).toEqual({ from: L, to: [R, B], index: 0 });
    expect(turns(L, [B], 1)).toEqual({ from: L, to: [B], index: 1 });
  });

  it("fromPairs builds one lane per approach with all its partners (behaviour-preserving)", () => {
    // A 4-way cross: every port reaches the other three.
    const lanes = fromPairs([
      [L, R],
      [T, B],
      [L, T],
      [L, B],
      [R, T],
      [R, B],
    ]);
    // One lane per `from` port, index 0, listing every partner.
    expect(lanes).toContainEqual({ from: L, to: [R, T, B], index: 0 });
    expect(lanes).toContainEqual({ from: R, to: [L, T, B], index: 0 });
    expect(lanes.filter(l => l.from === L)).toHaveLength(1); // unique index per approach
  });
});

describe("lane query helpers", () => {
  const cross: Lane[] = fromPairs([
    [L, R],
    [T, B],
    [L, T],
  ]);

  it("lanesFrom returns the lanes of one approach", () => {
    expect(lanesFrom(cross, L)).toEqual([{ from: L, to: [R, T], index: 0 }]);
    expect(lanesFrom(undefined, L)).toEqual([]);
  });

  it("exitsFrom returns the union of permitted exits from a port", () => {
    expect(exitsFrom(cross, L).sort()).toEqual([R, T].sort());
    expect(exitsFrom(cross, B)).toEqual([T]); // only T<->B pair touches B
  });

  it("roadPortsOf returns every port the road touches", () => {
    expect(roadPortsOf(cross).sort()).toEqual([T, R, B, L].sort());
    expect(roadPortsOf(undefined)).toEqual([]);
  });

  it("laneMovements expands each lane into directed from->to movements", () => {
    const oneway: Lane[] = [turns(L, [R, B])];
    expect(laneMovements(oneway)).toEqual([
      { from: L, to: R },
      { from: L, to: B },
    ]);
  });
});

describe("isRoadJunction", () => {
  it("is true when the road touches more than two ports", () => {
    expect(isRoadJunction(fromPairs([[L, R], [L, T]]))).toBe(true); // T-junction
  });
  it("is false for a straight or one-way road", () => {
    expect(isRoadJunction(twoWay(L, R))).toBe(false);
    expect(isRoadJunction([oneWay(L, R)])).toBe(false);
  });
  it("is false for undefined / empty", () => {
    expect(isRoadJunction(undefined)).toBe(false);
    expect(isRoadJunction([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/tiles/lanes.spec.ts`
Expected: FAIL — `Cannot find module '@/tiles/lanes'`.

- [ ] **Step 3: Implement `src/tiles/lanes.ts`**

```ts
import type { Port } from "@/tiles/model";

// A lane's vehicle class, for restrictions. v1 stores the field but does not
// enforce it; bus-lane / vehicle-class enforcement lands in a later sub-project.
export type LaneKind = "all" | "bus"; // extensible

// One physical lane through a tile, directed. A car enters via `from` and may
// leave by any port listed in `to` (the permitted movements from this lane).
export interface Lane {
  from: Port; // approach edge the car enters through
  to: Port[]; // permitted exit edges (turn options); length 1 on a plain road / one-way
  index: number; // physical position within the `from` approach, 0 = kerb side
  kind?: LaneKind; // reserved for restrictions; default "all"
}

// --- Authoring helpers -------------------------------------------------------

// A single directed lane (one-way / one movement).
export function oneWay(from: Port, to: Port): Lane {
  return { from, to: [to], index: 0 };
}

// An approach lane with explicitly-listed permitted exits (turns / turn bans).
export function turns(from: Port, exits: Port[], index = 0): Lane {
  return { from, to: exits, index };
}

// A two-way single-lane road between two ports (one lane each direction).
export function twoWay(a: Port, b: Port): Lane[] {
  return [oneWay(a, b), oneWay(b, a)];
}

// Build the canonical lane set from undirected port pairs: one lane per approach
// port whose `to` is every partner of that port. This preserves the old
// undirected behaviour exactly (every pair is traversable both ways) while
// producing valid lanes (a single index-0 lane per approach). Used to migrate
// existing authored levels and to author plain two-way roads/junctions.
export function fromPairs(pairs: [Port, Port][]): Lane[] {
  const exits = new Map<Port, Set<Port>>();
  const add = (a: Port, b: Port) => {
    if (!exits.has(a)) exits.set(a, new Set());
    exits.get(a)!.add(b);
  };
  for (const [a, b] of pairs) {
    add(a, b);
    add(b, a);
  }
  return [...exits.entries()].map(([from, set]) => ({
    from,
    to: [...set],
    index: 0,
  }));
}

// --- Query helpers -----------------------------------------------------------

// The lanes of one approach (entering through `from`). Lane-count-agnostic: at
// one lane per direction this is a single-element array, but callers iterate so
// adding lanes later is additive.
export function lanesFrom(road: Lane[] | undefined, from: Port): Lane[] {
  return (road ?? []).filter(l => l.from === from);
}

// The union of permitted exit ports from an approach (across all its lanes).
export function exitsFrom(road: Lane[] | undefined, from: Port): Port[] {
  const out = new Set<Port>();
  for (const lane of lanesFrom(road, from)) for (const to of lane.to) out.add(to);
  return [...out];
}

// Every port the road touches (as an approach or an exit).
export function roadPortsOf(road: Lane[] | undefined): Port[] {
  const out = new Set<Port>();
  for (const lane of road ?? []) {
    out.add(lane.from);
    for (const to of lane.to) out.add(to);
  }
  return [...out];
}

// Expand the road into directed movements (one per lane × permitted exit),
// deduplicated. Feeds the junction conflict matrix.
export function laneMovements(
  road: Lane[] | undefined
): { from: Port; to: Port }[] {
  const seen = new Set<string>();
  const out: { from: Port; to: Port }[] = [];
  for (const lane of road ?? []) {
    for (const to of lane.to) {
      const key = `${lane.from}:${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from: lane.from, to });
    }
  }
  return out;
}

// A road junction is a tile whose road touches more than two ports (so a car has
// a real routing choice / streams cross). Straights and one-ways touch exactly
// two ports.
export function isRoadJunction(road: Lane[] | undefined): boolean {
  return roadPortsOf(road).length > 2;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/tiles/lanes.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Verify the build still compiles**

Run: `npm run build`
Expected: `✓ built` with no type errors (the new module is self-contained).

- [ ] **Step 6: Commit**

```bash
git add src/tiles/lanes.ts tests/unit/tiles/lanes.spec.ts
git commit -m "feat: directed Lane type + pure lane helpers"
```

---

## Task 2: Flip `TileCell.road` to `Lane[]` and migrate every consumer + all data

This task is **intentionally atomic**: changing the field type breaks every road consumer and every authored level at once, so they must all land together for the build to compile. Work through the steps, then build + run the whole suite once at the end. There is one commit.

**Files:**
- Modify: `src/tiles/model.ts`, `src/sim/road.ts`, `src/sim/roadJunction.ts`, `src/sim/roadRouter.ts`, `src/tiles/validate.ts`, `src/components/Tile.vue`, `src/tiles/editOps.ts`
- Modify (data): `src/levels/default.ts` and `src/levels/test/scenarios/{carfollowing,carqueue,crossing,keepcrossingclear,roadcross,roadjunction,roadpriority,roadtwolane,trucks}.ts`

- [ ] **Step 1: Change the field type in `src/tiles/model.ts`**

At the top, add the import (type-only to avoid a runtime cycle):

```ts
import type { Lane } from "./lanes";
```

Change the `road` field on `TileCell` from:

```ts
  road?: PortPair[];
```

to:

```ts
  road?: Lane[];
```

Leave `PortPair`, `partnersOf`, `portsOf`, `samePair` in place — they remain the rail `connections` API.

- [ ] **Step 2: Rewrite the road readers in `src/sim/road.ts`**

Update the imports near the top. Change:

```ts
import { Level, PortPair, isLevelCrossing, partnersOf } from "@/tiles/model";
```

to:

```ts
import { Level, isLevelCrossing } from "@/tiles/model";
import { exitsFrom, isRoadJunction } from "@/tiles/lanes";
```

Delete the local `isRoadJunction` function (it now lives in `lanes.ts`; the import above replaces it).

Replace `roadExitPort` with:

```ts
function roadExitPort(level: Level, coord: Coordinates, entryPort: Port): Port | null {
  const tile = level[getCoordinatesId(coord)];
  if (!tile || !tile.road || tile.road.length === 0) return null;
  const exits = exitsFrom(tile.road, entryPort);
  if (exits.length === 0) return null;
  // Single exit (straight/curve/one-way) — or pick the first for a junction.
  return exits[0];
}
```

In `roadTraverse`, replace the "next tile carries road back" guard:

```ts
  if (partnersOf(nextTile.road, oppositePort(exitPort)).length === 0)
    return { exitPort, next: null };
```

with:

```ts
  if (exitsFrom(nextTile.road, oppositePort(exitPort)).length === 0)
    return { exitPort, next: null };
```

In `roadEntries`, replace the per-port guard and the neighbour-road check. Change:

```ts
      if (partnersOf(tile.road, port).length === 0) continue;
```

to:

```ts
      if (exitsFrom(tile.road, port).length === 0) continue;
```

and change:

```ts
      const neighRoad =
        !offGrid && neigh?.road && partnersOf(neigh.road, oppositePort(port)).length > 0;
```

to:

```ts
      const neighRoad =
        !offGrid && neigh?.road && exitsFrom(neigh.road, oppositePort(port)).length > 0;
```

In `forwardRoute`, replace:

```ts
      const exits = tile?.road ? partnersOf(tile.road, entry) : [];
```

with:

```ts
      const exits = exitsFrom(tile?.road, entry);
```

There are **two more** identical "next tile carries road back" guards — one in `forwardRoute` (the look-ahead continuation) and one in `advance` (the path-extension step). Both read:

```ts
      if (
        !nextTile?.road?.length ||
        partnersOf(nextTile.road, oppositePort(exitPort)).length === 0
      )
```

Replace the `partnersOf(...)` call in **both** with `exitsFrom(...)`:

```ts
      if (
        !nextTile?.road?.length ||
        exitsFrom(nextTile.road, oppositePort(exitPort)).length === 0
      )
```

After these edits, grep the file to confirm `partnersOf` no longer appears in `src/sim/road.ts` (so removing it from the import in this step leaves no dangling reference): `grep -n partnersOf src/sim/road.ts` should print nothing.

In `createRoadSim`, the conflict-matrix precompute already calls `buildConflictMatrix(tile.road!)` — leave it (Task 2 Step 4 makes `buildConflictMatrix` accept `Lane[]`).

- [ ] **Step 3: Make `buildConflictMatrix` accept `Lane[]` in `src/sim/roadJunction.ts`**

Change the import line:

```ts
import { PortPair } from "@/tiles/model";
```

to:

```ts
import { Lane, laneMovements } from "@/tiles/lanes";
```

Replace `buildConflictMatrix` with:

```ts
export function buildConflictMatrix(road: Lane[]): Set<string> {
  // Directed movements from the lanes (from -> each permitted exit).
  const movements: Movement[] = laneMovements(road).map(m => ({
    entry: m.from,
    exit: m.to,
  }));

  const matrix = new Set<string>();
  for (let i = 0; i < movements.length; i++) {
    for (let j = i + 1; j < movements.length; j++) {
      if (movementsConflict(movements[i], movements[j])) {
        matrix.add(conflictKey(movements[i], movements[j]));
      }
    }
  }
  return matrix;
}
```

(The old version's manual de-dup loop is no longer needed — `laneMovements` already deduplicates.)

- [ ] **Step 4: Rewrite the BFS readers in `src/sim/roadRouter.ts`**

Change the imports. Replace:

```ts
import { Level, partnersOf } from "@/tiles/model";
```
```ts
import { RoadEntry, isRoadJunction } from "./road";
```

with:

```ts
import { Level } from "@/tiles/model";
import { exitsFrom, isRoadJunction } from "@/tiles/lanes";
import { RoadEntry } from "./road";
```

Replace the exit lookup:

```ts
    const exits = partnersOf(tile.road, node.entryPort);
```

with:

```ts
    const exits = exitsFrom(tile.road, node.entryPort);
```

Replace the `connectedBack` check:

```ts
      const connectedBack =
        nextTile?.road &&
        partnersOf(nextTile.road, oppositePort(exitPort)).length > 0;
```

with:

```ts
      const connectedBack =
        nextTile?.road &&
        exitsFrom(nextTile.road, oppositePort(exitPort)).length > 0;
```

`isRoadJunction` in `extractTurns` now resolves to the lanes version via the new import — no other change.

- [ ] **Step 5: Re-export `isRoadJunction` from `src/sim/road.ts` for existing importers**

Other modules import `isRoadJunction` from `@/sim/road`. Keep that working by re-exporting. Add near the other exports in `src/sim/road.ts`:

```ts
export { isRoadJunction } from "@/tiles/lanes";
```

(Remove this line's target only if no importer references it — `tests/unit/sim/roadJunction.spec.ts` and `Tile.vue` may; re-exporting is the safe, DRY choice.)

- [ ] **Step 6: Update validation readers in `src/tiles/validate.ts`**

Add the import:

```ts
import { roadPortsOf } from "@/tiles/lanes";
```

In `validateRoads`, replace:

```ts
    const edges = portsOf(road).filter(p => p !== Position.Center);
```

with:

```ts
    const edges = roadPortsOf(road).filter(p => p !== Position.Center);
```

and replace:

```ts
      const back = portsOf(nt.road ?? []).includes(oppositePort(e));
```

with:

```ts
      const back = roadPortsOf(nt.road).includes(oppositePort(e));
```

(`road` here is now `Lane[]`; `portsOf` stays imported for rail use elsewhere in the file.)

- [ ] **Step 7: Update the render getter in `src/components/Tile.vue`**

Replace the `roadPaths` getter with a version that dedupes the undirected edges the lanes touch (so a two-way road draws one ribbon, not two):

```ts
  // Road surface + lane-marking paths, one per undirected edge the lanes touch
  // (a two-way road is one ribbon, not two). At one lane per direction this
  // renders identically to the old PortPair-based version.
  get roadPaths(): { surface: string; marking: string }[] {
    const size = this.config.tileSize;
    const seen = new Set<string>();
    const out: { surface: string; marking: string }[] = [];
    for (const lane of this.tile.road ?? []) {
      for (const to of lane.to) {
        const key = lane.from < to ? `${lane.from}-${to}` : `${to}-${lane.from}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          surface: roadSurfacePath(lane.from, to, size),
          marking: roadMarkingPath(lane.from, to, size),
        });
      }
    }
    return out;
  }
```

- [ ] **Step 8: Rewrite the road edit reducers in `src/tiles/editOps.ts`**

The editor authors two-way single-lane roads; an undirected edge `(a,b)` maps to the movements `a→b` and `b→a` on the index-0 lanes. Replace the three road reducers (the `toggleRoad` / `ensureRoad` / `removeRoad` block) with:

```ts
// The road layer (`cell.road`) is a directed lane list. The editor authors plain
// two-way single-lane roads: an undirected edge (a,b) is the two movements a->b
// and b->a on the index-0 approach lanes. Junctions form when a tile accumulates
// several edges (an approach lane then carries several permitted exits).
import type { Lane } from "./lanes";

function upsertMovement(road: Lane[], from: Port, to: Port): Lane[] {
  const lane = road.find(l => l.from === from && l.index === 0);
  if (lane) {
    if (lane.to.includes(to)) return road;
    return road.map(l => (l === lane ? { ...l, to: [...l.to, to] } : l));
  }
  return [...road, { from, to: [to], index: 0 }];
}

function dropMovement(road: Lane[], from: Port, to: Port): Lane[] {
  return road
    .map(l => (l.from === from ? { ...l, to: l.to.filter(t => t !== to) } : l))
    .filter(l => l.to.length > 0);
}

function hasEdge(road: Lane[], a: Port, b: Port): boolean {
  const ab = road.some(l => l.from === a && l.to.includes(b));
  const ba = road.some(l => l.from === b && l.to.includes(a));
  return ab && ba;
}

// Add the two-way edge if absent, remove it if already present.
export function toggleRoad(cell: TileCell, pair: PortPair): TileCell {
  const [a, b] = pair;
  const road = cell.road ?? [];
  if (hasEdge(road, a, b)) {
    return { ...cell, road: dropMovement(dropMovement(road, a, b), b, a) };
  }
  return { ...cell, road: upsertMovement(upsertMovement(road, a, b), b, a) };
}

// Ensure the two-way edge is present without ever removing one (idempotent) —
// used while dragging a road so re-crossing a tile forms a junction.
export function ensureRoad(cell: TileCell, pair: PortPair): TileCell {
  const [a, b] = pair;
  const road = cell.road ?? [];
  return { ...cell, road: upsertMovement(upsertMovement(road, a, b), b, a) };
}

// Remove the two-way edge (both movements) if present.
export function removeRoad(cell: TileCell, pair: PortPair): TileCell {
  const [a, b] = pair;
  const road = cell.road ?? [];
  return { ...cell, road: dropMovement(dropMovement(road, a, b), b, a) };
}
```

Remove the now-unused `samePair` import from this file **only if** nothing else in `editOps.ts` uses it (rail reducers may still use it — check before deleting).

- [ ] **Step 9: Migrate all authored level data to `fromPairs`**

Each scenario file defines a local `road` helper or inlines `road: [[...]]`. Convert every road pair-array to lanes with `fromPairs`.

For the files that define a local helper `const road = (...ports) => ({ connections: [], road: ports })` (`roadcross.ts`, `roadtwolane.ts`, `roadjunction.ts`), change the helper to:

```ts
import { fromPairs } from "@/tiles/lanes";
const road = (...ports: [Position, Position][]) => ({
  connections: [],
  road: fromPairs(ports),
});
```

For `roadpriority.ts` (helper carries priority), change to:

```ts
import { fromPairs } from "@/tiles/lanes";
const road = (priority: number, ...ports: [Position, Position][]) => ({
  connections: [] as [Position, Position][],
  road: fromPairs(ports),
  roadPriority: priority,
});
```

For files that inline a `road:` field (`carfollowing.ts`, `carqueue.ts`, `crossing.ts`, `keepcrossingclear.ts`, `trucks.ts`, `src/levels/default.ts`), add `import { fromPairs } from "@/tiles/lanes";` and wrap each occurrence: a tile written as `road: [[Position.Left, Position.Right]]` becomes `road: fromPairs([[Position.Left, Position.Right]])`. Apply this identical transform to every `road: [ ... ]` literal in those files. (Grep each file for `road:` to find them all.)

- [ ] **Step 10: Build and verify the whole suite is green**

Run: `npm run build`
Expected: `✓ built`, no type errors.

Run: `npx vitest run`
Expected: all tests pass. The conflict-matrix tests in `tests/unit/sim/roadJunction.spec.ts` call `buildConflictMatrix` — they pass `[Position, Position][]` pair arrays today, so update those call sites to wrap in `fromPairs(...)` if they fail to type-check (e.g. `buildConflictMatrix(fromPairs([[T, B], [L, R]]))`). The behavioural road tests must stay green because `fromPairs` preserves the old movement set exactly.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: directed Lane[] road model — flip field + migrate all consumers and levels"
```

---

## Task 3: One-way street proof scenario

**Files:**
- Create: `src/levels/test/scenarios/roadoneway.ts`
- Modify: `src/levels/test/index.ts`
- Test: `tests/unit/sim/road.spec.ts`

- [ ] **Step 1: Write the failing behavioural test**

In `tests/unit/sim/road.spec.ts` (which already imports `createRoadSim`, `Level`, `Position`), add the `import` with the other imports at the **top** of the file, and append the `describe` block at the **end**:

```ts
// add to the import block at the top:
import { oneWay } from "@/tiles/lanes";

// append at the end:
describe("createRoadSim — one-way street", () => {
  it("only ever carries cars in the permitted direction", () => {
    // A straight road whose lanes only go east (Left -> Right). No westbound lane
    // exists, so no car can spawn at or route to the west-flowing direction.
    const lvl: Level = {
      "0,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
      "1,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
      "2,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 5,
      spawnInterval: 0.3,
      carLength: 0.2,
    });
    let everSeen = false;
    for (let i = 0; i < 400; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        everSeen = true;
        // Every car's head entered its tile from the Left (travelling east).
        expect(c.units[0].front.entryPort).toBe(Position.Left);
      }
    }
    expect(everSeen).toBe(true); // cars really did spawn and drive
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/sim/road.spec.ts -t "one-way street"`
Expected: FAIL — the scenario import/used helpers exist, but if anything regressed in routing the direction assertion catches it. (If `oneWay` import is missing it fails to resolve.)

Note: this test does not depend on the scenario file; it directly builds the level. It will pass once the model behaves correctly — run it now to confirm the directed model already forbids westbound cars after Task 2.

- [ ] **Step 3: Create the scenario `src/levels/test/scenarios/roadoneway.ts`**

```ts
import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { oneWay } from "@/tiles/lanes";

// One-way street: every tile carries a single eastbound lane (Left -> Right).
// There is no westbound lane, so cars only ever flow east — the first capability
// the directed model unlocks that the undirected one could not express.
export const roadoneway: TestScenario = {
  id: "roadoneway",
  name: "One-way street",
  description:
    "A one-way road: every tile has a single Left→Right lane, so traffic only ever flows east. Nothing spawns or routes against it.",
  level: {
    "0,1": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    "1,1": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    "2,1": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    "3,1": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    "4,1": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
  },
  trains: {},
  size: { cols: 5, rows: 3 },
};
```

- [ ] **Step 4: Register it in `src/levels/test/index.ts`**

Add the import alongside the other road scenarios:

```ts
import { roadoneway } from "@/levels/test/scenarios/roadoneway";
```

and add `roadoneway,` to the `SCENARIOS` array, just before `roadtwolane`.

- [ ] **Step 5: Run the scenario validation + behavioural test**

Run: `npx vitest run tests/unit/levels/testScenarios.spec.ts tests/unit/sim/road.spec.ts`
Expected: PASS (the new scenario validates; the one-way behaviour holds).

- [ ] **Step 6: Commit**

```bash
git add src/levels/test/scenarios/roadoneway.ts src/levels/test/index.ts tests/unit/sim/road.spec.ts
git commit -m "feat: one-way street scenario + directed-flow test"
```

---

## Task 4: Right-turn-only cross proof scenario

**Files:**
- Create: `src/levels/test/scenarios/rightturncross.ts`
- Modify: `src/levels/test/index.ts`
- Test: `tests/unit/sim/road.spec.ts`

- [ ] **Step 1: Write the failing behavioural test**

In `tests/unit/sim/road.spec.ts`, add the `import` with the other imports at the **top**, and append the `describe` block at the **end**:

```ts
// add to the import block at the top:
import { turns } from "@/tiles/lanes";

// append at the end:
describe("createRoadSim — right-turn-only cross", () => {
  it("lets all four arms flow simultaneously with no banned movement taken", () => {
    // Centre permits only the four right turns; each approach arm is two-way so
    // cars can enter from every edge. The right turns never conflict, so traffic
    // from all four arms flows without the arbiter ever needing to hold one back.
    const { Top: T, Right: R, Bottom: B, Left: L } = Position;
    const sa = (...lanes: ReturnType<typeof turns>[]) => ({ connections: [], road: lanes });
    const straight = (a: Position, b: Position) => ({
      connections: [],
      road: [turns(a, [b]), turns(b, [a])],
    });
    const lvl: Level = {
      "0,2": straight(L, R),
      "1,2": straight(L, R),
      "3,2": straight(L, R),
      "4,2": straight(L, R),
      "2,0": straight(T, B),
      "2,1": straight(T, B),
      "2,3": straight(T, B),
      "2,4": straight(T, B),
      // Right-turn-only centre: Left->Bottom, Bottom->Right, Right->Top, Top->Left.
      "2,2": sa(turns(L, [B]), turns(B, [R]), turns(R, [T]), turns(T, [L])),
    };
    const sim = createRoadSim({
      level: lvl,
      width: 5,
      height: 5,
      seed: 7,
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 12,
    });
    let prev = new Set<string>();
    let completed = 0;
    for (let i = 0; i < 1200; i++) {
      sim.step(0.05, () => false);
      const now = new Set(sim.cars().map(c => c.id));
      for (const id of prev) if (!now.has(id)) completed++;
      prev = now;
    }
    // Cars keep clearing the cross from the four right-turn streams — no deadlock.
    expect(completed).toBeGreaterThan(8);
  });
});
```

- [ ] **Step 2: Run to verify it fails (or passes) honestly**

Run: `npx vitest run tests/unit/sim/road.spec.ts -t "right-turn-only cross"`
Expected: PASS if the directed model + arbiter handle it (right turns never conflict — proven in `roadJunction.spec.ts`). If it fails, the failure pinpoints a routing/arbiter regression to fix before continuing.

- [ ] **Step 3: Create the scenario `src/levels/test/scenarios/rightturncross.ts`**

```ts
import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { turns } from "@/tiles/lanes";

const { Top: T, Right: R, Bottom: B, Left: L } = Position;

// Right-turn-only cross: cars enter from all four arms but the centre permits
// only the four right turns (Left→Bottom, Bottom→Right, Right→Top, Top→Left).
// Right turns never cross each other, so all four streams flow at once with no
// conflict — the turn-restriction capability the undirected model could not
// express. Arms are two-way so cars arrive from every edge.
const straight = (a: Position, b: Position) => ({
  connections: [],
  road: [turns(a, [b]), turns(b, [a])],
});

export const rightturncross: TestScenario = {
  id: "rightturncross",
  name: "Right-turn-only cross",
  description:
    "A 4-way cross where every approach may only turn right. Cars enter from all four arms and never conflict — the junction needs no signals and never blocks.",
  level: {
    "0,2": straight(L, R),
    "1,2": straight(L, R),
    "3,2": straight(L, R),
    "4,2": straight(L, R),
    "2,0": straight(T, B),
    "2,1": straight(T, B),
    "2,3": straight(T, B),
    "2,4": straight(T, B),
    "2,2": { connections: [], road: [turns(L, [B]), turns(B, [R]), turns(R, [T]), turns(T, [L])] },
  },
  trains: {},
  size: { cols: 5, rows: 5 },
};
```

- [ ] **Step 4: Register it in `src/levels/test/index.ts`**

Add the import:

```ts
import { rightturncross } from "@/levels/test/scenarios/rightturncross";
```

and add `rightturncross,` to the `SCENARIOS` array, just after `roadjunction`.

- [ ] **Step 5: Run the scenario validation + behavioural test**

Run: `npx vitest run tests/unit/levels/testScenarios.spec.ts tests/unit/sim/road.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/levels/test/scenarios/rightturncross.ts src/levels/test/index.ts tests/unit/sim/road.spec.ts
git commit -m "feat: right-turn-only cross scenario + flow test"
```

---

## Task 5: Lane validation invariants

**Files:**
- Modify: `src/tiles/validate.ts`
- Test: `tests/unit/tiles/validate.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/tiles/validate.spec.ts` (which already imports `validateRoads` and `Position`), add the `import` with the other imports at the **top**, and append the `describe` block at the **end**:

```ts
// add to the import block at the top:
import { turns, oneWay } from "@/tiles/lanes";

// append at the end:
describe("validateRoads — lane invariants", () => {
  const { Top: T, Right: R, Bottom: B, Left: L } = Position;

  it("flags two lanes sharing the same (from, index)", () => {
    const level = {
      "0,0": { connections: [], road: [turns(L, [R], 0), turns(L, [B], 0)] },
    };
    const { ok, issues } = validateRoads(level);
    expect(ok).toBe(false);
    expect(issues.some(i => i.type === "lane-index-clash")).toBe(true);
  });

  it("flags a junction approach with no permitted exit", () => {
    const level = {
      "0,0": { connections: [], road: [turns(L, [], 0)] },
    };
    const { ok, issues } = validateRoads(level);
    expect(ok).toBe(false);
    expect(issues.some(i => i.type === "lane-no-exit")).toBe(true);
  });

  it("accepts a well-formed one-way lane", () => {
    const level = {
      "0,0": { connections: [], road: [oneWay(L, R)] },
      "1,0": { connections: [], road: [oneWay(L, R)] },
    };
    expect(validateRoads(level).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/tiles/validate.spec.ts -t "lane invariants"`
Expected: FAIL — `lane-index-clash` / `lane-no-exit` issue types don't exist yet.

- [ ] **Step 3: Extend `validateRoads` in `src/tiles/validate.ts`**

Widen the issue-type union:

```ts
export type RoadIssueType = "dangling-road" | "lane-index-clash" | "lane-no-exit";
```

Inside `validateRoads`, after the existing dangling-road loop body (still within the `for (const [id, tile] of ...)` loop, where `road` is the tile's lane list), add:

```ts
    // Lane invariants: unique index per approach; every approach permits an exit.
    const indexByFrom = new Map<string, Set<number>>();
    for (const lane of road) {
      if (lane.to.length === 0) {
        issues.push({
          type: "lane-no-exit",
          tileId: id,
          detail: `lane entering ${Position[lane.from]} of ${id} permits no exit`,
        });
      }
      const key = String(lane.from);
      if (!indexByFrom.has(key)) indexByFrom.set(key, new Set());
      const seen = indexByFrom.get(key)!;
      if (seen.has(lane.index)) {
        issues.push({
          type: "lane-index-clash",
          tileId: id,
          detail: `two lanes from ${Position[lane.from]} share index ${lane.index} on ${id}`,
        });
      }
      seen.add(lane.index);
    }
```

(`road` is already `const road = tile.road ?? []` from the existing function body; if the early `if (road.length === 0) continue;` skips empty roads, that is fine — empty roads have no lanes to validate.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/tiles/validate.spec.ts`
Expected: PASS (new invariants + existing dangling-road tests).

- [ ] **Step 5: Run the full suite + build**

Run: `npx vitest run`
Expected: all pass — every migrated scenario (each approach is a single index-0 lane via `fromPairs`) satisfies the new invariants.

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/tiles/validate.ts tests/unit/tiles/validate.spec.ts
git commit -m "feat: validate lane invariants (unique index per approach, non-empty exits)"
```

---

## Task 6: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run`
Expected: all tests green.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `✓ built` with no type errors.

- [ ] **Step 3: End-to-end**

Run: `npx playwright install chromium` (once, if not already installed), then `npm run test:e2e`
Expected: the default level renders, trains and cars move, no console errors.

- [ ] **Step 4: Manual spot-check (optional)**

Run `npm run dev`, open the test world, and visit `/#/test/roadoneway` and `/#/test/rightturncross` to confirm one-way flow and the conflict-free right-turn cross.

---

## Notes for the implementer

- `Port` is `Position`, a numeric enum, so `<` comparisons and `String(port)` keys are stable and fine for de-dup.
- `fromPairs` is the migration workhorse: it is behaviour-preserving (every undirected pair stays traversable both ways), so all existing behavioural road tests must remain green after Task 2. If one breaks, the cause is a consumer rewrite, not the data migration.
- Do **not** add multi-lane rendering, per-lane occupancy, bus-lane enforcement, route-planner lane choice, or lane switching — those are later sub-projects (B/C/E/F/G). Keep every approach at a single index-0 lane.
- The editor intentionally only authors two-way roads; one-way/turn-ban authoring UI is out of scope.
```
