import { Position } from "@/types";
import type { Coordinates } from "@/types";
import type { Level, Port, TileCell } from "@/tiles/model";
import { parseCoordId } from "@/tiles/model";
import type { Lane } from "@/tiles/lanes";
import { isRoadJunction, laneCountAt, roadPortsOf, turnKind } from "@/tiles/lanes";
import { oppositePort } from "@/sim/topology";
import { roadCurveKerbEdgeTapered, roadKerbEdge } from "@/tiles/roadGeometry";
import { accessTileOf } from "@/tiles/access";
import { flankAt, resolveSeamProfile, PAVEMENT_FRAC } from "@/tiles/streetProfile";
import { bankFor } from "@/tiles/parking";

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
// How far past the tarmac edge (or past the parking outside it) the pavement's
// near edge sits. Exported because it is the whole difference between a
// pavement and a grey ribbon lying in the verge: a test that checks the band
// CLEARS the bays and nothing else passes just as happily when the band has
// come away from the street altogether.
export const PAVEMENT_GAP = 4;
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
 *
 * MEASURED WITH `laneCountAt`, NOT `laneCount(p) + laneCount(oppositePort(p))`,
 * and that distinction is the whole bug this function used to have: on a CURVE
 * (and on a junction) the opposite port carries no lanes at all, so the
 * two-term sum collapsed every bend to the 2-lane minimum. A 2-lanes-each-way
 * street therefore laid its pavement 28 units in from where its own kerb was —
 * i.e. UNDER the tarmac, which is painted over it — and the pavement simply
 * VANISHED for the length of every bend. Reported as a gap in the pavement, and
 * it was exactly that. `tiles/lanes.ts` documents `laneCountAt` as the helper to
 * use "when the tile is a curve or junction"; this is one of those places.
 *
 * No min-2 floor either, for the same reason `Tile.vue`'s paint width dropped
 * one: since the run-max kerb anchor a 1-lane one-way street is drawn its true
 * ONE lane wide, and flooring at two pushed its pavement half a lane off the
 * kerb — a band floating in the grass with a strip of ground behind it.
 */
export function roadHalfUnits(cell: TileCell | undefined): number {
  const road = cell?.road;
  if (!road?.length) return LANE_W;
  let widest = 0;
  for (const port of roadPortsOf(road)) {
    if (port === Position.Center) continue;
    widest = Math.max(widest, laneCountAt(road, port));
  }
  return ((widest || 2) / 2) * LANE_W;
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
 * The signed lateral offsets, in ground units, that put a walker on pavement
 * `side` at each END of a traversal `entry`→`exit` across this cell — the same
 * two numbers the paint tapers between, handed to the walkers' two-offset
 * sampler so paint and people follow ONE line.
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
 *
 * Symmetric under reversal by construction: walking the tile back swaps which
 * end is `entry`, flips the sign, and looks up the SAME seam/flank pairs — so
 * both directions land on the same physical curve.
 */
export function pavementOffsetEndsFor(
  level: Level,
  coordId: string,
  side: 1 | -1,
  entry: Port,
  exit: Port
): { offEntry: number; offExit: number } {
  const cell = level[coordId];
  const coord = parseCoordId(coordId);
  // Travelling against the tile's own direction flips which bank is on the
  // right. Square to it (dot 0) is ambiguous — leave the sign alone.
  const through = roadThrough(cell);
  let sign: 1 | -1 = side;
  if (through) {
    const a = travelNormal(entry, exit);
    const b = travelNormal(through.from, through.to);
    if (a.x * b.x + a.y * b.y < 0) sign = side === 1 ? -1 : 1;
  }
  // The physical flank the band runs on at each END of this traversal. On a
  // straight both are the same port; on a bend they differ (the outer band of a
  // west→south turn crosses the west seam on its north half and the south seam
  // on its east half) — and `bankFor` names both, because each end is locally a
  // straight movement: away from `entry`, and into `exit`.
  const rel: "right" | "left" = sign === 1 ? "right" : "left";
  const at = (port: Port, flank: Port): number => {
    const f = flankAt(resolveSeamProfile(level, coord, port), flank);
    // A flank the profile declares pavement-less (no room behind a wide arm or
    // deep bays) keeps the old clamped number for the WALKERS, so a walk routed
    // across such a tile still resolves to a position instead of exploding —
    // the paint drops the band there, and nothing places a plot on such a
    // flank, but the sampler must stay total.
    return (f.pavement ?? 0.5 - PAVEMENT_FRAC / 2) * 100;
  };
  return {
    offEntry: at(entry, bankFor(entry, rel)) * sign,
    offExit: at(exit, bankFor(oppositePort(exit), rel)) * sign,
  };
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

  return walkBetween(level, { tileId: start, side: startSide }, { tileId: goal, side: goalSide });
}

/**
 * The pavement a walker who is standing at a KERB is on.
 *
 * The sibling of `sideOfPlot`, and it exists for the same reason that one does:
 * a `side` is fixed to the TILE (which bank of the street), while everything
 * downstream measures offsets against the DIRECTION OF TRAVEL. `sideOfPlot`
 * answers the question for somebody standing in a building; this answers it for
 * somebody who has just got out of a car parked against `bank`.
 *
 * `bank` is the port the parking row hugs (`bankOf` in `tiles/parking.ts`).
 */
export function sideOfBank(level: Level, roadTile: string, bank: Port): 1 | -1 | null {
  const through = roadThrough(level[roadTile]);
  if (!through) return null;
  const { x: nx, y: ny } = travelNormal(through.from, through.to);
  if (nx === 0 && ny === 0) return 1;
  // The bank as a direction out of the tile's centre, against the same normal
  // `sideOfPlot` compares a plot's offset to.
  const v = portVector(bank);
  const dot = v.x * nx + v.y * ny;
  if (dot === 0) return 1;
  return dot > 0 ? 1 : -1;
}

/**
 * A walk from a stretch of KERB to a plot — the last leg of a driven journey,
 * from the space the car actually stopped in to the door.
 *
 * Not `planWalk` with a fake plot: a plot resolves to `accessTileOf` (the road
 * it fronts onto) and a side derived from where the building stands, and a
 * parked car has neither. It is already ON the road tile, and which pavement it
 * is beside is decided by the bank its bay hugs.
 */
export function planWalkFromKerb(
  level: Level,
  roadTile: string,
  bank: Port,
  toPlot: string
): { tiles: string[]; sides: (1 | -1)[] } | null {
  const goal = accessTileOf(level, toPlot);
  if (!goal) return null;
  if (!hasFootway(level[roadTile]) || !hasFootway(level[goal])) return null;
  const startSide = sideOfBank(level, roadTile, bank);
  const goalSide = sideOfPlot(level, toPlot, goal);
  if (startSide === null || goalSide === null) return null;
  return walkBetween(level, { tileId: roadTile, side: startSide }, { tileId: goal, side: goalSide });
}

// The shared breadth-first search over (tile, side). Both entry points above
// differ only in how they work out where the walk STARTS; from there the graph,
// the crossings and the route are identical, and duplicating this is how the two
// would drift apart.
function walkBetween(
  level: Level,
  from: WalkNode,
  goalNode: WalkNode
): { tiles: string[]; sides: (1 | -1)[] } | null {
  const start = from.tileId;
  const startSide = from.side;
  const goalKey = walkNodeKey(goalNode);
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

/** One pavement band: a lateral offset at each end of a movement, right-of-travel. */
interface PavementBand {
  offEntry: number;
  offExit: number;
}

/**
 * The two bands flanking one movement across this cell, as signed lateral
 * offsets (right of travel) at each end. Two ends, not one, so the pavement
 * TAPERS with the tarmac it follows and the two halves of a seam still meet.
 */
function bandsFor(level: Level, coord: Coordinates, road: Lane[], from: Port, to: Port): PavementBand[] {
  // BOTH bands, straight or bend, one-way or two-way, from the street PROFILE —
  // the same numbers the walkers sample, which is the whole point of the
  // profile: paint and people cannot disagree because neither owns the number.
  //
  // A flank whose profile says "no pavement" (a car-park aisle's neighbour, a
  // junction arm too wide to leave room) contributes NO band at that end; a band
  // with no room at either end is not drawn at all. The old code clamped such
  // bands INSIDE the carriageway or into the neighbouring bays and painted over
  // them — the profile's null is the honest answer, and here it becomes paint.
  const at = (port: Port, flank: Port): number | null => {
    const f = flankAt(resolveSeamProfile(level, coord, port), flank);
    return f.pavement === null ? null : f.pavement * 100;
  };
  const bands: PavementBand[] = [];
  for (const rel of ["right", "left"] as const) {
    const sign = rel === "right" ? 1 : -1;
    const entryOff = at(from, bankFor(from, rel));
    const exitOff = at(to, bankFor(oppositePort(to), rel));
    if (entryOff === null && exitOff === null) continue;
    bands.push({
      offEntry: (entryOff ?? exitOff!) * sign,
      offExit: (exitOff ?? entryOff!) * sign,
    });
  }
  return bands;
}



/**
 * The pavements of one cell, as stroked SVG paths in its own 0..100 ground
 * space — a band on each side of every through movement the road makes.
 *
 * Reuses the road's OWN kerb geometry (`roadKerbEdge` for a straight,
 * `roadCurveKerbEdgeTapered` for a bend) at a larger offset, so the pavement
 * follows exactly where the tarmac edge goes and a bend's pavement bends with
 * it. A hand-rolled parallel line would drift on every curve.
 *
 * Takes the LEVEL, not just the cell, because the road it flanks is not a
 * property of the cell alone: widths are seam-matched to the neighbour. Without
 * that the pavement is right in the middle of a tile and wrong at both its ends.
 *
 * Drawn on the ground layer, so the road surface and every building sit on top.
 */
export function pavementPaths(level: Level, coordId: string, size = 100): string {
  const cell = level[coordId];
  if (!hasFootway(cell)) return "";
  const road = cell.road ?? [];
  const coord = parseCoordId(coordId);
  const scale = size / 100;
  const width = PAVEMENT_WIDTH * scale;

  const stroke = (d: string) =>
    `<path d="${d}" fill="none" stroke="${PAVEMENT_FILL}" stroke-width="${width.toFixed(2)}" stroke-linecap="butt" />`;

  // A JUNCTION's pavement is drawn from its GEOMETRY, not its movements. The
  // per-movement loop below draws two bands per movement, and on a junction a
  // turn's outer band cuts diagonally across the box (entry on one street's far
  // pavement, exit beside the arm) while the through band runs straight across
  // the arm mouths — both mostly hidden under the box tarmac, but their
  // uncovered slivers showed as green wedges and ragged joins at every seam
  // (the parkinglot T was the report). What a junction physically has is:
  //  · a STRAIGHT band along each flat side (a T-junction's armless flank),
  //  · a CORNER FILLET between each pair of adjacent arms — the same corner
  //    the tarmac's fillet kerb traces, one band, tapering from one street's
  //    pavement offset to the other's.
  if (isRoadJunction(road)) {
    const arms = new Set<Port>(roadPortsOf(road));
    const at = (port: Port, flank: Port): number | null => {
      const f = flankAt(resolveSeamProfile(level, coord, port), flank);
      return f.pavement === null ? null : f.pavement * 100;
    };
    const out: string[] = [];
    const all: Port[] = [Position.Top, Position.Right, Position.Bottom, Position.Left];
    for (const flank of all) {
      if (arms.has(flank)) continue;
      const p = ((flank + 1) % 4) as Port;
      const q = ((flank + 3) % 4) as Port;
      if (!arms.has(p) || !arms.has(q)) continue;
      const sign = bankFor(p, "right") === flank ? 1 : -1;
      const offP = at(p, flank);
      const offQ = at(q, flank);
      if (offP === null && offQ === null) continue;
      const a = (offP ?? offQ!) * sign * scale;
      const b = (offQ ?? offP!) * sign * scale;
      out.push(stroke(roadKerbEdge(p, q, size, a, b, 1)));
    }
    for (const pa of all) {
      const pb = ((pa + 1) % 4) as Port;
      if (!arms.has(pa) || !arms.has(pb)) continue;
      const rel = turnKind(pa, pb) === "right" ? ("right" as const) : ("left" as const);
      const sign = rel === "right" ? 1 : -1;
      const offA = at(pa, bankFor(pa, rel));
      const offB = at(pb, bankFor(oppositePort(pb), rel));
      if (offA === null && offB === null) continue;
      const a = (offA ?? offB!) * sign * scale;
      const b = (offB ?? offA!) * sign * scale;
      out.push(stroke(roadCurveKerbEdgeTapered(pa, pb, size, a, b, 1)));
    }
    return out.join("");
  }

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
      for (const band of bandsFor(level, coord, road, lane.from, to)) {
        const a = band.offEntry * scale;
        const b = band.offExit * scale;
        // side = 1: the offsets are already signed, so the helper only has to
        // taper between them.
        const d = straight
          ? roadKerbEdge(lane.from, to, size, a, b, 1)
          : roadCurveKerbEdgeTapered(lane.from, to, size, a, b, 1);
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
