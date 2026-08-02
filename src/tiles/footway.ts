import { Position } from "@/types";
import type { Level, Port, TileCell } from "@/tiles/model";
import { parseCoordId } from "@/tiles/model";
import { laneCount, roadPortsOf } from "@/tiles/lanes";
import { oppositePort } from "@/sim/topology";
import { roadCurveKerbEdge, roadKerbEdge } from "@/tiles/roadGeometry";
import { accessTileOf } from "@/tiles/access";

// FOOTWAYS — the pavement (Fussweg / Trottoir) beside a street, and the graph
// people walk on.
//
// Derived by default: any tile carrying a road has a pavement on both sides
// unless it says `footway: "none"`. So every board that already exists grows
// pavements for free, and the tile field is only ever an opt-out — a motorway,
// a service road, a car-park aisle.
//
// WHY THIS IS NOT A LANE, which is the obvious first instinct and the wrong one:
//
//  · A pavement is BIDIRECTIONAL on one strip. A `Lane` is directed, so faking
//    it takes two lanes per pavement — and every car query then iterates twice
//    the lanes to skip them again.
//  · It sits OUTSIDE the kerb. `laneOffset.ts` positions lanes WITHIN the
//    carriageway; the pavement is beyond its edge by construction.
//  · Its users MAY OVERLAP — two people stand in the same doorway. Following
//    gaps, swept-body checks and junction conflict matrices all exist in
//    `road.ts` to guarantee the exact opposite, and every one of them would need
//    to learn an exception.
//  · Pedestrians do not queue at a junction like traffic. They cross it.
//
// The reuse a "footway lane" is reaching for is ROUTING, and routing is the part
// that does not need it: walking is an undirected walk over adjacent footway
// tiles — a flood fill, not a directed lane graph. So the pavement is its own
// small axis, and people get their own small simulation over it
// (`sim/pedestrians.ts`).
//
// Design: docs/superpowers/specs/2026-08-01-citizens-and-cities-design.md §9.1

// A lane is 14% of a tile (`roadGeometry.ts`), and everything below is in the
// same 0..100 ground units the tile art uses.
const LANE_W = 14;
// How far past the tarmac edge the middle of the pavement sits.
const PAVEMENT_GAP = 4;
/** How wide the paved strip is drawn. */
export const PAVEMENT_WIDTH = 8;

/** Does this cell carry a pavement? Any road, unless it opted out. */
export function hasFootway(cell: TileCell | undefined): boolean {
  if (!cell?.road || cell.road.length === 0) return false;
  return cell.footway !== "none";
}

/**
 * Half the carriageway's width on this cell, in ground units — where the kerb
 * is, and therefore where the pavement starts. Derived from the LANES actually
 * present, so a wide road gets its pavement pushed out and a narrow one does
 * not end up with the path drawn on the tarmac.
 */
export function roadHalfUnits(cell: TileCell | undefined): number {
  const road = cell?.road;
  if (!road?.length) return LANE_W;
  let widest = 2;
  for (const port of roadPortsOf(road)) {
    if (port === Position.Center) continue;
    const across = laneCount(road, port) + laneCount(road, oppositePort(port));
    if (across > widest) widest = across;
  }
  return (widest / 2) * LANE_W;
}

/** The centreline offset of each pavement on this cell, in ground units. */
export function pavementOffsets(cell: TileCell | undefined): [number, number] {
  const half = roadHalfUnits(cell) + PAVEMENT_GAP + PAVEMENT_WIDTH / 2;
  return [half, -half];
}

// --- the walking graph -------------------------------------------------------

const STEPS: [Port, number, number][] = [
  [Position.Top, 0, -1],
  [Position.Right, 1, 0],
  [Position.Bottom, 0, 1],
  [Position.Left, -1, 0],
];

/**
 * The footway tiles you can step to from here: an adjacent tile whose road
 * meets this one's, both carrying a pavement.
 *
 * Adjacency, not port-exact traversal — a pedestrian crosses the mouth of a
 * side street on the same pavement, and can cross the road itself at any point.
 * The honest question at this scale, and it never disagrees with the eye.
 */
export function walkNeighbours(level: Level, id: string): string[] {
  if (!hasFootway(level[id])) return [];
  const { x, y } = parseCoordId(id);
  const out: string[] = [];
  for (const [, dx, dy] of STEPS) {
    const nid = `${x + dx},${y + dy}`;
    if (hasFootway(level[nid])) out.push(nid);
  }
  return out;
}

/**
 * A walking route from one PLOT to another: out of the door, along the
 * pavements, and in at the far end.
 *
 * `[origin, accessTile, ...pavements..., accessTile, destination]`, or null
 * when either end has no street in reach or no pavement connects them. A null
 * is not a refusal — the citizen layer falls back to its walking clock, so a
 * town with no pavements still works exactly as it did.
 *
 * Breadth-first, so the route is the fewest tiles — which for a walk is also
 * the shortest, since every step is one tile.
 */
export function planWalk(level: Level, fromPlot: string, toPlot: string): string[] | null {
  if (fromPlot === toPlot) return null;
  const start = accessTileOf(level, fromPlot);
  const goal = accessTileOf(level, toPlot);
  if (!start || !goal) return null;
  if (!hasFootway(level[start]) || !hasFootway(level[goal])) return null;
  if (start === goal) return [fromPlot, start, toPlot];

  const prev = new Map<string, string>([[start, ""]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const next of walkNeighbours(level, cur)) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === goal) {
        const path: string[] = [];
        for (let at = goal; at; at = prev.get(at) as string) path.unshift(at);
        return [fromPlot, ...path, toPlot];
      }
      queue.push(next);
    }
  }
  return null;
}

// --- the drawing -------------------------------------------------------------

// Pale stone, a touch lighter than the road and cooler than the town's tan, so
// it reads as a paved strip against both the carriageway and the ground.
export const PAVEMENT_FILL = "hsl(210 8% 72%)";

/**
 * The pavements of one cell, as stroked SVG paths in its own 0..100 ground
 * space — a band on each side of every through movement the road makes.
 *
 * Reuses the road's OWN kerb geometry (`roadKerbEdge` for a straight,
 * `roadCurveKerbEdge` for a bend) at a larger offset, so the pavement follows
 * exactly where the tarmac edge goes and a bend's pavement bends with it. A
 * hand-rolled parallel line would drift on every curve.
 *
 * Drawn on the ground layer, so the road surface and every building sit on top.
 */
export function pavementPaths(cell: TileCell | undefined, size = 100): string {
  if (!hasFootway(cell)) return "";
  const road = cell?.road ?? [];
  const scale = size / 100;
  const off = (roadHalfUnits(cell) + PAVEMENT_GAP + PAVEMENT_WIDTH / 2) * scale;
  const width = PAVEMENT_WIDTH * scale;

  // One band per distinct movement across the tile, deduplicated: a two-way
  // street is two lanes over the same ground and must not paint its pavement
  // twice (the overlap shows as a seam at the tile edge).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const lane of road) {
    for (const to of lane.to) {
      if (to === Position.Center || lane.from === Position.Center) continue;
      const key = [lane.from, to].sort((a, b) => a - b).join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      const straight = to === oppositePort(lane.from);
      for (const side of [1, -1] as const) {
        const d = straight
          ? roadKerbEdge(lane.from, to, size, off, off, side)
          : roadCurveKerbEdge(lane.from, to, size, off, side);
        out.push(
          `<path d="${d}" fill="none" stroke="${PAVEMENT_FILL}" stroke-width="${width.toFixed(2)}" stroke-linecap="butt" />`
        );
      }
    }
  }
  return out.join("");
}
