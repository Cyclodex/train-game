import { Coordinates, Position } from "@/types";
import { Level, Port, partnersOf, parseCoordId } from "@/tiles/model";
import { neighborCoord, oppositePort } from "./topology";
import { getCoordinatesId } from "@/utils/tileHelpers";

// A router for TRAINS, in the shape the road layer has had all along
// (`sim/roadRouter.ts`: plan a path, then follow per-junction decisions) over
// the graph the editor's track planner already searches (`tiles/routePlanner.ts`:
// nodes are (tile, entry direction), because where you can go depends on where
// you came from — a curve entered from the north leaves east, not west).
//
// What it is NOT: a replacement for switches. A train with no plan still
// follows the points exactly as every train always has. A plan is what a train
// ON A LINE carries, and it means "my route is set" — the sim prefers the
// planned exit at the tiles the plan names and falls back to the switch
// everywhere else.

export interface RailStep {
  tileId: string;
  entryPort: Port;
  exitPort: Port;
}

export interface RailPlan {
  // The tile the plan ends on — which of the goals was actually nearest.
  goal: string;
  // In travel order, starting at the tile the train is on.
  steps: RailStep[];
  // `${tileId}:${entryPort}` → the port to leave by. What the sim consults on
  // every tile boundary; a leg of a shortest path never visits the same
  // (tile, entry) twice, so this is unambiguous by construction.
  exitAt: Map<string, Port>;
}

// Port expansion order. Fixed so an equal-cost tie always breaks the same way
// and a seeded run replays exactly.
const PORT_ORDER: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
  Position.Center,
];

const nodeKey = (tileId: string, entry: Port) => `${tileId}:${entry}`;

export interface RailRouteOpts {
  // Tiles the route may not pass THROUGH (it may still end on one). Used to
  // keep a line from cutting through the station it just left when the same
  // tile appears twice in a loop.
  avoid?: (tileId: string) => boolean;
  // Safety cap on the search, in nodes expanded.
  maxNodes?: number;
}

// The shortest path (fewest tiles) from a train's current position to whichever
// of `goals` is nearest, or null if none is reachable. Breadth-first over
// (tile, entry port): every edge is one tile, so BFS IS the shortest path and
// no priority queue is needed.
export function planRailRoute(
  level: Level,
  from: { coord: Coordinates; entryPort: Port },
  goals: string[],
  opts: RailRouteOpts = {}
): RailPlan | null {
  const goalSet = new Set(goals);
  if (goalSet.size === 0) return null;
  const avoid = opts.avoid ?? (() => false);
  const maxNodes = opts.maxNodes ?? 4000;

  const startId = getCoordinatesId(from.coord);
  const startKey = nodeKey(startId, from.entryPort);
  // parent[node] = how we got here, so the path can be walked back.
  const parent = new Map<string, { key: string; exitPort: Port }>();
  const seen = new Set<string>([startKey]);
  let queue: { tileId: string; entryPort: Port }[] = [
    { tileId: startId, entryPort: from.entryPort },
  ];
  let expanded = 0;

  while (queue.length && expanded < maxNodes) {
    const next: typeof queue = [];
    for (const node of queue) {
      expanded += 1;
      const tile = level[node.tileId];
      if (!tile) continue;
      // Where this tile can be left, given where we came in. A junction offers
      // several; a straight or curve exactly one.
      const exits = partnersOf(tile.connections, node.entryPort);
      for (const port of PORT_ORDER) {
        if (!exits.includes(port)) continue;
        // Center is a depot's inside: a dead end for routing, never a way through.
        if (port === Position.Center) continue;
        const nCoord = neighborCoord(parseCoordId(node.tileId), port);
        if (!nCoord) continue;
        const nId = getCoordinatesId(nCoord);
        const nTile = level[nId];
        if (!nTile || nTile.connections.length === 0) continue;
        const nEntry = oppositePort(port);
        // The neighbour must actually connect back through the shared edge, or
        // the two tiles merely touch.
        if (partnersOf(nTile.connections, nEntry).length === 0) continue;

        const key = nodeKey(nId, nEntry);
        if (seen.has(key)) continue;
        seen.add(key);
        parent.set(key, { key: nodeKey(node.tileId, node.entryPort), exitPort: port });

        if (goalSet.has(nId)) {
          return buildPlan(nId, key, startKey, parent);
        }
        // An avoided tile can be a destination but never a corridor.
        if (avoid(nId)) continue;
        next.push({ tileId: nId, entryPort: nEntry });
      }
    }
    queue = next;
  }
  return null;
}

// Walk the parent chain back to the start and turn it into ordered steps.
function buildPlan(
  goal: string,
  endKey: string,
  startKey: string,
  parent: Map<string, { key: string; exitPort: Port }>
): RailPlan {
  const steps: RailStep[] = [];
  let cursor = endKey;
  while (cursor !== startKey) {
    const from = parent.get(cursor);
    if (!from) break; // defensive: an unreachable chain
    const [tileId, entryStr] = splitKey(from.key);
    steps.push({ tileId, entryPort: Number(entryStr) as Port, exitPort: from.exitPort });
    cursor = from.key;
  }
  steps.reverse();
  const exitAt = new Map<string, Port>();
  for (const s of steps) exitAt.set(nodeKey(s.tileId, s.entryPort), s.exitPort);
  return { goal, steps, exitAt };
}

// A node key is `${tileId}:${entryPort}` and a tile id contains a comma, never
// a colon — so the LAST colon is the separator.
function splitKey(key: string): [string, string] {
  const i = key.lastIndexOf(":");
  return [key.slice(0, i), key.slice(i + 1)];
}

// Every station a train could reach from `fromTileId` by rail, itself
// included, in a stable order. A flood over the track graph rather than a
// route search: it answers "is there any way at all", which is what deciding
// where a PASSENGER may ask to go needs — the route to take is the train's
// problem, later.
export function reachableStations(level: Level, fromTileId: string): string[] {
  const seen = new Set<string>([fromTileId]);
  const stack = [fromTileId];
  while (stack.length) {
    const id = stack.pop()!;
    const cell = level[id];
    if (!cell) continue;
    for (const port of PORT_ORDER) {
      if (port === Position.Center) continue;
      if (!partnersOf(cell.connections, port).length) continue;
      const n = neighborCoord(parseCoordId(id), port);
      if (!n) continue;
      const nId = getCoordinatesId(n);
      const nCell = level[nId];
      if (!nCell || seen.has(nId)) continue;
      // They must actually join across the shared edge.
      if (!partnersOf(nCell.connections, oppositePort(port)).length) continue;
      seen.add(nId);
      stack.push(nId);
    }
  }
  return [...seen].filter(id => level[id]?.role === "station").sort();
}

// Every station tile on a board, in a stable order. The default line for a
// board that has not authored one, and what the mode offers as stops.
export function stationTilesOf(level: Level): string[] {
  return Object.keys(level)
    .filter(id => level[id]?.role === "station")
    .sort();
}
