# Data-Driven Tiles — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-tile-type topology/geometry duplication with one shared, connection-based tile model that both the simulation and a single `Tile.vue` consume, and migrate the existing level to it — with no change in game behaviour.

**Architecture:** A new `src/tiles/` module is the single source of truth. Each cell stores its canonical `connections: PortPair[]` (unordered port pairs over N/E/S/W/Center) plus an optional `role`/`signals` flag. Kind label, rail geometry, and the simulation's exit-port resolution are all *derived* from `connections`. Named-kind authoring sugar (`expandKind`) bakes friendly definitions into connections. The four tile components collapse into one data-driven `Tile.vue`.

**Tech Stack:** Vue 3.5 + vue-facing-decorator, TypeScript 5, Vite 6, Vitest, Playwright. No new runtime deps in this phase (vue-router arrives in the editor phase).

**Scope note:** This is Phase 1 of four (foundation → auto-tiling+validator → editor → procgen). The later phases get their own plans, written against the real APIs this phase establishes. This plan ships a fully working game on the new model.

---

## File Structure

**New files:**
- `src/tiles/model.ts` — canonical types (`Port`, `PortPair`, `TileCell`, `TileKind`, `Level`) + core derivations (`samePair`, `pairHas`, `partnersOf`, `armExit`, `connectionsToExitPort`, `kindOf`, `portsOf`, `rotatePort`, `rotatePair`, `rotateConnections`, `parseCoordId`).
- `src/tiles/kinds.ts` — `expandKind(kind, rotation, opts)` authoring sugar.
- `src/tiles/geometry.ts` — `railPathsFor(entry, exit, size, offset)` (rail drawing derived from ports; train path stays in `sim/pathGeometry.ts`).
- `src/components/Tile.vue` — the single data-driven tile component.
- Tests: `tests/unit/tiles/model.spec.ts`, `kinds.spec.ts`, `geometry.spec.ts`.

**Modified files:**
- `src/sim/topology.ts` — keep `oppositePort`/`neighborCoord`; delete `CURVE`/`INTERSECTION`/`ExitOptions`/`tileExitPort` (moved to `model.ts`).
- `src/sim/network.ts` — `resolveExitPort` consumes `TileCell.connections` via `connectionsToExitPort`.
- `src/sim/simulation.ts` — `isBoundary` uses `cell.role === "depot"`; `aspect` derives coord via `parseCoordId`; type is `Level`.
- `src/game.ts` — `initialSwitches`/`signalTiles`/`signalExits` derive from the new model; type is `Level`.
- `src/utils/colorAssignment.ts` — depots detected via `cell.role === "depot"`; type is `Level`.
- `src/App.vue` — level rewritten to the new kind-based format; renders `<Tile>` not `<component :is>`.
- `src/main.ts` — register only `Tile`, `TileRail`, `Train`, `DebugShowRoutes`.
- `src/types.ts` — old `LevelDefinition`/`TileObject` kept only if still referenced; new code imports from `tiles/model.ts`.
- Tests: `tests/unit/sim/topology.spec.ts`, `network.spec.ts`, `simulation.spec.ts` migrated to the new cell format.

**Deleted files:**
- `src/components/TileStraight.vue`, `TileCurve.vue`, `TileDepot.vue`, `TileIntersectionComplete.vue`, `TileBase.ts`.

---

## Background the implementer must know

- **Ports.** `Position` enum (`src/types.ts`): `Top=0, Right=1, Bottom=2, Left=3, Center=4`. We alias `Port = Position`. Neighbour math: Top = y−1, Right = x+1, Bottom = y+1, Left = x−1 (y grows downward).
- **The switch arm geometry never depended on rotation.** The old `INTERSECTION` table in `topology.ts` is keyed only by entry port + arm (`ActiveIntersection`: `Left=0, Straight=1, Right=2`). A 4-way is rotationally symmetric, so `armExit(entry, arm)` reproduces it exactly. We reuse that table verbatim, just relocated.
- **Movement geometry is already shared.** `game.ts` `positionUnit()` samples `segmentPathD(entryPort, exitPort, tileSize)`. We do NOT touch movement geometry; only rail *drawing* is re-derived in `geometry.ts`.
- **`getSwitch` resolver signature stays** `(coordId, entryPort) => ActiveIntersection | undefined`. The reactive `game.switches[coordId][entryPort] = arm` map and all switch UI/interlocking keep working unchanged — only how an arm maps to an exit moves into the model.
- **Run a single vitest file:** `npm run test:unit -- <path>`. Full unit run: `npm run test:unit`. Type-check + build: `npm run build`. e2e: `npm run test:e2e` (needs `npx playwright install chromium` once).
- **Commit messages:** no AI attribution lines (project rule).

---

## Task 1: Canonical model types + pair helpers

**Files:**
- Create: `src/tiles/model.ts`
- Test: `tests/unit/tiles/model.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/tiles/model.spec.ts
import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import {
  samePair,
  pairHas,
  partnersOf,
  portsOf,
  parseCoordId,
} from "@/tiles/model";

const { Top, Right, Bottom, Left, Center } = Position;

describe("pair helpers", () => {
  it("samePair is order-independent", () => {
    expect(samePair([Top, Bottom], [Bottom, Top])).toBe(true);
    expect(samePair([Top, Bottom], [Top, Left])).toBe(false);
  });

  it("pairHas detects membership", () => {
    expect(pairHas([Top, Right], Top)).toBe(true);
    expect(pairHas([Top, Right], Bottom)).toBe(false);
  });

  it("partnersOf returns the other end of every connection touching a port", () => {
    const conns = [[Top, Bottom], [Top, Right]] as [Position, Position][];
    expect(partnersOf(conns, Top).sort()).toEqual([Right, Bottom].sort());
    expect(partnersOf(conns, Left)).toEqual([]);
  });

  it("portsOf returns the unique ports used by all connections", () => {
    const conns = [[Top, Bottom]] as [Position, Position][];
    expect(portsOf(conns).sort()).toEqual([Top, Bottom].sort());
  });

  it("parseCoordId splits an x,y id", () => {
    expect(parseCoordId("3,4")).toEqual({ x: 3, y: 4 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/tiles/model.spec.ts`
Expected: FAIL — cannot resolve `@/tiles/model`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tiles/model.ts
import { Position, Coordinates } from "@/types";

export type Port = Position;
export type PortPair = [Port, Port];

export type TileKind =
  | "straight"
  | "curve"
  | "tjunction"
  | "cross"
  | "depot"
  | "dead-end"
  | "empty";

// The canonical, authoritative description of one grid cell. `connections` is
// the single source of truth; kind/geometry/routing are all derived from it.
export interface TileCell {
  connections: PortPair[];
  role?: "depot";
  signals?: boolean;
}

export type Level = Record<string, TileCell>;

export function samePair(a: PortPair, b: PortPair): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

export function pairHas(pair: PortPair, port: Port): boolean {
  return pair[0] === port || pair[1] === port;
}

// The other end of every connection that touches `port`.
export function partnersOf(connections: PortPair[], port: Port): Port[] {
  const out: Port[] = [];
  for (const [a, b] of connections) {
    if (a === port) out.push(b);
    else if (b === port) out.push(a);
  }
  return out;
}

// Every distinct port used by the connection set.
export function portsOf(connections: PortPair[]): Port[] {
  const set = new Set<Port>();
  for (const [a, b] of connections) {
    set.add(a);
    set.add(b);
  }
  return [...set];
}

export function parseCoordId(id: string): Coordinates {
  const [x, y] = id.split(",").map(Number);
  return { x, y };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/tiles/model.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/model.ts tests/unit/tiles/model.spec.ts
git commit -m "Add canonical tile model types and pair helpers"
```

---

## Task 2: Rotation helpers

**Files:**
- Modify: `src/tiles/model.ts`
- Test: `tests/unit/tiles/model.spec.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/tiles/model.spec.ts`:

```ts
import { rotatePort, rotatePair, rotateConnections } from "@/tiles/model";

describe("rotation", () => {
  it("rotatePort steps T->R->B->L per +1 and leaves Center fixed", () => {
    expect(rotatePort(Top, 1)).toBe(Right);
    expect(rotatePort(Left, 1)).toBe(Top);
    expect(rotatePort(Top, 2)).toBe(Bottom);
    expect(rotatePort(Center, 3)).toBe(Center);
  });

  it("rotatePair rotates both ends", () => {
    expect(rotatePair([Top, Right], 1)).toEqual([Right, Bottom]);
  });

  it("rotateConnections rotates every pair", () => {
    expect(rotateConnections([[Top, Bottom]], 1)).toEqual([[Right, Left]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/tiles/model.spec.ts`
Expected: FAIL — `rotatePort` is not exported.

- [ ] **Step 3: Implement**

Append to `src/tiles/model.ts`:

```ts
// Rotate a port clockwise by `steps` quarter-turns (T->R->B->L). Center is fixed.
export function rotatePort(port: Port, steps: number): Port {
  if (port === Position.Center) return port;
  return (((port + steps) % 4) + 4) % 4;
}

export function rotatePair(pair: PortPair, steps: number): PortPair {
  return [rotatePort(pair[0], steps), rotatePort(pair[1], steps)];
}

export function rotateConnections(
  connections: PortPair[],
  steps: number
): PortPair[] {
  return connections.map(p => rotatePair(p, steps));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/tiles/model.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/model.ts tests/unit/tiles/model.spec.ts
git commit -m "Add tile-model rotation helpers"
```

---

## Task 3: `armExit` + `connectionsToExitPort` (routing, replaces topology tables)

**Files:**
- Modify: `src/tiles/model.ts`
- Test: `tests/unit/tiles/model.spec.ts`

This must reproduce the old `topology.tileExitPort` behaviour exactly for every kind.

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/tiles/model.spec.ts`:

```ts
import { armExit, connectionsToExitPort } from "@/tiles/model";
import { ActiveIntersection } from "@/types";

const STRAIGHT_V: [Position, Position][] = [[Top, Bottom]];
const CURVE_TR: [Position, Position][] = [[Top, Right]];
const DEPOT_TOP: [Position, Position][] = [[Top, Center]];
// Full 4-way: all six distinct-edge pairs.
const CROSS: [Position, Position][] = [
  [Top, Bottom], [Left, Right],
  [Top, Right], [Right, Bottom], [Bottom, Left], [Left, Top],
];

describe("armExit (geometric arm -> exit, entry-relative)", () => {
  it("matches the legacy intersection table for Top entry", () => {
    expect(armExit(Top, ActiveIntersection.Left)).toBe(Right);
    expect(armExit(Top, ActiveIntersection.Straight)).toBe(Bottom);
    expect(armExit(Top, ActiveIntersection.Right)).toBe(Left);
  });
  it("matches for Right entry", () => {
    expect(armExit(Right, ActiveIntersection.Left)).toBe(Bottom);
    expect(armExit(Right, ActiveIntersection.Straight)).toBe(Left);
    expect(armExit(Right, ActiveIntersection.Right)).toBe(Top);
  });
});

describe("connectionsToExitPort", () => {
  it("straight: returns the opposite port, ignores unconnected entries", () => {
    expect(connectionsToExitPort(STRAIGHT_V, Top)).toBe(Bottom);
    expect(connectionsToExitPort(STRAIGHT_V, Bottom)).toBe(Top);
    expect(connectionsToExitPort(STRAIGHT_V, Left)).toBeNull();
  });
  it("curve: returns the single partner", () => {
    expect(connectionsToExitPort(CURVE_TR, Top)).toBe(Right);
    expect(connectionsToExitPort(CURVE_TR, Right)).toBe(Top);
  });
  it("depot: Center<->outer", () => {
    expect(connectionsToExitPort(DEPOT_TOP, Center)).toBe(Top);
    expect(connectionsToExitPort(DEPOT_TOP, Top)).toBe(Center);
  });
  it("junction: needs an arm; resolves arm->exit when that pair exists", () => {
    expect(connectionsToExitPort(CROSS, Top)).toBeNull(); // no arm
    expect(
      connectionsToExitPort(CROSS, Top, ActiveIntersection.Straight)
    ).toBe(Bottom);
    expect(connectionsToExitPort(CROSS, Top, ActiveIntersection.Left)).toBe(
      Right
    );
  });
  it("junction with a missing arm returns null (disabled route)", () => {
    const T: [Position, Position][] = [[Left, Right], [Left, Top], [Right, Top]];
    // From Bottom there is no connection at all.
    expect(
      connectionsToExitPort(T, Bottom, ActiveIntersection.Straight)
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/tiles/model.spec.ts`
Expected: FAIL — `armExit` not exported.

- [ ] **Step 3: Implement**

Append to `src/tiles/model.ts`:

```ts
import { ActiveIntersection } from "@/types";

// Entry-relative geometric arm -> exit port. Reproduces the legacy
// topology.INTERSECTION table verbatim (rotation-independent for a 4-way).
const ARM_EXIT: Record<number, Record<number, Port>> = {
  [Position.Top]: {
    [ActiveIntersection.Left]: Position.Right,
    [ActiveIntersection.Straight]: Position.Bottom,
    [ActiveIntersection.Right]: Position.Left,
  },
  [Position.Right]: {
    [ActiveIntersection.Left]: Position.Bottom,
    [ActiveIntersection.Straight]: Position.Left,
    [ActiveIntersection.Right]: Position.Top,
  },
  [Position.Bottom]: {
    [ActiveIntersection.Left]: Position.Left,
    [ActiveIntersection.Straight]: Position.Top,
    [ActiveIntersection.Right]: Position.Right,
  },
  [Position.Left]: {
    [ActiveIntersection.Left]: Position.Top,
    [ActiveIntersection.Straight]: Position.Right,
    [ActiveIntersection.Right]: Position.Bottom,
  },
};

export function armExit(entry: Port, arm: ActiveIntersection): Port | null {
  return ARM_EXIT[entry]?.[arm] ?? null;
}

// True when an entry port participates in more than one connection — i.e. a
// switchable junction (T or cross), where an arm is needed to choose the exit.
export function isJunctionEntry(connections: PortPair[], entry: Port): boolean {
  return partnersOf(connections, entry).length > 1;
}

// The port a train leaves through. For non-junction entries (straight/curve/
// depot) the single partner is returned and `arm` is ignored. For a junction
// entry the geometric `arm` selects the exit; null if that connection is absent
// (a disabled/non-existent route) or no arm was supplied.
export function connectionsToExitPort(
  connections: PortPair[],
  entry: Port,
  arm?: ActiveIntersection
): Port | null {
  const partners = partnersOf(connections, entry);
  if (partners.length === 0) return null;
  if (partners.length === 1) return partners[0];
  if (arm === undefined) return null;
  const want = armExit(entry, arm);
  return want !== null && partners.includes(want) ? want : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/tiles/model.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/model.ts tests/unit/tiles/model.spec.ts
git commit -m "Add connection-based exit-port routing to tile model"
```

---

## Task 4: `kindOf` label derivation

**Files:**
- Modify: `src/tiles/model.ts`
- Test: `tests/unit/tiles/model.spec.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/tiles/model.spec.ts`:

```ts
import { kindOf } from "@/tiles/model";

describe("kindOf", () => {
  it("labels each shape from its connections + role", () => {
    expect(kindOf({ connections: [] })).toBe("empty");
    expect(kindOf({ connections: [[Top, Center]], role: "depot" })).toBe("depot");
    expect(kindOf({ connections: [[Top, Center]] })).toBe("dead-end"); // 1 conn, no role... see note
    expect(kindOf({ connections: [[Top, Bottom]] })).toBe("straight");
    expect(kindOf({ connections: [[Top, Right]] })).toBe("curve");
    expect(
      kindOf({ connections: [[Left, Right], [Left, Top], [Right, Top]] })
    ).toBe("tjunction");
    expect(
      kindOf({
        connections: [
          [Top, Bottom], [Left, Right],
          [Top, Right], [Right, Bottom], [Bottom, Left], [Left, Top],
        ],
      })
    ).toBe("cross");
  });
});
```

Note: a depot is identified by `role`, not shape. A lone non-depot connection that includes Center is degenerate and also labelled `dead-end` (only depots legitimately touch Center).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/tiles/model.spec.ts`
Expected: FAIL — `kindOf` not exported.

- [ ] **Step 3: Implement**

Append to `src/tiles/model.ts`:

```ts
// A human-readable label for the cell's shape. Derived purely from connections
// (+ the depot role). Used for sprite selection, debug, and the editor — never
// for routing.
export function kindOf(cell: TileCell): TileKind {
  if (cell.role === "depot") return "depot";
  const conns = cell.connections;
  if (conns.length === 0) return "empty";
  const edges = portsOf(conns).filter(p => p !== Position.Center);
  if (edges.length >= 3) return conns.length >= 6 ? "cross" : "tjunction";
  if (conns.length === 1) {
    const [a, b] = conns[0];
    if (a === Position.Center || b === Position.Center) return "dead-end";
    return a === oppositePort(b) ? "straight" : "curve";
  }
  return "tjunction";
}
```

Add the import at the top of `model.ts` (alongside the existing imports):

```ts
import { oppositePort } from "@/sim/topology";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/tiles/model.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/model.ts tests/unit/tiles/model.spec.ts
git commit -m "Add kindOf label derivation to tile model"
```

---

## Task 5: `expandKind` authoring sugar

**Files:**
- Create: `src/tiles/kinds.ts`
- Test: `tests/unit/tiles/kinds.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/tiles/kinds.spec.ts
import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { samePair } from "@/tiles/model";

const { Top, Right, Bottom, Left, Center } = Position;

const hasPair = (cell: { connections: [Position, Position][] }, p: [Position, Position]) =>
  cell.connections.some(c => samePair(c, p));

describe("expandKind", () => {
  it("straight rot 0 connects Top-Bottom; rot 1 connects Right-Left", () => {
    expect(hasPair(expandKind("straight", 0), [Top, Bottom])).toBe(true);
    expect(hasPair(expandKind("straight", 1), [Right, Left])).toBe(true);
  });

  it("curve rot 0 connects Top-Right; rot 1 connects Right-Bottom", () => {
    expect(hasPair(expandKind("curve", 0), [Top, Right])).toBe(true);
    expect(hasPair(expandKind("curve", 1), [Right, Bottom])).toBe(true);
  });

  it("depot rot 0 connects Top-Center and sets role", () => {
    const d = expandKind("depot", 0);
    expect(hasPair(d, [Top, Center])).toBe(true);
    expect(d.role).toBe("depot");
  });

  it("cross has all six distinct-edge pairs", () => {
    expect(expandKind("cross", 0).connections).toHaveLength(6);
  });

  it("signals option sets the flag", () => {
    expect(expandKind("straight", 1, { signals: true }).signals).toBe(true);
  });

  it("disable removes the named pairs from a cross", () => {
    const c = expandKind("cross", 0, { disable: [[Top, Right], [Top, Left]] });
    expect(hasPair(c, [Top, Right])).toBe(false);
    expect(hasPair(c, [Top, Bottom])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/tiles/kinds.spec.ts`
Expected: FAIL — cannot resolve `@/tiles/kinds`.

- [ ] **Step 3: Implement**

```ts
// src/tiles/kinds.ts
import { Position } from "@/types";
import {
  PortPair,
  TileCell,
  rotateConnections,
  samePair,
} from "@/tiles/model";

const { Top, Right, Bottom, Left, Center } = Position;

// Base connections at rotation 0 for each authoring kind.
const ALL_CROSS: PortPair[] = [
  [Top, Bottom],
  [Left, Right],
  [Top, Right],
  [Right, Bottom],
  [Bottom, Left],
  [Left, Top],
];

const BASE: Record<string, PortPair[]> = {
  straight: [[Top, Bottom]],
  curve: [[Top, Right]],
  depot: [[Top, Center]],
  cross: ALL_CROSS,
  // A T-junction at rot 0 has the trunk along Left-Right with a branch to Top.
  tjunction: [[Left, Right], [Left, Top], [Right, Top]],
};

export type AuthorKind = keyof typeof BASE;

export interface KindOptions {
  signals?: boolean;
  disable?: PortPair[]; // pairs (at the final rotation) to remove
}

// Expand a friendly kind + rotation into a canonical TileCell. `rotation` is in
// quarter-turns clockwise (0..3). `disable` pairs are matched after rotation.
export function expandKind(
  kind: AuthorKind,
  rotation = 0,
  opts: KindOptions = {}
): TileCell {
  const base = BASE[kind];
  if (!base) throw new Error(`Unknown tile kind: ${kind}`);
  let connections = rotateConnections(base, rotation);
  if (opts.disable?.length) {
    connections = connections.filter(
      c => !opts.disable!.some(d => samePair(c, d))
    );
  }
  const cell: TileCell = { connections };
  if (kind === "depot") cell.role = "depot";
  if (opts.signals) cell.signals = true;
  return cell;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/tiles/kinds.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/kinds.ts tests/unit/tiles/kinds.spec.ts
git commit -m "Add expandKind authoring sugar for tile cells"
```

---

## Task 6: Rail geometry derivation

**Files:**
- Create: `src/tiles/geometry.ts`
- Test: `tests/unit/tiles/geometry.spec.ts`

Rails are two paths parallel to the train path, offset by `±offset` perpendicular to travel. Straight (opposite/Center ports) → offset a straight line; curve (adjacent ports) → offset the quadratic through centre.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/tiles/geometry.spec.ts
import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { railPathsFor } from "@/tiles/geometry";

const { Top, Bottom, Right, Center } = Position;
const SIZE = 200;
const OFF = 14;

describe("railPathsFor", () => {
  it("returns exactly two rail paths", () => {
    expect(railPathsFor(Top, Bottom, SIZE, OFF)).toHaveLength(2);
  });

  it("vertical straight: rails are two vertical lines offset in x by +/- offset", () => {
    const [r1, r2] = railPathsFor(Top, Bottom, SIZE, OFF);
    // Centre of a vertical straight is x=100; rails at 100+/-14 = 86 and 114.
    expect(r1).toContain("86");
    expect(r2).toContain("114");
  });

  it("curve uses a quadratic (Q) command", () => {
    const [r1] = railPathsFor(Top, Right, SIZE, OFF);
    expect(r1).toContain("Q");
  });

  it("depot stub (port<->Center) returns two offset lines", () => {
    expect(railPathsFor(Top, Center, SIZE, OFF)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/tiles/geometry.spec.ts`
Expected: FAIL — cannot resolve `@/tiles/geometry`.

- [ ] **Step 3: Implement**

```ts
// src/tiles/geometry.ts
import { Position } from "@/types";
import { Port, oppositePort } from "@/sim/topology";
import { portPoint } from "@/sim/pathGeometry";

// Two rail paths flanking the train path between two ports, each offset by
// `offset` px perpendicular to the direction of travel. Straight/Center links
// are offset lines; adjacent ports curve through the tile centre (quadratic).
export function railPathsFor(
  entry: Port,
  exit: Port,
  size: number,
  offset: number
): string[] {
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const c = portPoint(Position.Center, size);

  const isCenter = entry === Position.Center || exit === Position.Center;
  const isOpposite = oppositePort(entry) === exit;

  // Perpendicular unit vector to (a -> b).
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;

  if (isCenter || isOpposite) {
    const line = (s: number) =>
      `M ${a.x + px * s} ${a.y + py * s} L ${b.x + px * s} ${b.y + py * s}`;
    return [line(offset), line(-offset)];
  }

  // Curve: offset both endpoints and the control point (the tile centre).
  const curve = (s: number) =>
    `M ${a.x + px * s} ${a.y + py * s} Q ${c.x} ${c.y} ${b.x + px * s} ${
      b.y + py * s
    }`;
  return [curve(offset), curve(-offset)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/tiles/geometry.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/geometry.ts tests/unit/tiles/geometry.spec.ts
git commit -m "Add connection-derived rail geometry"
```

---

## Task 7: Rewire `topology.ts` + `network.ts` to the model

**Files:**
- Modify: `src/sim/topology.ts`
- Modify: `src/sim/network.ts`
- Modify: `tests/unit/sim/topology.spec.ts`
- Modify: `tests/unit/sim/network.spec.ts`

- [ ] **Step 1: Reduce `topology.ts` to neighbour/port math**

Replace the entire contents of `src/sim/topology.ts` with:

```ts
import { Position, Coordinates } from "@/types";

// A "port" is the side of a tile a train enters or leaves through.
export type Port = Position;

export function oppositePort(port: Port): Port {
  switch (port) {
    case Position.Top:
      return Position.Bottom;
    case Position.Bottom:
      return Position.Top;
    case Position.Left:
      return Position.Right;
    case Position.Right:
      return Position.Left;
    default:
      return Position.Center;
  }
}

// The neighbouring tile reached by leaving through `exitPort` (y grows downward).
// Center has no neighbour (it is the inside of a depot).
export function neighborCoord(
  coord: Coordinates,
  exitPort: Port
): Coordinates | null {
  switch (exitPort) {
    case Position.Top:
      return { x: coord.x, y: coord.y - 1 };
    case Position.Right:
      return { x: coord.x + 1, y: coord.y };
    case Position.Bottom:
      return { x: coord.x, y: coord.y + 1 };
    case Position.Left:
      return { x: coord.x - 1, y: coord.y };
    default:
      return null;
  }
}
```

(`CURVE`, `INTERSECTION`, `ExitOptions`, `tileExitPort` are deleted — their behaviour now lives in `tiles/model.ts`.)

- [ ] **Step 2: Update `network.ts` to consume connections**

In `src/sim/network.ts`, change the imports and `resolveExitPort`:

```ts
import { Level, ActiveIntersection, Coordinates } from "@/types"; // see note
import { Port, neighborCoord, oppositePort } from "./topology";
import { connectionsToExitPort } from "@/tiles/model";
import { getCoordinatesId } from "@/utils/tileHelpers";
```

Note: `Level` is now exported from `@/tiles/model`. Update the import to:

```ts
import { ActiveIntersection, Coordinates } from "@/types";
import { Level, connectionsToExitPort } from "@/tiles/model";
import { Port, neighborCoord, oppositePort } from "./topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
```

Replace `resolveExitPort` body:

```ts
export function resolveExitPort(
  level: Level,
  getSwitch: SwitchResolver,
  coord: Coordinates,
  entryPort: Port
): Port | null {
  const tile = level[getCoordinatesId(coord)];
  if (!tile || tile.connections.length === 0) return null;
  const arm = getSwitch(getCoordinatesId(coord), entryPort);
  return connectionsToExitPort(tile.connections, entryPort, arm);
}
```

Then update every other `LevelDefinition` reference in `network.ts` to `Level`, and the `nextTile.component`/`!tile.component` checks in `traverse` to `nextTile.connections.length === 0` / `tile.connections.length === 0`:

```ts
export function traverse(
  level: Level,
  getSwitch: SwitchResolver,
  coord: Coordinates,
  entryPort: Port
): Traversal {
  const exitPort = resolveExitPort(level, getSwitch, coord, entryPort);
  if (exitPort === null) return { exitPort: null, next: null };

  const nextCoord = neighborCoord(coord, exitPort);
  if (!nextCoord) return { exitPort, next: null };

  const nextTile = level[getCoordinatesId(nextCoord)];
  if (!nextTile || nextTile.connections.length === 0)
    return { exitPort, next: null };

  return {
    exitPort,
    next: { coord: nextCoord, entryPort: oppositePort(exitPort) },
  };
}
```

Update `routeToNextSignal`'s `level: LevelDefinition` parameter type to `level: Level`.

- [ ] **Step 3: Migrate `topology.spec.ts`**

Delete the `tileExitPort` describe blocks (now covered by `model.spec.ts`). Keep only the `oppositePort` and `neighborCoord` blocks, and remove the now-unused import:

```ts
import { describe, it, expect } from "vitest";
import { oppositePort, neighborCoord } from "@/sim/topology";
import { Position } from "@/types";
// ...keep the existing oppositePort and neighborCoord describe blocks verbatim...
```

- [ ] **Step 4: Migrate `network.spec.ts` fixtures**

Open `tests/unit/sim/network.spec.ts`. Every level fixture uses the old `{ component, x, y, rotation }` shape. Replace each tile literal with the connection form using `expandKind` (import it). Example transformation — a straight at rotation 1 and a curve at rotation 0:

```ts
import { expandKind } from "@/tiles/kinds";
// before: "0,0": { component: "TileStraight", x: 0, y: 0, rotation: 1 }
// after:
"0,0": expandKind("straight", 1),
// before: "1,0": { component: "TileCurve", x: 1, y: 0, rotation: 0 }
"1,0": expandKind("curve", 0),
// before: depot rotation 3
"2,0": expandKind("depot", 3),
```

For intersection fixtures, use `expandKind("cross", 0)` (and `{ disable: [...] }` if the original used `disabledRoutes`). Keep the `getSwitch` stubs as-is (they return `ActiveIntersection` by entry port).

- [ ] **Step 5: Run the sim unit tests**

Run: `npm run test:unit -- tests/unit/sim/topology.spec.ts tests/unit/sim/network.spec.ts`
Expected: PASS (fix any fixture that still references `.component`).

- [ ] **Step 6: Commit**

```bash
git add src/sim/topology.ts src/sim/network.ts tests/unit/sim/topology.spec.ts tests/unit/sim/network.spec.ts
git commit -m "Route the network through the connection model; slim topology"
```

---

## Task 8: Rewire `simulation.ts`

**Files:**
- Modify: `src/sim/simulation.ts`
- Modify: `tests/unit/sim/simulation.spec.ts`

- [ ] **Step 1: Update types and depot/boundary/aspect logic**

In `src/sim/simulation.ts`:

Change the import line 1 and add the model import:

```ts
import { Coordinates, Position } from "@/types";
import { Level, parseCoordId } from "@/tiles/model";
```

Change `SimConfig.level` type to `Level`. Change `const { level } = config;` stays.

Replace `isBoundary`:

```ts
function isBoundary(tileId: string): boolean {
  if (signalTiles.has(tileId)) return true;
  const tile = level[tileId];
  return !!tile && tile.role === "depot";
}
```

In `aspect()`, replace the coord construction (it used `tile.x, tile.y`):

```ts
const tile = level[tileId];
if (!tile) return "proceed";
const block = routeToNextSignal(
  level,
  getSwitch,
  isBoundary,
  parseCoordId(tileId),
  oppositePort(exitPort)
);
```

- [ ] **Step 2: Migrate `simulation.spec.ts` fixtures**

In `tests/unit/sim/simulation.spec.ts`, replace every `{ component, x, y, rotation, ... }` tile with `expandKind(...)` (import `expandKind` from `@/tiles/kinds`). Signals: a tile that previously set `trafficLights` becomes `expandKind("straight", rot, { signals: true })`, and any `signalTiles` array passed to `createSimulation` stays the same (keyed by id). Depots become `expandKind("depot", rot)`.

- [ ] **Step 3: Run sim tests**

Run: `npm run test:unit -- tests/unit/sim/simulation.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/sim/simulation.ts tests/unit/sim/simulation.spec.ts
git commit -m "Drive the simulation off the connection model"
```

---

## Task 9: Rewire `colorAssignment.ts`

**Files:**
- Modify: `src/utils/colorAssignment.ts`
- Modify: `tests/unit/colorAssignment.spec.ts`

- [ ] **Step 1: Update depot detection**

In `src/utils/colorAssignment.ts` change the import and the depot filter:

```ts
import { Level } from "@/tiles/model";
// ...
export function assignColors(
  level: Level,
  trains: TrainStart[],
  rand: () => number = Math.random
): ColorAssignment {
  const depotIds = Object.entries(level)
    .filter(([, tile]) => tile.role === "depot")
    .map(([id]) => id);
  // ...rest unchanged...
```

- [ ] **Step 2: Migrate `colorAssignment.spec.ts` fixtures**

Replace old tile literals with `expandKind(...)`: depots → `expandKind("depot", 0)`, plain track → `expandKind("straight", 0)`.

- [ ] **Step 3: Run test**

Run: `npm run test:unit -- tests/unit/colorAssignment.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/colorAssignment.ts tests/unit/colorAssignment.spec.ts
git commit -m "Detect depots via role in colour assignment"
```

---

## Task 10: Rewire `game.ts`

**Files:**
- Modify: `src/game.ts`

- [ ] **Step 1: Update imports and types**

Change the imports at the top of `src/game.ts`:

```ts
import { Position, ActiveIntersection } from "@/types";
import { Level, partnersOf, armExit, portsOf } from "@/tiles/model";
```

Change `createGame(level: LevelDefinition, ...)` to `level: Level`, and the `Game.switches` / function signatures that referenced `LevelDefinition` to `Level`.

- [ ] **Step 2: Replace `initialSwitches`**

Replace the whole `initialSwitches` function (and its `ALL_ARMS`/`ENTRY_PORTS` consts may stay) with a version that derives defaults from connections — preferring an `activeRoutes`-style override is no longer needed because the level no longer carries it; instead the default arm is the first arm whose `armExit` is an actual partner:

```ts
const ALL_ARMS = [
  ActiveIntersection.Left,
  ActiveIntersection.Straight,
  ActiveIntersection.Right,
];
const ENTRY_PORTS = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

// Default switch arm per entry port of every junction tile: the first arm whose
// geometric exit is an actual connection of that tile. Non-junction tiles need
// no switch entry. (Player clicks and interlocking mutate this map later.)
function initialSwitches(
  level: Level
): Record<string, Record<number, ActiveIntersection>> {
  const out: Record<string, Record<number, ActiveIntersection>> = {};
  for (const [id, tile] of Object.entries(level)) {
    const switches: Record<number, ActiveIntersection> = {};
    let isJunction = false;
    for (const port of ENTRY_PORTS) {
      const partners = partnersOf(tile.connections, port);
      if (partners.length <= 1) continue; // straight/curve/depot entry
      isJunction = true;
      const arm = ALL_ARMS.find(a => {
        const exit = armExit(port, a);
        return exit !== null && partners.includes(exit);
      });
      if (arm !== undefined) switches[port] = arm;
    }
    if (isJunction) out[id] = switches;
  }
  return out;
}
```

- [ ] **Step 3: Replace `signalTiles` and `signalExits`**

`signalTiles` now reads the `signals` flag:

```ts
const signalTiles = Object.entries(level)
  .filter(([, tile]) => tile.signals)
  .map(([id]) => id);
```

`signalExits` derives from the tile's actual ports (drop the rotation lookup):

```ts
// The exit ports of a signal tile = the ports its connections use (a straight
// has exactly two). Signals only sit on straights, so this yields the two
// directions of travel.
function signalExits(tileId: string): Position[] {
  const tile = level[tileId];
  if (!tile) return [];
  return portsOf(tile.connections).filter(p => p !== Position.Center);
}
```

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: vue-tsc reports no errors in `game.ts` (App.vue may still error until Task 12 — that is fine; if so, run `npx vue-tsc --noEmit` and confirm the only errors are in `App.vue`/`main.ts`/deleted components).

- [ ] **Step 5: Commit**

```bash
git add src/game.ts
git commit -m "Derive switches and signals from the connection model in game.ts"
```

---

## Task 11: The single `Tile.vue`

**Files:**
- Create: `src/components/Tile.vue`
- Test: `tests/e2e/game.spec.ts` (assertions already cover `.tile`, `.switch-box`, `.depot-building`, `.signal`; keep those class names)

This component renders any cell from `props.tile: TileCell` at a known `coordId`. It reuses `TileRail.vue` for drawing and lifts the signal markup from `TileStraight.vue` and the switch markup from `TileIntersectionComplete.vue`. Preserve these CSS class names so e2e passes: `.tile`, `.tile-rail` (via TileRail), `.signal`, `.signal--<port>`, `.switch-box`, `.switch-box--<i>`, `.depot-building`, `.clickable`.

- [ ] **Step 1: Create the component**

```vue
<!-- src/components/Tile.vue -->
<template>
  <div
    class="tile clickable"
    :class="[kindClass, { 'tile-depot': isDepot }]"
    :style="reservationStyle"
    @click="onTileClick"
  >
    <TileRail :possible-routes="railRoutes" />

    <!-- Signals (straights only) -->
    <svg
      v-for="light in signalLights"
      :key="'sig' + light.exitPort"
      class="signal"
      :class="[
        `signal--${light.exitPort}`,
        {
          'signal--forced-green': light.override === 'green',
          'signal--forced-red': light.override === 'red',
        },
      ]"
      width="12"
      height="20"
      @click.stop="cycleSignal(light.exitPort)"
    >
      <rect
        width="12"
        height="20"
        rx="3"
        fill="#222"
        :stroke="
          light.override === 'green'
            ? '#34c759'
            : light.override === 'red'
            ? '#ff3b30'
            : 'none'
        "
        stroke-width="2"
      />
      <circle cx="6" cy="6" r="4" :fill="light.aspect === 'stop' ? '#ff3b30' : '#5a1512'" />
      <circle cx="6" cy="14" r="4" :fill="light.aspect === 'proceed' ? '#34c759' : '#14361d'" />
    </svg>

    <!-- Junction switches -->
    <template v-if="isJunction">
      <svg
        v-for="entry in junctionEntries"
        :key="'sw' + entry"
        :class="[
          `switch-box switch-box--${entry}`,
          { 'switch-box--locked': isSwitchLocked },
        ]"
        width="24"
        height="18"
        @click.stop="changeSwitch(entry)"
      >
        <circle class="bulb--base" cx="12" cy="13" r="3" />
      </svg>
    </template>

    <!-- Depot -->
    <template v-if="isDepot">
      <img class="depot-building" :class="depotFacingClass" :src="depotBuildingImg" />
      <div class="depot-interaction" :style="depotColorStyle" />
    </template>

    <div v-if="config.debug" class="debug">
      <div class="debug-coordinates" v-text="coordId"></div>
      <div>{{ kind }}</div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import type { Game } from "@/game";
import { Position, ActiveIntersection, Route } from "@/types";
import {
  TileCell,
  kindOf,
  partnersOf,
  portsOf,
  armExit,
  isJunctionEntry,
} from "@/tiles/model";
import { segmentPathD } from "@/sim/pathGeometry";
import { railPathsFor } from "@/tiles/geometry";
import depotBuildingImg from "@/assets/depot.png";

@Component
class Tile extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Inject({ from: "game" }) game!: Game;
  @Prop({ type: Object, required: true }) tile!: TileCell;
  @Prop({ type: String, required: true }) coordId!: string;

  depotBuildingImg = depotBuildingImg;

  get kind() {
    return kindOf(this.tile);
  }
  get kindClass() {
    return `tile-kind--${this.kind}`;
  }
  get isDepot() {
    return this.tile.role === "depot";
  }
  get isJunction() {
    return portsOf(this.tile.connections).filter(p => p !== Position.Center)
      .length >= 3;
  }

  // Rail/sleeper paths for every connection, in the shape TileRail expects.
  get railRoutes(): Route[] {
    const size = this.config.tileSize;
    const off = this.config.railDistanceFromPath;
    return this.tile.connections.map(([a, b]) => ({
      path: segmentPathD(a, b, size),
      rails: railPathsFor(a, b, size, off),
      leavesAtPosition: b,
    }));
  }

  // Entry ports that are junction entries (need a switch widget).
  get junctionEntries(): Position[] {
    return portsOf(this.tile.connections).filter(p =>
      isJunctionEntry(this.tile.connections, p)
    );
  }

  // --- signals (lifted from TileStraight) ---
  get signalLights() {
    if (!this.tile.signals) return [];
    const exits = portsOf(this.tile.connections).filter(
      p => p !== Position.Center
    );
    return exits.map(exitPort => ({
      exitPort,
      aspect: this.game.signalAspects[`${this.coordId}:${exitPort}`] ?? "proceed",
      override:
        this.game.signalOverrides[`${this.coordId}:${exitPort}`] ?? "auto",
    }));
  }
  cycleSignal(exitPort: Position) {
    this.game.cycleSignal(this.coordId, exitPort);
  }

  // --- switches (lifted from TileIntersectionComplete) ---
  get isSwitchLocked(): boolean {
    switch (this.config.switchLockMode) {
      case "reserved":
        return (
          !!this.game.reservations[this.coordId] ||
          !!this.game.occupied[this.coordId]
        );
      case "occupied":
        return !!this.game.occupied[this.coordId];
      default:
        return false;
    }
  }
  changeSwitch(entry: Position) {
    if (this.isSwitchLocked) return;
    const partners = partnersOf(this.tile.connections, entry);
    const cur = this.game.switches[this.coordId]?.[entry] ?? ActiveIntersection.Left;
    const arms = [
      ActiveIntersection.Left,
      ActiveIntersection.Straight,
      ActiveIntersection.Right,
    ];
    // Advance to the next arm whose geometric exit is an actual partner.
    for (let i = 1; i <= arms.length; i++) {
      const arm = arms[(arms.indexOf(cur) + i) % arms.length];
      const exit = armExit(entry, arm);
      if (exit !== null && partners.includes(exit)) {
        if (!this.game.switches[this.coordId]) this.game.switches[this.coordId] = {};
        this.game.switches[this.coordId][entry] = arm;
        return;
      }
    }
  }

  // --- depot (lifted from TileDepot) ---
  get depotFacingClass(): string {
    // The depot's outer port (the non-Center end of its single connection).
    const conn = this.tile.connections[0];
    if (!conn) return "tile-rotation--top";
    const outer = conn[0] === Position.Center ? conn[1] : conn[0];
    return {
      [Position.Top]: "tile-rotation--top",
      [Position.Right]: "tile-rotation--right",
      [Position.Bottom]: "tile-rotation--bottom",
      [Position.Left]: "tile-rotation--left",
    }[outer as number] as string;
  }
  get depotColorStyle() {
    return { backgroundColor: this.game.depotColors[this.coordId] };
  }

  // --- reservation overlay (lifted from TileBase) ---
  get reservationStyle(): Record<string, string> {
    if (!this.config.debug) return {};
    const owner = this.game.reservations[this.coordId];
    if (!owner) return {};
    return { backgroundColor: this.game.trainColors[owner] ?? "yellow" };
  }

  onTileClick() {
    // Play-mode tiles are not rotated by clicking any more (rotation is baked
    // into the level / handled by the editor). Click is reserved for the editor
    // phase; in play mode it is a no-op. (Signals/switches handle their own
    // clicks via @click.stop.)
  }
}

export default toNative(Tile);
</script>

<style lang="scss" scoped>
.tile {
  position: relative;
  width: 100%;
  height: 100%;
}
/* Signal + switch + depot styles are copied verbatim from the old
   TileStraight.vue / TileIntersectionComplete.vue / TileDepot.vue <style>
   blocks. Paste them here unchanged (signal--0..3 offsets, switch-box--0..3
   positions and locked ring, depot-building facing transforms, depot-interaction
   dot). */
</style>
```

- [ ] **Step 2: Copy the styles**

Paste the `<style scoped>` blocks from the old `TileStraight.vue` (`.signal*`), `TileIntersectionComplete.vue` (`.switch-box*`), and `TileDepot.vue` (`.tile-depot`, `.depot-building`, facing transforms, `.depot-interaction`) into `Tile.vue`'s style block verbatim. These are pure CSS and need no change.

- [ ] **Step 3: Type-check the component in isolation**

Run: `npx vue-tsc --noEmit`
Expected: no new errors in `Tile.vue` (App.vue/main.ts errors remain until Tasks 12–13).

- [ ] **Step 4: Commit**

```bash
git add src/components/Tile.vue
git commit -m "Add single data-driven Tile.vue"
```

---

## Task 12: Migrate `App.vue` to the new level + `<Tile>`

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Replace the level definition**

Change the script imports:

```ts
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
```

Replace the entire `@Provide() level: LevelDefinition = { ... }` block with the migrated level below. This is the literal translation of today's 40 cells; empty cells (`0,5`, `1,5`) are omitted. Junctions previously built via `disabledRoutes` become `expandKind("cross", 0, { disable: [...] })` using the **resolved (already-rotated) port pairs** that were disabled. Where the original disabled *all* arms of a side (an edge with no through-traffic), drop that edge's pairs.

```ts
@Provide() level: Level = {
  "0,0": expandKind("curve", 1),
  "1,0": expandKind("straight", 1, { signals: true }),
  // 2,0 / 3,0: crosses with the Top edge fully disabled (was disabledRoutes Top:[all]).
  "2,0": expandKind("cross", 0, { disable: [[Position.Top, Position.Bottom], [Position.Top, Position.Right], [Position.Left, Position.Top]] }),
  "3,0": expandKind("cross", 0, { disable: [[Position.Top, Position.Bottom], [Position.Top, Position.Right], [Position.Left, Position.Top]] }),
  "4,0": expandKind("straight", 1),
  "5,0": expandKind("depot", 3),
  "6,0": expandKind("depot", 2),
  "0,1": expandKind("cross", 0, { disable: [[Position.Left, Position.Right], [Position.Bottom, Position.Left], [Position.Left, Position.Top]] }),
  "1,1": expandKind("depot", 3),
  "2,1": expandKind("straight", 0, { signals: true }),
  "3,1": expandKind("curve", 0),
  "4,1": expandKind("straight", 1, { signals: true }),
  "5,1": expandKind("straight", 1),
  "6,1": expandKind("cross", 0, { disable: [[Position.Left, Position.Right], [Position.Top, Position.Right], [Position.Right, Position.Bottom]] }),
  "0,2": expandKind("straight", 0),
  "1,2": expandKind("depot", 1),
  "2,2": expandKind("cross", 0),
  "3,2": expandKind("straight", 1),
  "4,2": expandKind("straight", 1, { signals: true }),
  "5,2": expandKind("straight", 1),
  "6,2": expandKind("cross", 0, { disable: [[Position.Left, Position.Right], [Position.Top, Position.Right], [Position.Right, Position.Bottom]] }),
  "0,3": expandKind("curve", 0),
  "1,3": expandKind("straight", 1),
  "2,3": expandKind("cross", 0, { disable: [[Position.Top, Position.Right], [Position.Left, Position.Top], [Position.Bottom, Position.Left], [Position.Right, Position.Bottom]] }),
  "3,3": expandKind("straight", 1),
  "4,3": expandKind("cross", 0, { disable: [[Position.Top, Position.Bottom], [Position.Top, Position.Right], [Position.Left, Position.Top]] }),
  "5,3": expandKind("cross", 0, { disable: [[Position.Top, Position.Bottom], [Position.Top, Position.Right], [Position.Left, Position.Top]] }),
  "6,3": expandKind("cross", 0, { disable: [[Position.Left, Position.Right], [Position.Top, Position.Right], [Position.Right, Position.Bottom]] }),
  "0,4": expandKind("depot", 1),
  "1,4": expandKind("straight", 1),
  "2,4": expandKind("cross", 0),
  "3,4": expandKind("straight", 1),
  "4,4": expandKind("curve", 3),
  "5,4": expandKind("depot", 0),
  "6,4": expandKind("straight", 0),
  "2,5": expandKind("curve", 0),
  "3,5": expandKind("straight", 1, { signals: true }),
  "4,5": expandKind("straight", 1),
  "5,5": expandKind("straight", 1),
  "6,5": expandKind("curve", 3),
};
```

Add the `Position` import if not present: `import { ... Position } from "@/types";` (it already imports several types — add `Position`).

> Implementer note: the exact `disable` pairs above are a best-effort translation of the original `disabledRoutes`. After Task 14, if any train misroutes vs. the pre-refactor behaviour, compare `connectionsToExitPort` for that tile against the old `tileExitPort` (preserved in git history) and adjust the disabled pairs. The e2e suite (no two trains share a tile; trains leave depots) is the backstop.

- [ ] **Step 2: Update the template to render `<Tile>`**

Replace the `<component :is="tile.component" ...>` block. The level is now keyed by id with no `x`/`y`/`component`; iterate entries and pass `coordId`:

```html
<div
  v-for="(tile, key) in level"
  :key="key"
  class="level-tile"
  :style="{ width: config.tileSize + 'px', height: config.tileSize + 'px' }"
>
  <Tile :tile="tile" :coord-id="String(key)" class="tile-component" />
</div>
```

Remove the now-dead debug-coordinates `<div>` here (the coordinate is shown inside `Tile.vue`'s debug block). Keep the `.level` wrapper and its `width` style.

> Grid layout note: the old level relied on iteration order + flex-wrap with empty cells present. Two cells (`0,5`,`1,5`) are now omitted, which would shift the wrap. To preserve the 7-wide grid, render empty placeholders for missing coords. Implement by iterating a generated coordinate list instead of `level` directly:

```ts
// in the class
get gridCells(): { key: string; tile: Level[string] | null }[] {
  const out: { key: string; tile: Level[string] | null }[] = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < this.config.levelSizeX; x++) {
      const key = `${x},${y}`;
      out.push({ key, tile: this.level[key] ?? null });
    }
  }
  return out;
}
```

and the template:

```html
<div
  v-for="cell in gridCells"
  :key="cell.key"
  class="level-tile"
  :style="{ width: config.tileSize + 'px', height: config.tileSize + 'px' }"
>
  <Tile v-if="cell.tile" :tile="cell.tile" :coord-id="cell.key" class="tile-component" />
</div>
```

Update `buildTrainDefs`/`createGame` call: `createGame(this.level, ...)` still passes `this.level` (now `Level`). `getCoordinatesId` use is unaffected.

- [ ] **Step 3: Commit (build verified in Task 14)**

```bash
git add src/App.vue
git commit -m "Migrate App.vue level to the connection model and render Tile.vue"
```

---

## Task 13: Update `main.ts` registration + delete old components

**Files:**
- Modify: `src/main.ts`
- Delete: `src/components/TileStraight.vue`, `TileCurve.vue`, `TileDepot.vue`, `TileIntersectionComplete.vue`, `TileBase.ts`

- [ ] **Step 1: Update `main.ts`**

```ts
import { createApp } from "vue";
import App from "./App.vue";
import { gameConfig, GAME_CONFIG_KEY } from "./gameConfig";

import TileRail from "@/components/TileRail.vue";
import Tile from "@/components/Tile.vue";
import Train from "@/components/Train.vue";
import DebugShowRoutes from "@/components/DebugShowRoutes.vue";

const app = createApp(App);
app.provide(GAME_CONFIG_KEY, gameConfig);
app.component("TileRail", TileRail);
app.component("Tile", Tile);
app.component("Train", Train);
app.component("DebugShowRoutes", DebugShowRoutes);
app.mount("#app");
```

- [ ] **Step 2: Delete the old tile components**

```bash
git rm src/components/TileStraight.vue src/components/TileCurve.vue src/components/TileDepot.vue src/components/TileIntersectionComplete.vue src/components/TileBase.ts
```

- [ ] **Step 3: Remove dead types (optional, only if unreferenced)**

Run a search to confirm `LevelDefinition`, `TileObject`, `PossibleRoutesPerRotation`, `ActiveIntersectionPerPosition`, `DisabledIntersectionsPerPosition` are unused:

Run: `grep -rn "LevelDefinition\|TileObject" src tests`
If no results remain, delete those interfaces from `src/types.ts`. If `DebugShowRoutes.vue` still imports `PossibleRoutes`/`Route`, leave `Route` in place. Do not remove `Position`, `ActiveIntersection`, `Rotations`, `Coordinates`, `TrafficLight*` enums (still used).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Register only Tile.vue; remove the four legacy tile components"
```

---

## Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check + build**

Run: `npm run build`
Expected: PASS (vue-tsc clean, vite build succeeds). Fix any remaining `LevelDefinition`/`.component`/`tile.x` references the search missed.

- [ ] **Step 2: Full unit suite**

Run: `npm run test:unit`
Expected: all green. The migrated `model`, `kinds`, `geometry`, `topology`, `network`, `simulation`, `colorAssignment` specs pass.

- [ ] **Step 3: e2e**

Run: `npx playwright install chromium` (once), then `npm run test:e2e`
Expected: all four tests pass — 40 `.tile`, 2 locomotives leave their depots, no two trains share a tile, signal hold turns a signal to Stop, no console errors.

> If "no two trains share a tile" or "trains leave depots" fails, a `disable` translation in Task 12 is wrong: open the failing tile, compare `connectionsToExitPort(cell.connections, entry, arm)` to the legacy `tileExitPort` from git history for each entry/arm, and correct the disabled pairs. Re-run.

- [ ] **Step 4: Visual smoke (manual)**

Run: `npm run dev`, open http://localhost:5173. Confirm rails/curves/depots/switches/signals render as before and trains run. (Rail drawing is re-derived; minor pixel differences are acceptable, gross breakage is not.)

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "Fix level translation to match pre-refactor routing"
```

---

## Self-review (completed by plan author)

- **Spec coverage:** Goals 1 (shared model) → Tasks 1–10; Goal 2 (single Tile.vue) → Tasks 11–13; Goal 6 (behaviour preserved + green) → Task 14. Goals 3–5 (auto-tiling, editor, procgen) are explicitly deferred to later phase plans, as stated in the spec's decomposition.
- **Type consistency:** `Level`/`TileCell`/`PortPair`/`Port` defined in Task 1 and used identically thereafter. `connectionsToExitPort(connections, entry, arm?)` signature consistent across model, network, and Tile.vue. `getSwitch` resolver signature unchanged. `armExit`, `partnersOf`, `portsOf`, `isJunctionEntry` all defined in `model.ts` before use.
- **Placeholder scan:** No TBD/TODO. The one judgement-call area (App.vue `disable` translation) ships with concrete pairs plus an explicit verification-and-fix procedure gated by the e2e suite.
- **Deferred-by-design:** play-mode click rotation is intentionally dropped (rotation is baked into the level; live rotation returns in the editor phase) — noted in Tile.vue Task 11.
