import { Position } from "@/types";
import { Port, PortPair, TileCell } from "@/tiles/model";

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
