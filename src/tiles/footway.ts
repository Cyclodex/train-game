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

/**
 * The road's own through movement on this cell: which way the carriageway runs.
 * The pavement follows it, and the zebra is painted square to it.
 */
export function roadThrough(cell: TileCell | undefined): { from: Port; to: Port } | null {
  for (const lane of cell?.road ?? []) {
    for (const exit of lane.to) {
      if (lane.from === Position.Center || exit === Position.Center) continue;
      return { from: lane.from, to: exit };
    }
  }
  return null;
}

/** Is there a zebra on this cell — somewhere people may cross the road? */
export function hasFootCrossing(cell: TileCell | undefined): boolean {
  return hasFootway(cell) && cell?.footCrossing === true;
}

/**
 * Is walking over this cell walking over the RAILWAY — a pedestrian level
 * crossing?
 *
 * Derived, like everything else here, and derived from what is already on the
 * tile: a pavement plus rails means the footway crosses the track. Every level
 * crossing on every board that exists is therefore one already, with nothing to
 * author — the same trick that gave every street a pavement for free.
 *
 * NOT a `footCrossing`, and the difference is the whole mechanic. A zebra is a
 * negotiation: the pedestrian claims it and the traffic gives way. A railway is
 * not. The train has absolute priority, the walker waits, and nothing the
 * walker does can hold the train up. That asymmetry is also what makes it safe
 * — there is no mutual wait to deadlock, so it needs no "go anyway" backstop.
 */
export function hasRailCrossing(cell: TileCell | undefined): boolean {
  return hasFootway(cell) && (cell?.connections?.length ?? 0) > 0;
}

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

/** The right-of-travel normal of a movement across a tile, in screen space (y down). */
function travelNormal(from: Port, to: Port): { x: number; y: number } {
  const v = portVector(to);
  const back = portVector(from);
  const dir = { x: v.x - back.x, y: v.y - back.y };
  return { x: -dir.y, y: dir.x };
}

/**
 * The signed lateral offset, in ground units, that puts a walker on pavement
 * `side` while they travel `entry`→`exit` across this cell.
 *
 * WHY THIS IS NOT JUST `pavementOffsets(cell)[0] * side`, which is what it was
 * and which is wrong half the time: a `side` is FIXED to the tile (it is which
 * bank of the street you are on, and `sideOfPlot` decides it against the road's
 * own through direction), but an offset handed to `laneSegmentPointAt` is
 * relative to the DIRECTION OF TRAVEL. Walk the same street back the other way
 * and right-of-travel points at the other bank, so a constant sign silently
 * teleports the walker across the carriageway.
 *
 * The symptom was people crossing the road anywhere but the zebra: on a board
 * whose canonical direction is eastbound, everybody walked east to the crossing,
 * changed sides properly, then walked WEST on the coordinates of the pavement
 * they had just left — and the driveway at the far end dragged them back over
 * the tarmac to reach their door.
 */
export function pavementOffsetFor(
  cell: TileCell | undefined,
  side: 1 | -1,
  entry: Port,
  exit: Port
): number {
  const off = pavementOffsets(cell)[0] * side;
  const through = roadThrough(cell);
  if (!through) return off;
  const a = travelNormal(entry, exit);
  const b = travelNormal(through.from, through.to);
  // Travelling against the tile's own direction flips which bank is on the
  // right. Square to it (dot 0) is ambiguous — leave the sign alone.
  return a.x * b.x + a.y * b.y < 0 ? -off : off;
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
 * One node of the walking graph: a tile AND which of its two pavements you are
 * on. The side is part of the STATE, not a cosmetic choice, and that is what
 * makes a crossing a mechanic rather than paint — the only way to change sides
 * is at a tile with a zebra on it.
 */
export interface WalkNode {
  tileId: string;
  side: 1 | -1;
}

export function walkNodeKey(n: WalkNode): string {
  return `${n.tileId}:${n.side}`;
}

/**
 * Which way, in world space, pavement `side` lies from this cell's carriageway.
 * The reference frame every `side` in this module is measured in: right of the
 * tile's own through movement is +1 (see `sideOfPlot`, `pavementOffsetFor`).
 *
 * On a bend the normal is diagonal — a corner's outer bank is north of its east
 * arm AND west of its south arm — which is exactly right, because only the
 * component ACROSS the arm you are walking matters at that arm's edge.
 */
function bankNormal(cell: TileCell | undefined, side: 1 | -1): { x: number; y: number } | null {
  const through = roadThrough(cell);
  if (!through) return null;
  const n = travelNormal(through.from, through.to);
  return { x: n.x * side, y: n.y * side };
}

/**
 * Carry a pavement side from one tile onto its neighbour: KEEP THE BANK, NOT
 * THE NUMBER.
 *
 * A `side` is measured against THAT TILE'S OWN through direction, and a tile's
 * through direction is only ever "whichever movement its lane list happens to
 * name first". Neighbours can therefore disagree about which bank +1 is: on
 * `/test/citizenwalk` the corner authored `twoWay(Right, Bottom)` reads its
 * OUTER bank as +1, while the straight beside it authored `twoWay(Left, Right)`
 * reads its SOUTH bank as +1. Those are opposite banks of the same street.
 *
 * Carrying the raw number across the seam therefore steps somebody over the
 * carriageway with no crossing under them — measured at 0.44 tiles, the exact
 * width of a road, in the middle of an otherwise ordinary walk. Which bank you
 * are on is the walker's real state; the sign is just how each tile spells it.
 */
export function sideAcross(
  level: Level,
  fromId: string,
  toId: string,
  side: 1 | -1
): 1 | -1 {
  const a = bankNormal(level[fromId], side);
  const b = bankNormal(level[toId], side);
  if (!a || !b) return side;
  const from = parseCoordId(fromId);
  const to = parseCoordId(toId);
  // The shared edge runs across the step, so the component that decides which
  // bank you meet it on is the one perpendicular to the way you stepped.
  const across: "x" | "y" = to.x === from.x ? "x" : "y";
  // Square to the seam (a bank that neither leads nor trails at this edge) is
  // ambiguous — there is nothing to match, so leave the sign alone.
  if (a[across] === 0 || b[across] === 0) return side;
  return (a[across] * b[across] < 0 ? -side : side) as 1 | -1;
}

/**
 * A walking route from one PLOT to another: out of the door, along the
 * pavements — crossing the road only where there is a crossing — and in at the
 * far end.
 *
 * Returns the tiles walked plus the side held on each, or null when either end
 * has no street in reach or no pavement connects them. A null is not a refusal:
 * the citizen layer falls back to its walking clock, so a town with no pavements
 * still works exactly as it did.
 *
 * Breadth-first over (tile, side), so the route is the fewest steps. A person
 * whose destination is across the road from the nearest crossing really does
 * walk down to it and back, and that detour is paid for in their journey time.
 */
export function planWalk(
  level: Level,
  fromPlot: string,
  toPlot: string
): { tiles: string[]; sides: (1 | -1)[] } | null {
  if (fromPlot === toPlot) return null;
  const start = accessTileOf(level, fromPlot);
  const goal = accessTileOf(level, toPlot);
  if (!start || !goal) return null;
  if (!hasFootway(level[start]) || !hasFootway(level[goal])) return null;

  // Which pavement each end is on: the side of the street the plot stands on.
  const startSide = sideOfPlot(level, fromPlot, start);
  const goalSide = sideOfPlot(level, toPlot, goal);
  if (startSide === null || goalSide === null) return null;

  const from: WalkNode = { tileId: start, side: startSide };
  const goalKey = walkNodeKey({ tileId: goal, side: goalSide });
  if (walkNodeKey(from) === goalKey) return { tiles: [start], sides: [startSide] };

  const prev = new Map<string, WalkNode | null>([[walkNodeKey(from), null]]);
  const node = new Map<string, WalkNode>([[walkNodeKey(from), from]]);
  const queue: WalkNode[] = [from];

  while (queue.length) {
    const cur = queue.shift() as WalkNode;
    for (const next of walkMoves(level, cur)) {
      const key = walkNodeKey(next);
      if (prev.has(key)) continue;
      prev.set(key, cur);
      node.set(key, next);
      if (key === goalKey) {
        const tiles: string[] = [];
        const sides: (1 | -1)[] = [];
        for (let at: string | undefined = key; at; ) {
          const n = node.get(at) as WalkNode;
          tiles.unshift(n.tileId);
          sides.unshift(n.side);
          const p = prev.get(at);
          at = p ? walkNodeKey(p) : undefined;
        }
        return { tiles, sides };
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Every move out of one (tile, side): along the street on the same pavement,
 * and — only where a zebra says so — across to the other one.
 */
export function walkMoves(level: Level, from: WalkNode): WalkNode[] {
  if (!hasFootway(level[from.tileId])) return [];
  const out: WalkNode[] = walkNeighbours(level, from.tileId).map(tileId => ({
    tileId,
    // Not `from.side` — the same bank can be spelled with the other sign on the
    // next tile. See `sideAcross`.
    side: sideAcross(level, from.tileId, tileId, from.side),
  }));
  // The crossing. This one line is the whole mechanic: take it away and a
  // pavement is two separate networks that happen to be drawn beside each other.
  if (hasFootCrossing(level[from.tileId])) {
    out.push({ tileId: from.tileId, side: (from.side * -1) as 1 | -1 });
  }
  return out;
}

/**
 * Which pavement of `roadTile` the plot stands on: +1 or -1, matching the sign
 * `pavementOffsets` uses.
 *
 * The offset is measured RIGHT of travel along the tile's own through movement,
 * so this asks the same question geometrically: on which side of the road's
 * centreline does the plot lie?
 */
export function sideOfPlot(level: Level, plotId: string, roadTile: string): 1 | -1 | null {
  const road = level[roadTile]?.road;
  if (!road?.length) return null;
  const plot = parseCoordId(plotId);
  const tile = parseCoordId(roadTile);
  // The tile's through direction (the first non-Center movement it carries).
  let from: Port | null = null;
  let to: Port | null = null;
  for (const lane of road) {
    for (const exit of lane.to) {
      if (lane.from === Position.Center || exit === Position.Center) continue;
      from = lane.from;
      to = exit;
      break;
    }
    if (from !== null) break;
  }
  if (from === null || to === null) return null;
  // Which bank of the street the plot is on, measured against the tile's OWN
  // through direction — the same reference `pavementOffsetFor` converts from.
  const { x: nx, y: ny } = travelNormal(from, to);
  if (nx === 0 && ny === 0) return 1;
  const px = plot.x - tile.x;
  const py = plot.y - tile.y;
  const dot = px * nx + py * ny;
  if (dot === 0) return 1; // straight ahead of the tile: either side will do
  return dot > 0 ? 1 : -1;
}

function portVector(p: Port): { x: number; y: number } {
  if (p === Position.Top) return { x: 0, y: -1 };
  if (p === Position.Right) return { x: 1, y: 0 };
  if (p === Position.Bottom) return { x: 0, y: 1 };
  if (p === Position.Left) return { x: -1, y: 0 };
  return { x: 0, y: 0 };
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

// The zebra.
//
// The stripes run ALONG the direction of vehicle travel and repeat ACROSS the
// carriageway — a driver sees them side by side, a pedestrian steps over one
// after another. The first version had them the other way round (bars square to
// the road, repeating along it), which reads as a stack of stop lines rather
// than a crossing.
const ZEBRA_FILL = "hsl(0 0% 96%)";
// How far along the road the crossing reaches — its depth, as a driver meets it.
const ZEBRA_DEPTH = 26;
const ZEBRA_BARS = 6;

/**
 * The crossing stripes of one cell, in its own 0..100 ground space. Centred on
 * the tile — which is exactly where `sim/pedestrians.ts` puts somebody crossing
 * (t = 0.5), so the paint and the people agree about where the zebra is.
 */
export function crossingPaths(cell: TileCell | undefined, size = 100): string {
  if (!hasFootCrossing(cell)) return "";
  const through = roadThrough(cell);
  if (!through) return "";

  const scale = size / 100;
  const half = roadHalfUnits(cell) * scale;
  const mid = size / 2;
  const depth = ZEBRA_DEPTH * scale;
  // Bars repeat ACROSS the carriageway, so the pitch divides the road's width.
  const pitch = (half * 2) / ZEBRA_BARS;
  const barW = pitch * 0.6;

  // Does the carriageway run north-south on this tile?
  const northSouth = through.from === Position.Top || through.from === Position.Bottom;

  const out: string[] = [];
  for (let i = 0; i < ZEBRA_BARS; i++) {
    const across = mid - half + pitch * i + (pitch - barW) / 2;
    // `depth` always runs ALONG the road; `barW` always across it.
    const rect = northSouth
      ? { x: across, y: mid - depth / 2, w: barW, h: depth }
      : { x: mid - depth / 2, y: across, w: depth, h: barW };
    out.push(
      `<rect x="${rect.x.toFixed(1)}" y="${rect.y.toFixed(1)}" width="${rect.w.toFixed(1)}" height="${rect.h.toFixed(1)}" fill="${ZEBRA_FILL}" />`
    );
  }
  return out.join("");
}
