import { Position, Coordinates, ActiveIntersection } from "@/types";
import { oppositePort } from "@/sim/topology";
import type { Lane } from "./lanes";
import type { JunctionSignal } from "@/sim/junctionSignal";

export type Port = Position;
export type PortPair = [Port, Port];

export type TileKind =
  | "straight"
  | "curve"
  | "tjunction"
  | "cross"
  | "depot"
  | "dead-end"
  | "road-straight"
  | "road-taper"
  | "road-curve"
  | "road-tjunction"
  | "road-cross"
  | "crossing"
  | "empty";

// The canonical, authoritative description of one grid cell. `connections` is
// the single source of truth; kind/geometry/routing are all derived from it.
// What a cell IS, as opposed to what crosses it. `connections` and `road` say
// what travels through a tile; terrain says what the tile is made of. Absent =
// "grass", so every level authored before terrain existed still means the same
// thing. One rule reads it today — `canBuildOn` (water, rock and mountain block
// building); the rest — bridges over water, tunnels through mountain — arrive
// one at a time as EXCEPTIONS to that predicate. See tiles/terrain.ts.
export type TerrainKind =
  | "grass"
  | "farmland"
  | "forest"
  | "water"
  | "rock"
  | "mountain"
  | "urban";

export interface TileCell {
  connections: PortPair[];
  role?: "depot";
  // The ground under this cell. Absent = grass. See tiles/terrain.ts and
  // docs/superpowers/specs/2026-07-25-terrain-as-tile-data-design.md.
  terrain?: TerrainKind;
  // Exit ports that carry a signal (per-direction). Empty/undefined = none.
  signals?: Port[];
  // Road layer: port pairs describing a road crossing this cell, in the SAME
  // port space as rail `connections` but on a separate, non-connecting layer.
  // A cell may carry road without rail (a plain road tile) or both (a level
  // crossing). Cars traverse `road`; trains traverse `connections`; the two only
  // interact at a crossing via the gate (derived from rail reservation). See
  // docs/superpowers/specs/2026-06-05-roads-and-level-crossings-design.md.
  road?: Lane[];
  // Road-priority for junction arbitration: 0 = side road (default), 1 = main road.
  roadPriority?: number;
  // Street-junction traffic signals (ROAD / cars only). When present and not
  // "off", the road junction is signalised: cars obey per-arm green/amber/red on
  // top of the conflict-matrix yield. Only meaningful on a road junction; ignored
  // elsewhere. Round-trips through level JSON like `road`/`signals`. See
  // src/sim/junctionSignal.ts and the issue #38 design.
  signal?: JunctionSignal;
  // Authored starting switch arm per junction entry port (keyed by Port). Absent
  // entries fall back to the auto-computed first-valid arm. Only meaningful on a
  // switchable junction (cross / T-junction); ignored elsewhere. Round-trips
  // through level JSON like `signals`/`road`. See
  // docs/superpowers/specs/2026-06-06-junction-default-direction-design.md.
  defaultArms?: Partial<Record<Port, ActiveIntersection>>;
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

// Rotate a port clockwise by `steps` quarter-turns (T->R->B->L). Center is fixed.
export function rotatePort(port: Port, steps: number): Port {
  if (port === Position.Center) return port;
  return ((((port as number) + steps) % 4) + 4) % 4;
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

// The authored starting arm for a junction entry, but only when its geometric
// exit is still a real partner of that entry. Returns undefined for an
// unauthored entry OR for a stale arm whose exit was since deleted — so a
// left-over arm never drives routing to a connection that no longer exists.
export function defaultArmFor(
  cell: TileCell,
  entry: Port
): ActiveIntersection | undefined {
  const arm = cell.defaultArms?.[entry];
  if (arm === undefined) return undefined;
  const exit = armExit(entry, arm);
  if (exit === null) return undefined;
  return partnersOf(cell.connections, entry).includes(exit) ? arm : undefined;
}

// A human-readable label for the cell's shape. Derived purely from connections
// (+ the depot role). Used for sprite selection, debug, and the editor — never
// for routing.
export function kindOf(cell: TileCell): TileKind {
  if (cell.role === "depot") return "depot";
  const conns = cell.connections;
  const hasRoadLayer = (cell.road?.length ?? 0) > 0;

  // Level crossing: has both rail edges and road.
  if (conns.length > 0 && hasRoadLayer) return "crossing";

  // Road-only tiles: derive kind from the road's port set.
  if (conns.length === 0 && hasRoadLayer) {
    const road = cell.road!;
    const ports = new Set<Port>();
    for (const lane of road) {
      ports.add(lane.from);
      for (const to of lane.to) ports.add(to);
      for (const to of lane.busTo ?? []) ports.add(to);
    }
    if (ports.size >= 4) return "road-cross";
    if (ports.size === 3) return "road-tjunction";
    if (ports.size === 2) {
      const [a, b] = [...ports] as [Port, Port];
      if (a !== oppositePort(b)) return "road-curve";
      // A straight whose two ends carry a different number of physical lanes is
      // a taper (the lane-count transition tile, e.g. 2L on one side, 3L on the
      // other). Distinct lane indices per approach = that approach's lane count.
      // Both ends must carry lanes — a one-way straight (lanes only one way) has
      // an empty opposite approach and is a road-straight, not a taper.
      const countFrom = (p: Port) =>
        new Set(road.filter(l => l.from === p).map(l => l.index)).size;
      const ca = countFrom(a);
      const cb = countFrom(b);
      return ca > 0 && cb > 0 && ca !== cb ? "road-taper" : "road-straight";
    }
    return "road-straight";
  }

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

// --- Road layer helpers ------------------------------------------------------
// The road layer reuses the same Port space and rotation helpers as rail; these
// are the small derivations both the crossing stub and the full road system
// share. Keep routing/geometry derived from `road` the same way rail derives
// from `connections`.

// True when the cell carries any road. A pure road tile has connections:[] and a
// non-empty road; a level crossing has both.
export function hasRoad(cell: TileCell): boolean {
  return (cell.road?.length ?? 0) > 0;
}

// True when rail and road both pass through this cell — i.e. a level crossing.
// Rail must be real edge track (not just a Center stub) and road must exist.
export function isLevelCrossing(cell: TileCell): boolean {
  if (!hasRoad(cell)) return false;
  const railEdges = portsOf(cell.connections).filter(p => p !== Position.Center);
  return railEdges.length > 0;
}

// True when the level has no depots and at least one road tile — a pure road map
// with no rail layer. Used to skip train/depot requirements in validation and UI.
export function isRoadOnlyLevel(level: Level): boolean {
  let hasAnyRoad = false;
  for (const cell of Object.values(level)) {
    if (cell.role === "depot") return false;
    if (hasRoad(cell)) hasAnyRoad = true;
  }
  return hasAnyRoad;
}
