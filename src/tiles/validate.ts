import { Position } from "@/types";
import { Level, Port, portsOf, parseCoordId } from "@/tiles/model";
import { roadPortsOf } from "@/tiles/lanes";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";

export type IssueType =
  | "dangling-track" // a rail points at a neighbour that doesn't connect back
  | "isolated-depot" // a depot connects to nothing
  | "route-disconnected"; // a train can't reach its destination depot

export interface Issue {
  type: IssueType;
  tileId?: string;
  detail: string;
}

export interface TrainRoute {
  from: string; // start depot coord id
  to: string; // destination depot coord id
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
}

const EDGES: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

// Two adjacent tiles are physically joined when both expose the shared edge in
// their connections (switch state is ignored — a junction joins on every port).
function joins(level: Level, id: string, edge: Port): string | null {
  const tile = level[id];
  if (!tile || !portsOf(tile.connections).includes(edge)) return null;
  const n = neighborCoord(parseCoordId(id), edge);
  if (!n) return null;
  const nid = getCoordinatesId(n);
  const nt = level[nid];
  if (!nt || !portsOf(nt.connections).includes(oppositePort(edge))) return null;
  return nid;
}

// Adjacency for reachability: ids physically joined to `id`.
function neighboursOf(level: Level, id: string): string[] {
  const out: string[] = [];
  for (const e of EDGES) {
    const j = joins(level, id, e);
    if (j) out.push(j);
  }
  return out;
}

function reachable(level: Level, from: string): Set<string> {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of neighboursOf(level, cur)) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

// Validate a level's physical connectivity. `routes` (optional) additionally
// checks that each train can reach its destination depot.
export function validateLevel(
  level: Level,
  routes: TrainRoute[] = []
): ValidationResult {
  const issues: Issue[] = [];

  for (const [id, tile] of Object.entries(level)) {
    if (tile.connections.length === 0) continue;
    const edges = portsOf(tile.connections).filter(p => p !== Position.Center);

    // Dangling: an edge port that doesn't join a matching neighbour.
    for (const e of edges) {
      if (!joins(level, id, e)) {
        issues.push({
          type: "dangling-track",
          tileId: id,
          detail: `port ${Position[e]} of ${id} has no connecting neighbour`,
        });
      }
    }

    // Isolated depot: a depot whose only (Center) link joins nothing.
    if (tile.role === "depot" && neighboursOf(level, id).length === 0) {
      issues.push({
        type: "isolated-depot",
        tileId: id,
        detail: `depot ${id} is not connected to any track`,
      });
    }
  }

  for (const route of routes) {
    const seen = reachable(level, route.from);
    if (!seen.has(route.to)) {
      issues.push({
        type: "route-disconnected",
        detail: `depot ${route.from} cannot reach ${route.to}`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

export type RoadIssueType = "dangling-road"; // road points at a tile with no road back

export interface RoadIssue {
  type: RoadIssueType;
  tileId: string;
  detail: string;
}

// Validate the road layer separately from rail (so a level with no/partial roads
// doesn't fail rail validation). A road edge port is "dangling" only when it
// points at a neighbour tile that EXISTS in the level but exposes no matching
// road back. A road port pointing off the map (no tile at that coord) is a valid
// map-edge road end — cars enter and leave the level there.
export function validateRoads(level: Level): {
  ok: boolean;
  issues: RoadIssue[];
} {
  const issues: RoadIssue[] = [];
  for (const [id, tile] of Object.entries(level)) {
    const road = tile.road ?? [];
    if (road.length === 0) continue;
    const edges = roadPortsOf(road).filter(p => p !== Position.Center);
    for (const e of edges) {
      const n = neighborCoord(parseCoordId(id), e);
      if (!n) continue;
      const nid = getCoordinatesId(n);
      const nt = level[nid];
      if (!nt) continue; // off-grid: a valid map-edge road end
      const back = roadPortsOf(nt.road).includes(oppositePort(e));
      if (!back) {
        issues.push({
          type: "dangling-road",
          tileId: id,
          detail: `road port ${Position[e]} of ${id} has no connecting road neighbour`,
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
