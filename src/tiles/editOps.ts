import { Position, ActiveIntersection } from "@/types";
import {
  Port,
  PortPair,
  TileCell,
  samePair,
  armExit,
  partnersOf,
  defaultArmFor,
} from "@/tiles/model";
import type { Lane, LaneKind } from "@/tiles/lanes";
import { nWayLanes } from "@/tiles/lanes";

// Pure, immutable single-cell editing operations used by the level editor. Each
// returns a new TileCell so Vue's reactive Level can swap the entry in place.

export function emptyCell(): TileCell {
  return { connections: [] };
}

// Add the connection if absent, remove it if already present (order-independent).
export function toggleConnection(cell: TileCell, a: Port, b: Port): TileCell {
  const pair: PortPair = [a, b];
  const exists = cell.connections.some(c => samePair(c, pair));
  const connections = exists
    ? cell.connections.filter(c => !samePair(c, pair))
    : [...cell.connections, pair];
  return { ...cell, connections };
}

// Ensure a connection is present without ever removing one (unlike
// toggleConnection). Idempotent — used when laying a route so re-crossing a
// tile forms a junction instead of deleting the rail.
export function addConnection(cell: TileCell, a: Port, b: Port): TileCell {
  if (cell.connections.some(c => samePair(c, [a, b]))) return cell;
  return { ...cell, connections: [...cell.connections, [a, b]] };
}

export function removeConnection(cell: TileCell, a: Port, b: Port): TileCell {
  return {
    ...cell,
    connections: cell.connections.filter(c => !samePair(c, [a, b])),
  };
}

// Make the cell a depot facing `facing` (a single border<->Center connection).
export function setDepot(cell: TileCell, facing: Port): TileCell {
  return { connections: [[facing, Position.Center]], role: "depot" };
}

// The outer (non-Center) port of a depot, or null if the cell isn't a depot.
export function depotFacing(cell: TileCell): Port | null {
  if (cell.role !== "depot") return null;
  const conn = cell.connections[0];
  if (!conn) return null;
  return conn[0] === Position.Center ? conn[1] : conn[0];
}

const FACING_CYCLE: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

// Rotate a depot's facing N->E->S->W.
export function rotateDepot(cell: TileCell): TileCell {
  const cur = depotFacing(cell) ?? Position.Top;
  const next = FACING_CYCLE[(FACING_CYCLE.indexOf(cur) + 1) % 4];
  return setDepot(cell, next);
}

// Add/remove a per-direction signal on `port`.
export function toggleSignalPort(cell: TileCell, port: Port): TileCell {
  const cur = cell.signals ?? [];
  const signals = cur.includes(port)
    ? cur.filter(p => p !== port)
    : [...cur, port];
  return { ...cell, signals };
}

// Cycling order matches Tile.vue's runtime changeSwitch so the editor and play
// feel identical.
const ARMS: ActiveIntersection[] = [
  ActiveIntersection.Left,
  ActiveIntersection.Straight,
  ActiveIntersection.Right,
];

// The valid arms for an entry (those whose geometric exit is a real partner),
// in ARMS order. Empty unless `entry` is a switchable junction entry.
function validArms(cell: TileCell, entry: Port): ActiveIntersection[] {
  const partners = partnersOf(cell.connections, entry);
  if (partners.length <= 1) return []; // straight/curve/depot: no switch
  return ARMS.filter(a => {
    const exit = armExit(entry, a);
    return exit !== null && partners.includes(exit);
  });
}

// Advance the authored starting arm for `entry` to the next valid arm (cyclic),
// starting from the currently-effective arm (the authored arm if any, else the
// computed first-valid one — the same arm the editor displays). Writes it into a
// fresh cell's `defaultArms`. No-op if `entry` is not a switchable junction entry.
export function cycleDefaultArm(cell: TileCell, entry: Port): TileCell {
  const valid = validArms(cell, entry);
  if (valid.length === 0) return cell;
  const current = defaultArmFor(cell, entry) ?? valid[0];
  const idx = valid.indexOf(current);
  const next = valid[(idx + 1) % valid.length];
  return { ...cell, defaultArms: { ...cell.defaultArms, [entry]: next } };
}

// --- Road layer editing -------------------------------------------------------
// The road layer (`cell.road`) is edited with the same reducer shape as rail
// `connections`, on a separate layer. A cell may carry road without rail (a plain
// road tile) or both (a level crossing).

// Add or remove a single directed movement (from -> to) on the cell's lanes,
// keeping one index-0 lane per approach.
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

// True when both directions of the undirected edge a<->b are present.
function hasEdge(road: Lane[], a: Port, b: Port): boolean {
  const ab = road.some(l => l.from === a && l.to.includes(b));
  const ba = road.some(l => l.from === b && l.to.includes(a));
  return ab && ba;
}

// Toggle a two-way road edge: add both directions if absent, drop both if present.
export function toggleRoad(cell: TileCell, a: Port, b: Port): TileCell {
  const road = cell.road ?? [];
  if (hasEdge(road, a, b)) {
    return { ...cell, road: dropMovement(dropMovement(road, a, b), b, a) };
  }
  return { ...cell, road: upsertMovement(upsertMovement(road, a, b), b, a) };
}

// Set a two-way road edge to exactly `count` lanes per direction. For a plain
// straight or curve (no junction exits), the edge is fully replaced so drawing
// over an existing road with a different count selected upgrades or downgrades
// it in place. For a junction approach (the lane has exits beyond this edge),
// the additive merge is used instead to preserve the other movements.
export function addRoad(cell: TileCell, a: Port, b: Port, count = 1, kind?: LaneKind): TileCell {
  const road = cell.road ?? [];
  // Detect junction: an approach whose `to[]` includes exits other than the
  // partner port. Replacing such a lane would silently drop those movements.
  const aIsJunction = road.some(l => l.from === a && l.to.some(t => t !== b));
  const bIsJunction = road.some(l => l.from === b && l.to.some(t => t !== a));
  if (aIsJunction || bIsJunction) {
    return { ...cell, road: upsertMovement(upsertMovement(road, a, b), b, a) };
  }
  // Simple edge: replace with the exact lane count (upgrade or downgrade).
  const stripped = dropMovement(dropMovement(road, a, b), b, a);
  return { ...cell, road: [...stripped, ...nWayLanes(a, b, count, kind)] };
}

export function removeRoad(cell: TileCell, a: Port, b: Port): TileCell {
  const road = cell.road ?? [];
  return { ...cell, road: dropMovement(dropMovement(road, a, b), b, a) };
}
