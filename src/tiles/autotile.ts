import { Position } from "@/types";
import { Level, Port, PortPair, TileCell, parseCoordId } from "@/tiles/model";
import { neighborCoord } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";

// What the player painted onto a cell. Track auto-derives its connections from
// its connectable neighbours; a depot keeps its explicit facing; empty clears.
export type PaintKind = "track" | "depot" | "empty";

export interface CellInput {
  paint: PaintKind;
  facing?: Port; // depot outer edge (defaults to Top)
}

// Which orthogonal edges have a tile this cell should connect to. The caller
// decides "connectable" (track is always connectable; a depot only on the edge
// it faces) and passes the booleans, keeping this rule pure and testable.
export type Connectable = Partial<Record<Port, boolean>>;

const EDGES: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

// Every distinct-edge pair among a set of edges (used for 3+ way junctions).
function allPairs(edges: Port[]): PortPair[] {
  const out: PortPair[] = [];
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      out.push([edges[i], edges[j]]);
    }
  }
  return out;
}

// Derive a cell's canonical connections from what was painted and which of its
// neighbours it connects to.
//   0 edges -> empty
//   1 edge  -> dead-end stub (edge <-> Center)
//   2 edges -> straight or curve (single pair)
//   3-4     -> full junction (all distinct-edge pairs)
export function deriveConnections(
  self: CellInput,
  connectable: Connectable
): TileCell {
  if (self.paint === "empty") return { connections: [] };
  if (self.paint === "depot") {
    const facing = self.facing ?? Position.Top;
    return { connections: [[facing, Position.Center]], role: "depot" };
  }
  const edges = EDGES.filter(e => connectable[e]);
  if (edges.length === 0) return { connections: [] };
  if (edges.length === 1) return { connections: [[edges[0], Position.Center]] };
  if (edges.length === 2) return { connections: [[edges[0], edges[1]]] };
  return { connections: allPairs(edges) };
}

// A painted grid: cell id -> what the player put there. Cells absent from the
// map are empty.
export type PaintMap = Record<string, CellInput>;

function edgeToward(from: string, to: string): Port | null {
  const a = parseCoordId(from);
  for (const e of EDGES) {
    const n = neighborCoord(a, e)!;
    if (getCoordinatesId(n) === to) return e;
  }
  return null;
}

// Build a whole Level from a paint map via auto-tiling. Two passes so depot
// facings (toward an adjacent track) are known before track cells decide which
// edges connect to those depots.
//   - A depot faces the first adjacent track cell (default Top if none).
//   - A track cell connects to an edge if that neighbour is track, or is a depot
//     facing back toward this cell.
export function deriveLevel(paint: PaintMap): Level {
  const kindAt = (id: string): PaintKind => paint[id]?.paint ?? "empty";

  // Pass 1: depot facings.
  const facing: Record<string, Port> = {};
  for (const [id, cell] of Object.entries(paint)) {
    if (cell.paint !== "depot") continue;
    let f: Port = cell.facing ?? Position.Top;
    if (cell.facing === undefined) {
      const coord = parseCoordId(id);
      for (const e of EDGES) {
        const n = getCoordinatesId(neighborCoord(coord, e)!);
        if (kindAt(n) === "track") {
          f = e;
          break;
        }
      }
    }
    facing[id] = f;
  }

  // Pass 2: build every cell.
  const level: Level = {};
  for (const [id, cell] of Object.entries(paint)) {
    if (cell.paint === "empty") continue;
    if (cell.paint === "depot") {
      level[id] = deriveConnections({ paint: "depot", facing: facing[id] }, {});
      continue;
    }
    // track
    const coord = parseCoordId(id);
    const connectable: Connectable = {};
    for (const e of EDGES) {
      const nId = getCoordinatesId(neighborCoord(coord, e)!);
      const nk = kindAt(nId);
      if (nk === "track") connectable[e] = true;
      else if (nk === "depot") {
        // Connect only if the depot faces back toward this cell.
        const back = edgeToward(nId, id);
        if (back !== null && facing[nId] === back) connectable[e] = true;
      }
    }
    level[id] = deriveConnections({ paint: "track" }, connectable);
  }
  return level;
}
