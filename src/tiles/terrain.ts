// Terrain rendering, derived from tile data.
//
// `TileCell.terrain` says what a cell IS (grass/forest/water/rock/mountain/
// urban); this module turns that into ground art. Nothing is authored per tile: an author
// paints an AREA of forest and the individual trees follow from
// `(kind, coord, seed)` — the same deterministic trick meadowBackdrop.ts uses for
// the distance, just per tile instead of per texture tile. Determinism is
// load-bearing: a level must look identical on every load, and `npm run shot`
// screenshots must be comparable.
//
// Design: `docs/superpowers/specs/2026-07-25-terrain-as-tile-data-design.md`.
// This is step 2 of its sequencing — COSMETIC ONLY. No rule in the simulation or
// the validator reads terrain yet; that arrives one rule at a time (water blocks
// track, then bridges, then rock), each with its own /test scenario.
import { TerrainKind, TileCell, parseCoordId } from "@/tiles/model";
import { segmentPoints } from "@/sim/pathGeometry";
import { makeRng } from "@/utils/globalHelpers";
import { Rng, bush, lerp, tree } from "@/utils/foliage";

export const TERRAIN_KINDS: readonly TerrainKind[] = [
  "grass",
  "forest",
  "water",
  "rock",
  "mountain",
  "urban",
] as const;

// Art is authored in a 100x100 box and scaled to whatever `tileSize` is, so
// scatter sizes stay independent of the px tile size.
export const GROUND_UNITS = 100;

// How far a tile corner is nudged off the grid, and how far a boundary bows out
// between two corners. Together these are what stop a patch reading as a
// rounded rectangle: the grid is still underneath, but nothing lands on it.
// Both are small enough that an edge can never cross its neighbour.
const CORNER_JITTER = 7;

// SHORES BULGE OUTWARD. The bow used to be symmetric — `(r()*2-1)*EDGE_BOW` —
// so about half of every patch's boundaries curved INWARD, and a concave shore
// reads as a pinch: lakes came out star-shaped, sucked in between their corners,
// which is the one thing a body of water never does. The direction is now fixed
// (always outward) and only the AMOUNT varies, between EDGE_BOW_MIN and the full
// bow: the silhouette stays convex while the outline stays irregular. Anything
// less than a floor here would let the odd shore go flat and reintroduce a
// straight tile edge.
const EDGE_BOW = 11;
const EDGE_BOW_MIN = 0.34;

// A cubic reaches 3/4 of its control offset at the midpoint, so a shore that
// should bulge EDGE_BOW has to lean its controls out by EDGE_BOW / 0.75.
const MID_OF_LEAN = 0.75;

// A lattice point in the MIDDLE of a shore — one where the boundary runs
// straight on into the next tile — is pushed off the grid too, outward, and the
// shore leans through it. Without this the outline returned to the bare lattice
// point at every tile boundary and left a sharp inward V there: the bulges were
// convex, but the CUSPS BETWEEN THEM drew the tile grid back onto the shore, so
// you could count the tiles down the side of a lake. The push gives the shore
// somewhere else to be; the slope is what makes the two tiles' curves meet
// smoothly rather than at a kink (see patchSegments).
const CORNER_PUSH_MIN = 7;
const CORNER_PUSH_MAX = 19;
const CORNER_SLOPE = 5;

// A REAL corner — where the patch genuinely turns — is pulled INWARD, along the
// tile's diagonal. This is what finally stopped an authored block silhouetting
// as its own bounding box: outward bows alone still left every corner sitting on
// the box corner, so a 3x2 lake was a rectangle with wavy edges. Pulling the
// corner a third of the way into the tile (while the mid-shore points push OUT)
// makes the outline sweep from outside the lattice line down into the tile and
// back — an effective corner radius of most of a tile, which is what reads as a
// rounded blob. The two amounts vary per corner so the blob is never a circle.
const CORNER_INSET_MIN = 14;
const CORNER_INSET_MAX = 26;

// How much a real corner's end tangents lean outward, as a multiple of the old
// bow-derived lean. At ~1 the outline turned ~78° at the corner point — a
// softened right angle, which is why a lone tile still read as a square. Scaled
// up until the lean is comparable to `reach`, both edges leave the corner at
// roughly 45°, so the turn spreads over the whole corner sweep instead of
// happening at the point. Capped just under `reach` or the cubic could loop.
const CORNER_ROUNDING = 2.2;

// A continuing (internal) edge is pushed a hair OUTWARD instead of being drawn
// as an exact shared line. Two patches that abut precisely still show a hairline
// seam, because each antialiases its edge against the background and two
// half-covered pixels do not add up to a full one. Both tiles bow outward, so
// they overlap by ~1 unit of the same colour and the seam has nowhere to appear.
// The path is wound clockwise, so a NEGATIVE bow is the outward direction.
const SEAM_OVERLAP = 0.6;

// --- Keep-out corridors ------------------------------------------------------
//
// Scatter must not stand on anything a vehicle runs over. A corridor is the
// centreline of a rail connection or a road across the SAME cell (or a
// neighbouring one), with a half-width; placement keeps each object's footprint
// outside every corridor, so laying track through a wood fells the trees in the
// right-of-way and a town's houses step back from the line. Forest gets one
// deliberate exception (see buildGround): a trunk may stand BESIDE the line
// while its canopy overhangs it — those trees render on the CANOPY layer, above
// the trains, so a train slips under the foliage.

export interface Corridor {
  pts: Pt[];
  half: number;
}

// Rails sit `railDistanceFromPath` (7px of 200 = 3.5 units) either side of the
// centreline, on sleepers a little wider — ~8 units of track edge to edge.
const RAIL_HALF = 8;
// One lane is 14 units wide (roadGeometry's size * 0.14); a road's half-width
// is its widest approach, since each direction's lanes sit on their own side.
const LANE_W_UNITS = 14;
const ROAD_MARGIN = 2;

/** The corridors of ONE cell, in its own 0..GROUND_UNITS space. */
export function cellCorridors(cell: TileCell | null | undefined): Corridor[] {
  if (!cell) return [];
  const out: Corridor[] = [];
  for (const [a, b] of cell.connections) {
    out.push({ pts: segmentPoints(a, b, GROUND_UNITS), half: RAIL_HALF });
  }
  if (cell.road?.length) {
    // One corridor per (from → to) movement, as wide as its deepest lane stack.
    const widest = new Map<string, { corridor: Corridor; lanes: number }>();
    for (const lane of cell.road) {
      for (const to of [...lane.to, ...(lane.busTo ?? [])]) {
        const key = [lane.from, to].sort().join(">");
        const lanes = lane.index + 1;
        const cur = widest.get(key);
        if (cur) {
          cur.lanes = Math.max(cur.lanes, lanes);
          cur.corridor.half = cur.lanes * LANE_W_UNITS + ROAD_MARGIN;
        } else {
          widest.set(key, {
            lanes,
            corridor: {
              pts: segmentPoints(lane.from, to, GROUND_UNITS),
              half: lanes * LANE_W_UNITS + ROAD_MARGIN,
            },
          });
        }
      }
    }
    for (const { corridor } of widest.values()) out.push(corridor);
  }
  return out;
}

/**
 * A tile's corridors PLUS its four side-neighbours', translated into this
 * tile's space. The wide forest band lets a canopy reach ~4 units over the tile
 * edge, and a neighbour's rail runs right up to that edge at a port — without
 * the neighbours, a tree hugging the boundary would drape its canopy over the
 * next tile's track on the wrong (ground) layer.
 */
export function corridorsFor(
  cell: TileCell | null | undefined,
  neighbours?: Partial<
    Record<"top" | "right" | "bottom" | "left", TileCell | null | undefined>
  >,
): Corridor[] {
  const out = cellCorridors(cell);
  if (!neighbours) return out;
  const shifts: [keyof typeof neighbours, number, number][] = [
    ["top", 0, -GROUND_UNITS],
    ["right", GROUND_UNITS, 0],
    ["bottom", 0, GROUND_UNITS],
    ["left", -GROUND_UNITS, 0],
  ];
  for (const [side, dx, dy] of shifts) {
    for (const c of cellCorridors(neighbours[side])) {
      out.push({
        half: c.half,
        pts: c.pts.map(p => ({ x: p.x + dx, y: p.y + dy })),
      });
    }
  }
  return out;
}

function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Distance from a point to the EDGE of the nearest corridor. Negative = on it. */
export function corridorClearance(p: Pt, corridors: Corridor[]): number {
  let best = Infinity;
  for (const c of corridors) {
    best = Math.min(best, distToPolyline(p, c.pts) - c.half);
  }
  return best;
}

// The clear radius an object of this kind needs beyond a corridor's edge, per
// unit of band scale — the drawn art's worst-case reach (forest's includes the
// 0.42 tree conversion in buildGround).
const FOOT: Record<TerrainKind, number> = {
  grass: 0,
  forest: 13,
  water: 6,
  rock: 15,
  mountain: 30,
  urban: 16,
};
// A trunk needs far less room than a canopy: how much clearance a FOREST
// tree's base needs before it is standing in the ballast.
const TRUNK_CLEAR = 4;

// --- Glades ------------------------------------------------------------------
//
// A real wood is not wall-to-wall trees: it has clearings, and thinner, lighter
// growth around them. The density field is VALUE NOISE over a coarse WORLD
// lattice — seeded by world position, never by the tile — so a glade spans tile
// boundaries seamlessly and can never redraw the grid the jittered patches
// exist to hide. Trees are rejected where the field runs low (a rejected spot
// occasionally keeps a low bush instead — light gets through where the canopy
// doesn't close), and the survivors shrink a little toward a glade's rim.

// Tiles per noise cell: a glade spans a couple of tiles, not a couple of trees.
const GLADE_CELL = 3;

function fieldCorner(gx: number, gy: number, seed: number): number {
  return makeRng(hashInts(seed, gx, gy, 0x6e))();
}

const smoothT = (t: number) => t * t * (3 - 2 * t);

/** Forest density 0..1 at a WORLD position (in tile units). Deterministic. */
export function forestDensityAt(wx: number, wy: number, seed: number): number {
  const cx = Math.floor(wx / GLADE_CELL);
  const cy = Math.floor(wy / GLADE_CELL);
  const fx = smoothT(wx / GLADE_CELL - cx);
  const fy = smoothT(wy / GLADE_CELL - cy);
  const a = fieldCorner(cx, cy, seed);
  const b = fieldCorner(cx + 1, cy, seed);
  const c = fieldCorner(cx, cy + 1, seed);
  const d = fieldCorner(cx + 1, cy + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

// How likely a tree at this density is to stand: full wood above, none below,
// a soft shoulder between. THE THRESHOLDS ARE PITCHED AGAINST THE FIELD'S REAL
// DISTRIBUTION: bilinear noise concentrates hard around 0.5 (it averages four
// uniforms), so a "full wood" bar at 0.52 rejected trees across half the map
// and turned every forest into sparse shrubland. At 0.38/0.24 roughly three
// quarters of the world is full wood, a sixth is the lighter shoulder, and a
// tenth is true clearing — a forest with glades, not a glade with trees.
const GLADE_FULL = 0.38;
const GLADE_FLOOR = 0.24;

function gladeKeep(density: number): number {
  if (density >= GLADE_FULL) return 1;
  if (density <= GLADE_FLOOR) return 0.04;
  return smoothT((density - GLADE_FLOOR) / (GLADE_FULL - GLADE_FLOOR));
}

// A cell with no `terrain` is grass. Grass is the ONE kind that draws no ground
// of its own: the board's themed ground shows through untouched, so adding
// terrain to the model changes nothing about how existing levels look. Painting
// grass explicitly and painting nothing are deliberately the same picture.
export function terrainOf(cell: TileCell | null | undefined): TerrainKind {
  return cell?.terrain ?? "grass";
}

// --- Rules -------------------------------------------------------------------
//
// The first thing that reads terrain rather than just drawing it. Kept here, as
// one predicate, so the validator, the editor and the route planner can never
// disagree about where a line may run.
//
// Forest is deliberately BUILDABLE — you fell the trees. Water, rock and
// mountain stop a plain track, and those are the interesting ones: they are what
// makes a route a decision instead of a straight line. (Water stops *plain*
// track; a bridge is a later feature and will be an exception here, not a new
// rule — as a tunnel will be for mountain.)
const BLOCKS_BUILDING: Record<TerrainKind, boolean> = {
  grass: false,
  forest: false,
  water: true,
  rock: true,
  mountain: true,
  urban: false,
};

export function terrainBlocksBuilding(kind: TerrainKind): boolean {
  return BLOCKS_BUILDING[kind];
}

// Terrain's SECOND gameplay rule (after canBuildOn): what laying track on this
// ground multiplies the base tile price by. Felling a wood costs half again;
// buying town land costs two and a half times. Only modes with a ledger feel
// it — sandbox and puzzle build free — and only the three buildable grounds
// matter here: water/rock/mountain refuse track outright, and a future bridge
// or tunnel is expected to bring its OWN price, not read this table.
export const TERRAIN_BUILD_FACTOR: Record<TerrainKind, number> = {
  grass: 1,
  forest: 1.5,
  water: 1,
  rock: 1,
  mountain: 1,
  urban: 2.5,
};

/** The build-price factor for a cell. Missing cell = bare grass = 1. */
export function terrainBuildFactor(cell: TileCell | null | undefined): number {
  return TERRAIN_BUILD_FACTOR[terrainOf(cell)];
}

/** Whether track or road may be laid on this cell. Missing cell = bare grass. */
export function canBuildOn(cell: TileCell | null | undefined): boolean {
  return !terrainBlocksBuilding(terrainOf(cell));
}

// The four edge neighbours' kinds, in the order a clockwise path walks them —
// plus the four DIAGONAL ones, which decide whether a corner is the middle of a
// straight shore or a place where the boundary turns. Diagonals are optional
// (absent = grass), so a caller that only knows its four sides still works: it
// just treats every corner as mid-shore, which is the common case.
export interface TerrainNeighbours {
  top: TerrainKind;
  right: TerrainKind;
  bottom: TerrainKind;
  left: TerrainKind;
  topLeft?: TerrainKind;
  topRight?: TerrainKind;
  bottomRight?: TerrainKind;
  bottomLeft?: TerrainKind;
}

const ALL_GRASS: TerrainNeighbours = {
  top: "grass",
  right: "grass",
  bottom: "grass",
  left: "grass",
  topLeft: "grass",
  topRight: "grass",
  bottomRight: "grass",
  bottomLeft: "grass",
};

type Hsl = [h: number, s: number, l: number];
const css = ([h, s, l]: Hsl) => `hsl(${h} ${s}% ${l.toFixed(1)}%)`;

// Base ground colour per kind. `null` = draw nothing (see terrainOf).
// Rock is deliberately COOL grey and urban WARM tan: as two beiges they were
// indistinguishable on the board at any distance.
// Mountain is a DARKER, bluer slate than rock: the two blocking grounds must be
// tellable apart at a glance, and "higher and colder" is the reading we want.
const GROUND: Record<TerrainKind, Hsl | null> = {
  grass: null,
  forest: [96, 30, 30],
  water: [196, 44, 47],
  rock: [210, 7, 56],
  mountain: [214, 13, 42],
  urban: [36, 17, 68],
};

// A second, lighter tone drawn just inside the patch edge — shallows at a
// shoreline, a scree apron around rock. Without it a terrain patch reads as a
// flat sticker; with it the edge reads as a place where two grounds meet.
const RIM: Record<TerrainKind, Hsl | null> = {
  grass: null,
  forest: null,
  water: [190, 46, 62],
  rock: [210, 8, 65],
  // A scree apron where the massif runs out — the same idea as rock's. Kept
  // only a few steps off the ground: on this dark slate a bright rim reads as a
  // capsule drawn round the tile rather than as the foot of a range.
  mountain: [214, 12, 46],
  urban: null,
};

// NO per-tile tone variation. It was tried (±3.5% lightness) to stop a large
// wood reading as one flat slab, and it backfired badly: because the fill is
// flat per tile, the boundary between two tones IS the tile edge, so the grid
// became legible straight through the colour — the exact thing the jittered
// outline exists to hide. Unevenness has to come from something that doesn't
// change at tile boundaries (scatter density, a gradient across the patch), not
// from a per-tile constant.

// --- Patch shape -------------------------------------------------------------
//
// A terrain patch is NOT drawn on the tile grid. Its four corners are lattice
// points nudged off the grid, and each boundary bows between them — so a lake
// has a shoreline rather than four right angles.
//
// The whole trick is WHAT EACH RANDOM NUMBER IS SEEDED BY:
//   - a corner is seeded by the LATTICE POINT, shared by up to four tiles;
//   - a boundary is seeded by the EDGE, canonicalised so the two tiles either
//     side compute the same number.
// Seed by the tile instead and neighbours disagree about where their shared
// boundary is, which reopens the seams that patchPath exists to close.

function hashInts(seed: number, ...vals: number[]): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (const v of vals) h = Math.imul(h ^ (v + 0x9e3779b9), 0x01000193) >>> 0;
  return h >>> 0;
}

/**
 * Where the grid intersection (gx, gy) actually sits, in the local 0..size box
 * of a tile whose top-left corner is that point. Every tile touching this
 * lattice point derives the same offset, so their outlines meet exactly.
 */
export function latticeOffset(
  gx: number,
  gy: number,
  seed: number,
): { dx: number; dy: number } {
  const r = makeRng(hashInts(seed, gx, gy, 0x0c));
  return {
    dx: (r() * 2 - 1) * CORNER_JITTER,
    dy: (r() * 2 - 1) * CORNER_JITTER,
  };
}

/**
 * How far the boundary between two lattice points bows out, perpendicular to
 * them. Always NEGATIVE, which is the OUTWARD direction for this clockwise
 * outline (same convention as SEAM_OVERLAP) — see EDGE_BOW.
 *
 * Canonicalised on the endpoint pair: `edgeBow(a, b) === edgeBow(b, a)`, which
 * is what lets the tile on each side draw the identical curve.
 */
export function edgeBow(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  seed: number,
): number {
  const swap = bx < ax || (bx === ax && by < ay);
  const [p, q] = swap ? [[bx, by], [ax, ay]] : [[ax, ay], [bx, by]];
  const r = makeRng(hashInts(seed, p[0], p[1], q[0], q[1], 0x1d));
  return -EDGE_BOW * lerp(EDGE_BOW_MIN, 1, r());
}

/**
 * How far a MID-SHORE lattice point is pushed off the grid, along the shore's
 * outward normal, and how steeply the shore leans as it passes through. Both are
 * seeded by the lattice point alone, so the two tiles that share it place it and
 * angle it identically — that agreement is the whole reason the seam stays shut.
 */
export function cornerPush(gx: number, gy: number, seed: number): number {
  const r = makeRng(hashInts(seed, gx, gy, 0x3b));
  return lerp(CORNER_PUSH_MIN, CORNER_PUSH_MAX, r());
}

export function cornerSlope(gx: number, gy: number, seed: number): number {
  const r = makeRng(hashInts(seed, gx, gy, 0x5f));
  return (r() * 2 - 1) * CORNER_SLOPE;
}

/**
 * How far a REAL corner is pulled into its tile, along the diagonal. Seeded by
 * the lattice point for determinism, but unlike push/slope it needs no cross-
 * tile agreement: a corner-role point is only ever drawn through by ONE tile of
 * the patch (a same-kind side neighbour would change the role), so the pull can
 * be as personal as it likes. Two patches kissing diagonally each pull into
 * their own tile and separate into two bodies — deliberate: two diagonal ponds
 * touching at a point read as a defect, not as a lake.
 */
export function cornerInset(gx: number, gy: number, seed: number): number {
  const r = makeRng(hashInts(seed, gx, gy, 0x77));
  return lerp(CORNER_INSET_MIN, CORNER_INSET_MAX, r());
}

type Pt = { x: number; y: number };

// Each edge in the order the clockwise outline walks it: the direction it runs,
// and the OUTWARD normal (away from the tile). Taken from the edge INDEX rather
// than measured off the jittered chord, so the two tiles either side of a shore
// derive the identical frame and their tangents can line up exactly.
const EDGE_FRAME: { dir: Pt; out: Pt }[] = [
  { dir: { x: 1, y: 0 }, out: { x: 0, y: -1 } }, // top:    TL -> TR
  { dir: { x: 0, y: 1 }, out: { x: 1, y: 0 } }, // right:  TR -> BR
  { dir: { x: -1, y: 0 }, out: { x: 0, y: 1 } }, // bottom: BR -> BL
  { dir: { x: 0, y: -1 }, out: { x: -1, y: 0 } }, // left:   BL -> TL
];

// What a corner IS, which is decided by its two edges and its diagonal:
//  - "corner": both edges stop, so the patch genuinely turns here. Round it.
//  - "run": exactly one edge stops and the boundary carries straight on into the
//    next tile. Push it out and give it a shared tangent — no kink.
//  - "turn": interior, or the reflex corner of an L (the diagonal is the same
//    kind, so the boundary turns AROUND this point). Leave it on the lattice:
//    the two tiles meeting there run perpendicular and must not agree.
type CornerRole =
  | { kind: "corner" }
  | { kind: "run"; edge: number }
  | { kind: "turn" };

function cornerRoles(stops: boolean[], diag: boolean[]): CornerRole[] {
  const roles: CornerRole[] = [];
  for (let i = 0; i < 4; i++) {
    const before = stops[(i + 3) % 4];
    const after = stops[i];
    if (before && after) roles.push({ kind: "corner" });
    else if (before !== after && !diag[i]) {
      roles.push({ kind: "run", edge: before ? (i + 3) % 4 : i });
    } else roles.push({ kind: "turn" });
  }
  return roles;
}

// The tile's four corners in local space, each displaced by its lattice point's
// shared offset — then, mid-shore, pushed outward, or at a real corner pulled
// INWARD along the diagonal (see CORNER_INSET). Clockwise from the top-left.
function corners(
  x: number,
  y: number,
  seed: number,
  size: number,
  roles: CornerRole[],
): Pt[] {
  const local: Pt[] = [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
  return cornerLattice(x, y).map(([gx, gy], i) => {
    const { dx, dy } = latticeOffset(gx, gy, seed);
    const p = { x: local[i].x + dx, y: local[i].y + dy };
    const role = roles[i];
    if (role.kind === "run") {
      const push = cornerPush(gx, gy, seed);
      const out = EDGE_FRAME[role.edge].out;
      p.x += out.x * push;
      p.y += out.y * push;
    } else if (role.kind === "corner") {
      // The inward diagonal is opposite the two adjacent edges' outward
      // normals; their sum has length sqrt(2), so divide to get a unit pull.
      const inset = cornerInset(gx, gy, seed);
      const oBefore = EDGE_FRAME[(i + 3) % 4].out;
      const oAfter = EDGE_FRAME[i].out;
      p.x -= ((oBefore.x + oAfter.x) / Math.SQRT2) * inset;
      p.y -= ((oBefore.y + oAfter.y) / Math.SQRT2) * inset;
    }
    return p;
  });
}

// The lattice points of each corner, in the same clockwise order — needed to
// seed each edge by the pair it actually spans.
function cornerLattice(x: number, y: number): [number, number][] {
  return [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ];
}

const n1 = (v: number) => v.toFixed(1);

// One boundary's cubic geometry: start, both controls, end. Built by
// patchSegments, consumed by the path builders, the rim, and the scatter
// containment polygon — one derivation, so they can never disagree.
interface ShoreSeg {
  a: Pt;
  p1: Pt;
  p2: Pt;
  b: Pt;
  stops: boolean;
}

// The slope to hand `shoreEdge` at one end of an edge. `sign` is +1 leaving a
// corner, −1 arriving at one: a real corner leans out on the way in and back on
// the way out, a mid-shore point uses the lattice's shared slope either way, and
// a reflex corner stays flat so the two perpendicular shores meet cleanly.
function edgeLead(
  role: CornerRole,
  lattice: [number, number],
  seed: number,
  lean: number,
  sign: number,
): number {
  if (role.kind === "corner") return sign * lean;
  if (role.kind === "run") return cornerSlope(lattice[0], lattice[1], seed);
  return 0;
}

/**
 * Which of a tile's neighbours carry the SAME terrain. The four sides decide
 * where the patch stops; the four diagonals (absent = different) decide whether
 * a corner is mid-shore or a turn.
 */
export interface PatchSame {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  topLeft?: boolean;
  topRight?: boolean;
  bottomRight?: boolean;
  bottomLeft?: boolean;
}

// Edge order matches `corners`: top, right, bottom, left.
function edgeStops(same: PatchSame): boolean[] {
  return [!same.top, !same.right, !same.bottom, !same.left];
}

// Diagonal order matches the CORNERS: top-left, top-right, bottom-right,
// bottom-left — corner i's diagonal is the tile across it.
function cornerDiagonals(same: PatchSame): boolean[] {
  return [!!same.topLeft, !!same.topRight, !!same.bottomRight, !!same.bottomLeft];
}

// Everything the two path builders need to agree on, worked out once.
function patchFrame(same: PatchSame, x: number, y: number, seed: number, size: number) {
  const stops = edgeStops(same);
  const roles = cornerRoles(stops, cornerDiagonals(same));
  return {
    stops,
    roles,
    c: corners(x, y, seed, size, roles),
    g: cornerLattice(x, y),
    reach: size / 3,
  };
}

// The outward lean that rounds a real corner, derived from this edge's own bow
// so each corner still turns by a different amount (see EDGE_BOW), scaled up by
// CORNER_ROUNDING so the turn is spread over the whole sweep rather than
// happening at the point. `edgeBow` is negative for outward; a lead takes
// outward as positive. Capped just under `reach`: a lean past the along-shore
// component would tip the end tangent beyond 45° and risk a loop.
function edgeLean(
  g: [number, number][],
  i: number,
  seed: number,
  reach: number,
): number {
  const [ax, ay] = g[i];
  const [bx, by] = g[(i + 1) % 4];
  const lean = (-edgeBow(ax, ay, bx, by, seed) / MID_OF_LEAN) * CORNER_ROUNDING;
  return Math.min(lean, reach * 0.95);
}

/**
 * Every boundary of the patch, as cubics whose END TANGENTS are chosen, not
 * implied.
 *
 * This is the whole trick. A quadratic bowing off the chord leaves each corner
 * at an angle, so where two tiles' shores met the outline kinked ~47° — a sharp
 * inward V at every tile boundary, which is the tile grid drawn back onto the
 * lake. Here each end contributes `dir * reach` along the shore plus `out *
 * lead` across it, and at a mid-shore corner BOTH tiles read the same lead
 * (the lattice point's shared slope) from the same frame — so the two curves
 * leave and arrive along one line and the join disappears.
 *
 * `leadOut` is the slope leaving `a`, `leadIn` the slope arriving at `b`, both
 * positive = outward. A real corner passes +lean / −lean, which bulges the edge
 * out and brings it back; with the corner point itself pulled inward (see
 * CORNER_INSET) that sweep is what rounds a lone patch into a blob. An internal
 * join runs a hair outward on both ends so two abutting bodies overlap by ~1
 * unit of the same colour instead of leaving an antialiasing hairline.
 */
function patchSegments(
  same: PatchSame,
  x: number,
  y: number,
  seed: number,
  size: number,
): ShoreSeg[] {
  const { stops, roles, c, g, reach } = patchFrame(same, x, y, seed, size);
  const segs: ShoreSeg[] = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    const j = (i + 1) % 4;
    const { dir, out } = EDGE_FRAME[i];
    let leadOut: number;
    let leadIn: number;
    if (!stops[i]) {
      const seam = SEAM_OVERLAP / MID_OF_LEAN;
      leadOut = seam;
      leadIn = -seam;
    } else {
      const lean = edgeLean(g, i, seed, reach);
      leadOut = edgeLead(roles[i], g[i], seed, lean, 1);
      leadIn = edgeLead(roles[j], g[j], seed, lean, -1);
    }
    segs.push({
      a,
      p1: {
        x: a.x + dir.x * reach + out.x * leadOut,
        y: a.y + dir.y * reach + out.y * leadOut,
      },
      p2: {
        x: b.x - dir.x * reach - out.x * leadIn,
        y: b.y - dir.y * reach - out.y * leadIn,
      },
      b,
      stops: stops[i],
    });
  }
  return segs;
}

const cubic = (s: ShoreSeg) =>
  `C${n1(s.p1.x)} ${n1(s.p1.y)} ${n1(s.p2.x)} ${n1(s.p2.y)} ${n1(s.b.x)} ${n1(s.b.y)}`;

/**
 * The outline of this tile's terrain patch. An edge whose neighbour carries the
 * SAME kind runs straight between the two shared corners — both tiles draw that
 * identical line, so the bodies fuse invisibly. An edge where the terrain stops
 * bows into a shoreline. A lake is authored as an area, never as corner sprites.
 */
export function patchPath(
  same: PatchSame,
  x = 0,
  y = 0,
  seed = 1,
  size = GROUND_UNITS,
): string {
  const segs = patchSegments(same, x, y, seed, size);
  const out = [`M${n1(segs[0].a.x)} ${n1(segs[0].a.y)}`];
  for (const s of segs) out.push(cubic(s));
  out.push("Z");
  return out.join(" ");
}

/**
 * Just the boundaries where the terrain actually STOPS — the parts that are a
 * real shore, not an internal join. Stroking the whole outline instead draws a
 * bright line down every shared edge, which turns a 2x2 lake into four visibly
 * tiled ponds: the one thing patchPath exists to prevent.
 */
export function patchRimPath(
  same: PatchSame,
  x = 0,
  y = 0,
  seed = 1,
  size = GROUND_UNITS,
): string {
  return patchSegments(same, x, y, seed, size)
    .filter(s => s.stops)
    .map(s => `M${n1(s.a.x)} ${n1(s.a.y)} ${cubic(s)}`)
    .join(" ");
}

/**
 * The patch outline flattened to a polygon, for containment tests: scatter must
 * STAND ON the patch, and with real corners now cutting deep into the tile the
 * per-kind bands alone no longer guarantee that — a tree placed band-legally in
 * a corner would stand on grass, a lily on the shore. Six samples per cubic is
 * plenty at this scale; the shapes are shallow arcs.
 */
export function patchOutlinePolygon(
  same: PatchSame,
  x = 0,
  y = 0,
  seed = 1,
  size = GROUND_UNITS,
): Pt[] {
  const pts: Pt[] = [];
  for (const s of patchSegments(same, x, y, seed, size)) {
    for (let k = 0; k < 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      pts.push({
        x: w0 * s.a.x + w1 * s.p1.x + w2 * s.p2.x + w3 * s.b.x,
        y: w0 * s.a.y + w1 * s.p1.y + w2 * s.p2.y + w3 * s.b.y,
      });
    }
  }
  return pts;
}

/** Standard even-odd ray cast. Exported for the geometry tests. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// --- Scatter -----------------------------------------------------------------

// Objects standing on the ground, per kind. Counts are deliberately modest: this
// is drawn under the rails on every tile of a world that can now be 20+ tiles
// wide, and a forest that reads as a wood at a glance beats one that reads as
// individual trees at full zoom.
const SCATTER_COUNT: Record<TerrainKind, [min: number, max: number]> = {
  grass: [0, 0],
  forest: [9, 14],
  water: [0, 2],
  rock: [4, 6],
  mountain: [2, 3],
  urban: [4, 6],
};

// Where on the tile the standing objects go, and how big they get. Everything
// is drawn TOP-DOWN now (see foliage.ts), so nothing grows upward out of its
// band — objects only need enough margin that their own footprint stays clear
// of a rail on the tile boundary, and `place` pulls them onto the patch anyway.
interface ScatterBand {
  x: [number, number];
  y: [number, number];
  scale: [number, number];
}
const DEFAULT_BAND: ScatterBand = { x: [16, 84], y: [16, 84], scale: [0.72, 1.15] };
const SCATTER_BAND: Partial<Record<TerrainKind, ScatterBand>> = {
  // Canopies are meant to overlap into a wood, so trees run almost to the
  // patch edge — the containment walk keeps them on the patch.
  forest: { x: [10, 90], y: [10, 90], scale: [0.72, 1.15] },
  // Boulders are bigger than a tree's footprint, so they keep a deeper margin.
  rock: { x: [20, 80], y: [20, 80], scale: [0.72, 1.15] },
  // A ridge is the biggest footprint on the board; keep its centre well inside
  // the tile so the massif stays on its own ground.
  mountain: { x: [26, 74], y: [26, 74], scale: [0.8, 1.15] },
  // Buildings are wider than a tree, so they need a deeper margin to stay clear
  // of the tile edge.
  urban: { x: [22, 78], y: [22, 80], scale: [0.78, 1.1] },
};

type Pt2 = { x: number; y: number };

const poly = (pts: Pt2[], fill: string, extra = "") =>
  `<path d="M${pts.map(p => `${n1(p.x)} ${n1(p.y)}`).join(" L")} Z" fill="${fill}"${extra}/>`;

// --- Rock --------------------------------------------------------------------
//
// Grey with a faint blue cast, to sit on the deliberately COOL rock ground. The
// old boulders were warm beige on cool grey and read as something dropped there
// rather than as the ground breaking through.
function stone(rng: Rng, light: number, sat: [number, number] = [5, 13]): string {
  const h = Math.round(lerp(202, 222, rng()));
  const s = Math.round(lerp(sat[0], sat[1], rng()));
  return `hsl(${h} ${s}% ${Math.round(light)}%)`;
}

// Shadow tints per ground. foliage's default is green (it is meadow shadow);
// dropped on grey rock it reads as a patch of moss, and on a town's render as
// a lawn.
const STONE_SHADOW = "rgba(28,36,48,0.22)";
const TOWN_SHADOW = "rgba(58,48,38,0.18)";

// An irregular closed blob around (0,0): the footprint of a rock seen from
// above. Points walk the full circle with jittered radius, so no two rocks on
// the board are the same rock.
function blobPts(rng: Rng, r: number, n: number, squish = 1): Pt2[] {
  const rot = rng() * Math.PI * 2;
  const pts: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const ang = rot + (i / n) * Math.PI * 2;
    const rad = r * lerp(0.78, 1.15, rng());
    pts.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad * squish });
  }
  return pts;
}

// Split a blob into its NW-facing (lit) and SE-facing (shaded) halves along the
// chord between its most-NW and most-SE vertices. Shape and shading come from
// the same points, so they can never disagree.
function splitBySun(pts: Pt2[]): { lit: Pt2[]; shade: Pt2[] } {
  const n = pts.length;
  let i0 = 0;
  let i1 = 0;
  for (let i = 1; i < n; i++) {
    if (pts[i].x + pts[i].y < pts[i0].x + pts[i0].y) i0 = i;
    if (pts[i].x + pts[i].y > pts[i1].x + pts[i1].y) i1 = i;
  }
  const walk = (from: number, to: number): Pt2[] => {
    const out: Pt2[] = [];
    for (let i = from; ; i = (i + 1) % n) {
      out.push(pts[i]);
      if (i === to) break;
    }
    return out;
  };
  const a = walk(i0, i1);
  const b = walk(i1, i0);
  const sun = (h: Pt2[]) => h.reduce((s, p) => s + p.x + p.y, 0) / h.length;
  return sun(a) <= sun(b) ? { lit: a, shade: b } : { lit: b, shade: a };
}

/**
 * A boulder, TOP-DOWN: an irregular blob split along the sun chord — lit toward
 * the NW, shaded toward the SE — with a small bright crown offset toward the
 * light and a drop shadow offset away from it.
 *
 * The tones sit CLOSE together on purpose. A near-white face against a near-
 * black one turns every rock into a paper cutout; a boulder is one lump of grey
 * catching the light unevenly, which is tones a few steps apart.
 */
function boulder(rng: Rng, scale: number): string {
  const r = lerp(10, 16, rng()) * scale;
  const pts = blobPts(rng, r, 8, lerp(0.72, 1, rng()));
  const { lit, shade } = splitBySun(pts);
  // Offsets are baked into the POINTS, not wrapped in a nested translate: the
  // only translate() in a tile's art is the placement of each object, which is
  // what lets the placement tests parse positions back out of the SVG.
  const shift = (ps: Pt2[], by: number): Pt2[] =>
    ps.map(p => ({ x: p.x + by, y: p.y + by }));
  const crown = poly(shift(blobPts(rng, r * 0.3, 5), -r * 0.26), stone(rng, lerp(76, 82, rng())));
  return (
    poly(shift(pts, r * 0.24), STONE_SHADOW) +
    poly(lit, stone(rng, lerp(66, 73, rng()))) +
    poly(shade, stone(rng, lerp(46, 53, rng()))) +
    crown
  );
}

/**
 * A loose stone: the scree that makes rock read as GROUND, not as props.
 *
 * `light` is the lit face's tone and MUST be pitched against the ground it lies
 * on, not fixed. On rock (ground L=56) the default sits ~14 steps above it and
 * reads as stone; dropped unchanged on mountain (L=42) the same chips were ~30
 * steps up — bright flecks scattered over dark slate, which read as litter or
 * ice rather than as gravel.
 */
function pebble(rng: Rng, scale: number, light = 67): string {
  const r = lerp(3.2, 5.6, rng()) * scale;
  const pts = blobPts(rng, r, 5, lerp(0.7, 1, rng()));
  const { lit, shade } = splitBySun(pts);
  return (
    poly(lit, stone(rng, lerp(light, light + 7, rng()))) +
    poly(shade, stone(rng, lerp(light - 23, light - 16, rng())))
  );
}

/**
 * A bedrock shelf: a broad, flat, barely-there polygon a few steps off the
 * ground tone. Without something at this scale a rock patch is one flat slab of
 * grey with props standing on it.
 *
 * This replaced a first attempt at hairline "fissures", which at board zoom read
 * as stray pen strokes lying on the tile rather than as stone — the same lesson
 * as the terrain colours: unevenness has to be painted in BLOCKS, not in lines.
 */
function shelf(rng: Rng, base: Hsl): string {
  const w = lerp(26, 46, rng());
  const d = w * lerp(0.42, 0.62, rng());
  const [h, s, l] = base;
  // Two or three steps off the ground, no more. Push the contrast and the shelf
  // stops being texture and becomes a hexagonal sticker lying on the tile.
  const tone = `hsl(${h} ${s}% ${(l + lerp(-3.5, 3.5, rng())).toFixed(1)}%)`;
  const steps = 8;
  const pts: Pt2[] = [];
  for (let i = 0; i < steps; i++) {
    const ang = (i / steps) * Math.PI * 2 + lerp(-0.25, 0.25, rng());
    const rad = lerp(0.55, 1, rng());
    pts.push({ x: Math.cos(ang) * (w / 2) * rad, y: Math.sin(ang) * (d / 2) * rad });
  }
  return poly(pts, tone, ' opacity="0.6"');
}

// --- Mountain ----------------------------------------------------------------

/**
 * A peak, TOP-DOWN: a RIDGE — a crest line crossing the tile at a random
 * bearing, with a lit apron falling away to the NW and a shaded one to the SE,
 * and snow along the high middle of the crest. The aprons taper to nothing at
 * the crest's ends, so a ridge ends in points rather than in a blunt bar; two
 * or three of these crossing each other read as a massif.
 */
function peak(rng: Rng, scale: number): string {
  const len = lerp(40, 58, rng()) * scale; // total crest length
  const th = rng() * Math.PI; // crest bearing
  const u: Pt2 = { x: Math.cos(th), y: Math.sin(th) }; // along the crest
  let v: Pt2 = { x: -u.y, y: u.x }; // across it
  // `v` must point toward the sun (NW) so the lit apron is on the right side.
  if (v.x + v.y > 0) v = { x: -v.x, y: -v.y };

  // Wider than it is long is what separates a massif from a shard: the aprons
  // together span more than half the crest, so the footprint is a rugged blob
  // with a spine, not a spiky lens.
  const wLit = lerp(14, 19, rng()) * scale;
  const wShade = lerp(16, 22, rng()) * scale;
  const face = stone(rng, lerp(56, 64, rng()), [10, 18]);
  const shade = stone(rng, lerp(36, 44, rng()), [12, 20]);

  // Crest stations, wobbling a little across the axis so the ridge is not a
  // straight bar. The apron width profile peaks mid-crest and dies at the
  // ends, and each station's width jitters so the flanks are rugged.
  const M = 7;
  const crest: Pt2[] = [];
  const prof: number[] = [];
  for (let i = 0; i < M; i++) {
    const t = i / (M - 1);
    const s = (t - 0.5) * len;
    const wob = (rng() * 2 - 1) * 2.5 * scale;
    crest.push({ x: u.x * s + v.x * wob, y: u.y * s + v.y * wob });
    prof.push(Math.pow(Math.sin(Math.PI * t), 0.55) * lerp(0.75, 1.2, rng()));
  }
  const apron = (side: Pt2, w: number): Pt2[] => {
    // Crest walked forward, offset points walked back: a closed half-ridge.
    const out = crest.map((p, i) => ({
      x: p.x + side.x * w * prof[i],
      y: p.y + side.y * w * prof[i],
    }));
    return [...crest, ...out.reverse()];
  };
  const litPoly = apron(v, wLit);
  const shadePoly = apron({ x: -v.x, y: -v.y }, wShade);

  // A snowfield along the summit: the interior of the crest, spreading a good
  // way down both flanks, in a bright and a dim tone so the crest line
  // survives under it. The field carries its own taper so it dies out toward
  // the crest ends in points — without it the snow's cut-off edge is a hard
  // chevron across the ridge.
  const K = M - 2;
  const mid = crest.slice(1, M - 1);
  const midProf = prof
    .slice(1, M - 1)
    .map((p, j) => p * Math.sin((Math.PI * (j + 0.5)) / K));
  const snowSide = (side: Pt2, w: number): Pt2[] => [
    ...mid,
    ...mid
      .map((p, i) => ({
        x: p.x + side.x * w * midProf[i],
        y: p.y + side.y * w * midProf[i],
      }))
      .reverse(),
  ];
  const snow = rng() < 0.82;
  const snowLit = snow
    ? poly(snowSide(v, wLit * lerp(0.45, 0.6, rng())), "hsl(202 24% 94%)")
    : "";
  const snowShade = snow
    ? poly(snowSide({ x: -v.x, y: -v.y }, wShade * lerp(0.35, 0.5, rng())), "hsl(208 18% 78%)")
    : "";

  // The full silhouette: lit-side offsets walked forward, shade-side offsets
  // walked back. The end stations have zero width, so the two sides meet at the
  // crest's endpoints and the loop closes. The shadow offset is baked into the
  // points (no nested translate — see boulder).
  const off = 3.6 * scale;
  const silhouette = [...[...litPoly.slice(M)].reverse(), ...shadePoly.slice(M)];
  const shadow = poly(
    silhouette.map(p => ({ x: p.x + off, y: p.y + off })),
    STONE_SHADOW,
  );

  return shadow + poly(litPoly, face) + poly(shadePoly, shade) + snowLit + snowShade;
}

// --- Town --------------------------------------------------------------------

/** A warm plaster/render wall, and a slightly darker tone for the shaded side. */
function renderTone(rng: Rng, light: number): string {
  return `hsl(${Math.round(lerp(26, 44, rng()))} ${Math.round(lerp(12, 26, rng()))}% ${Math.round(light)}%)`;
}

// A building's drop shadow: its own footprint offset to the SOUTH-EAST, matching
// the canopies' sun (see foliage.ts). Drawn inside the building's rotated frame;
// the jitter is small enough (±14°) that the offset still reads as one sun.
function roofShadow(w: number, d: number, scale: number): string {
  const off = 2.6 * scale;
  return `<rect x="${n1(-w / 2 + off)}" y="${n1(-d / 2 + off)}" width="${n1(w)}" height="${n1(d)}" rx="1" fill="${TOWN_SHADOW}"/>`;
}

/**
 * One building, TOP-DOWN: what you see of a town from above is its roofs. Three
 * archetypes off one RNG — a pitched tile roof split along the ridge (lit half
 * toward the NW sun), a flat block with a parapet and roof boxes, and a long
 * metal hall — each centred on its footprint and rotated a few degrees so the
 * town doesn't grid up.
 */
function building(rng: Rng, scale: number): string {
  const roll = rng();
  const a = lerp(-14, 14, rng());
  const wrap = (body: string) => `<g transform="rotate(${a.toFixed(1)})">${body}</g>`;

  // Flat-roofed block: a parapet ring around a slab, with rooftop boxes.
  // Concrete GREY, not the walls' warm render: on the tan urban ground a warm
  // roof at any lightness either vanishes into it or reads as blank paper —
  // the roof has to change temperature, not just tone, to read as a roof.
  if (roll < 0.3) {
    const w = lerp(18, 25, rng()) * scale;
    const d = lerp(14, 19, rng()) * scale;
    const hue = Math.round(lerp(28, 38, rng()));
    const parapet = `hsl(${hue} 10% ${Math.round(lerp(42, 48, rng()))}%)`;
    const slab = `hsl(${hue} 8% ${Math.round(lerp(56, 62, rng()))}%)`;
    const inset = 1.8 * scale;
    const box = (): string => {
      const bw = lerp(3, 5, rng()) * scale;
      const bx = lerp(-w / 2 + inset + bw, w / 2 - inset - bw * 2, rng());
      const by = lerp(-d / 2 + inset + bw, d / 2 - inset - bw * 2, rng());
      return `<rect x="${n1(bx)}" y="${n1(by)}" width="${n1(bw)}" height="${n1(bw)}" fill="hsl(210 10% 52%)"/>`;
    };
    return wrap(
      roofShadow(w, d, scale) +
        `<rect x="${n1(-w / 2)}" y="${n1(-d / 2)}" width="${n1(w)}" height="${n1(d)}" rx="1" fill="${parapet}"/>` +
        `<rect x="${n1(-w / 2 + inset)}" y="${n1(-d / 2 + inset)}" width="${n1(w - inset * 2)}" height="${n1(d - inset * 2)}" fill="${slab}"/>` +
        box() +
        box() +
        box(),
    );
  }

  // Long metal hall: a shallow gable along the long axis, in cool sheet grey.
  if (roll < 0.5) {
    const w = lerp(24, 32, rng()) * scale;
    const d = lerp(12, 16, rng()) * scale;
    const hue = Math.round(lerp(200, 216, rng()));
    const sat = Math.round(lerp(6, 12, rng()));
    const litHalf = `hsl(${hue} ${sat}% ${Math.round(lerp(58, 64, rng()))}%)`;
    const dimHalf = `hsl(${hue} ${sat}% ${Math.round(lerp(42, 48, rng()))}%)`;
    return wrap(
      roofShadow(w, d, scale) +
        `<rect x="${n1(-w / 2)}" y="${n1(-d / 2)}" width="${n1(w)}" height="${n1(d / 2)}" fill="${litHalf}"/>` +
        `<rect x="${n1(-w / 2)}" y="0" width="${n1(w)}" height="${n1(d / 2)}" fill="${dimHalf}"/>` +
        `<line x1="${n1(-w / 2)}" y1="0" x2="${n1(w / 2)}" y2="0" stroke="hsl(${hue} ${sat}% 72%)" stroke-width="${n1(0.8 * scale)}"/>`,
    );
  }

  // Pitched tile roof: the common case. Split along the ridge — the NW-facing
  // half catches the sun — with a bright ridge line and the odd chimney.
  const w = lerp(14, 20, rng()) * scale;
  const d = lerp(10, 14, rng()) * scale;
  const tileHue = Math.round(lerp(4, 22, rng()));
  const tileSat = Math.round(lerp(34, 52, rng()));
  const tileLit = `hsl(${tileHue} ${tileSat}% ${Math.round(lerp(50, 58, rng()))}%)`;
  const tileDim = `hsl(${tileHue} ${tileSat}% ${Math.round(lerp(32, 40, rng()))}%)`;
  const ridge = `hsl(${tileHue} ${Math.max(0, tileSat - 8)}% ${Math.round(lerp(64, 70, rng()))}%)`;
  const chimney =
    rng() < 0.45
      ? `<rect x="${n1(w * lerp(0.12, 0.3, rng()))}" y="${n1(-2.6 * scale)}" width="${n1(2.4 * scale)}" height="${n1(2.4 * scale)}" fill="hsl(${tileHue} 12% 30%)"/>`
      : "";
  return wrap(
    roofShadow(w, d, scale) +
      `<rect x="${n1(-w / 2)}" y="${n1(-d / 2)}" width="${n1(w)}" height="${n1(d / 2)}" fill="${tileLit}"/>` +
      `<rect x="${n1(-w / 2)}" y="0" width="${n1(w)}" height="${n1(d / 2)}" fill="${tileDim}"/>` +
      `<line x1="${n1(-w / 2)}" y1="0" x2="${n1(w / 2)}" y2="0" stroke="${ridge}" stroke-width="${n1(0.9 * scale)}"/>` +
      chimney,
  );
}

/** A lily pad with the odd flower — enough to say "this water is shallow here". */
function lily(rng: Rng, scale: number): string {
  const r = 5.5 * scale;
  const n = (v: number) => v.toFixed(1);
  const pad = `<ellipse cx="0" cy="0" rx="${n(r)}" ry="${n(r * 0.78)}" fill="hsl(120 32% 42%)" opacity="0.85"/>`;
  const flower =
    rng() < 0.35
      ? `<circle cx="${n(r * 0.3)}" cy="${n(-r * 0.25)}" r="${n(r * 0.32)}" fill="hsl(340 55% 88%)"/>`
      : "";
  return pad + flower;
}

// --- Ground marks ------------------------------------------------------------
//
// Flat things PAINTED on the ground rather than standing on it: scree under a
// rock field, paving and gardens between the buildings of a town. They are laid
// down before the standing objects and never sorted with them, so a boulder
// always sits ON its debris and a house always stands ON its yard.

/**
 * A paved yard or forecourt: a slightly skewed slab, a touch lighter and greyer
 * than the ground. Deliberately LOW contrast — pushed brighter it stops reading
 * as ground and starts reading as white paper dropped on the town.
 */
function paving(rng: Rng): string {
  const w = lerp(14, 26, rng());
  const d = lerp(8, 15, rng());
  const skew = lerp(-3.5, 3.5, rng());
  const tone = `hsl(${Math.round(lerp(32, 46, rng()))} ${Math.round(lerp(5, 11, rng()))}% ${Math.round(lerp(66, 74, rng()))}%)`;
  return poly(
    [
      { x: -w / 2 + skew, y: -d },
      { x: w / 2 + skew, y: -d },
      { x: w / 2, y: 0 },
      { x: -w / 2, y: 0 },
    ],
    tone,
    ' opacity="0.85"',
  );
}

/** A garden plot: the green between the houses, so a town isn't all render. */
function garden(rng: Rng): string {
  const w = lerp(11, 20, rng());
  const d = w * lerp(0.34, 0.5, rng());
  const tone = `hsl(${Math.round(lerp(96, 122, rng()))} ${Math.round(lerp(20, 32, rng()))}% ${Math.round(lerp(46, 55, rng()))}%)`;
  return `<ellipse cx="0" cy="${n1(-d / 2)}" rx="${n1(w / 2)}" ry="${n1(d / 2)}" fill="${tone}" opacity="0.55"/>`;
}

function groundMarks(
  kind: TerrainKind,
  rng: Rng,
  base: Hsl,
  place: (x: number, y: number) => Pt2,
  clear: (p: Pt2, r: number) => boolean,
): string {
  // Marks that land on a corridor are simply dropped (no retries): they are
  // filler, and bare ballast beside the line reads better than a garden on it.
  const spread = (
    count: number,
    radius: number,
    make: () => string,
    yBand: [number, number] = [20, 88],
  ): string => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const p = place(lerp(14, 86, rng()), lerp(yBand[0], yBand[1], rng()));
      if (!clear(p, radius)) continue;
      out.push(`<g transform="translate(${n1(p.x)} ${n1(p.y)})">${make()}</g>`);
    }
    return out.join("");
  };
  if (kind === "rock") {
    return (
      spread(3 + Math.floor(rng() * 3), 12, () => shelf(rng, base)) +
      spread(5 + Math.floor(rng() * 4), 4, () => pebble(rng, 1))
    );
  }
  if (kind === "mountain") {
    // Top-down, there is no "foot of the range" — scree lies wherever the
    // ridges are not, and the depth sort keeps a massif on top of its gravel.
    return (
      spread(3 + Math.floor(rng() * 3), 12, () => shelf(rng, base)) +
      spread(4 + Math.floor(rng() * 3), 4, () => pebble(rng, 0.85, 53))
    );
  }
  if (kind === "urban") {
    return (
      spread(3 + Math.floor(rng() * 3), 10, () => paving(rng)) +
      spread(2 + Math.floor(rng() * 3), 8, () => garden(rng))
    );
  }
  return "";
}

// One deterministic RNG per tile: the same coord in the same world always draws
// the same trees. FNV-1a over the coord id, mixed with the world seed.
function tileRng(coordId: string, seed: number): Rng {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < coordId.length; i++) {
    h ^= coordId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return makeRng(h >>> 0);
}

// --- Assembly ----------------------------------------------------------------

// Memo: the ground of a tile only changes when its kind, its neighbours' kinds,
// its coord, the world seed or the tracks/roads through it change — none of
// which move during play. Without this, panning a 20x14 board would redraw
// ~280 tiles of procedural art per frame.
const cache = new Map<string, { ground: string; scatter: string; canopy: string }>();

function buildCached(
  kind: TerrainKind,
  coordId: string,
  neighbours: TerrainNeighbours,
  seed: number,
  corridors: Corridor[],
): { ground: string; scatter: string; canopy: string } {
  const same: PatchSame = {
    top: neighbours.top === kind,
    right: neighbours.right === kind,
    bottom: neighbours.bottom === kind,
    left: neighbours.left === kind,
    topLeft: neighbours.topLeft === kind,
    topRight: neighbours.topRight === kind,
    bottomRight: neighbours.bottomRight === kind,
    bottomLeft: neighbours.bottomLeft === kind,
  };
  // The diagonals belong in the key too: two tiles with identical sides but a
  // different corner neighbour draw different outlines (mid-shore vs turn).
  // The corridors belong in it because building a line THROUGH a tile reflows
  // its scatter — that is the whole feature.
  const corrKey = corridors
    .map(c => `${c.half}:${c.pts.map(p => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(";")}`)
    .join("|");
  const key =
    `${kind}|${+same.top}${+same.right}${+same.bottom}${+same.left}` +
    `${+same.topLeft!}${+same.topRight!}${+same.bottomRight!}${+same.bottomLeft!}` +
    `|${coordId}|${seed}|${corrKey}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const built = buildGround(kind, coordId, same, seed, corridors);
  cache.set(key, built);
  return built;
}

/**
 * The FLAT ground for one tile as an SVG fragment, in a 0..100 box: the terrain
 * patch, its rim and its ground marks (paving, scree, gardens). Returns "" for
 * grass (see terrainOf) so the common tile costs nothing. Renders UNDER
 * everything, including every neighbour's standing objects.
 */
export function tileGroundSvg(
  kind: TerrainKind,
  coordId: string,
  neighbours: TerrainNeighbours = ALL_GRASS,
  seed = 1,
  corridors: Corridor[] = [],
): string {
  return buildCached(kind, coordId, neighbours, seed, corridors).ground;
}

/**
 * The tile's STANDING objects — trees, bushes, boulders, ridges, buildings —
 * on their own layer above every tile's ground patch. The split is what stops
 * the next tile's opaque patch fill (later in the DOM) decapitating a canopy
 * that legitimately overhangs the seam: patches all live below, scatter all
 * lives above. Still under the rails and roads (see TileGround.vue).
 */
export function tileScatterSvg(
  kind: TerrainKind,
  coordId: string,
  neighbours: TerrainNeighbours = ALL_GRASS,
  seed = 1,
  corridors: Corridor[] = [],
): string {
  return buildCached(kind, coordId, neighbours, seed, corridors).scatter;
}

/**
 * The tile's OVERHEAD art: forest trees whose trunks stand beside a corridor
 * but whose canopies reach over it. Rendered on a layer above the trains (see
 * TileGround.vue), so a train passes underneath. "" for every other kind, and
 * for any forest tile with no line through or beside it.
 */
export function tileCanopySvg(
  kind: TerrainKind,
  coordId: string,
  neighbours: TerrainNeighbours = ALL_GRASS,
  seed = 1,
  corridors: Corridor[] = [],
): string {
  return buildCached(kind, coordId, neighbours, seed, corridors).canopy;
}

function buildGround(
  kind: TerrainKind,
  coordId: string,
  same: PatchSame,
  seed: number,
  corridors: Corridor[],
): { ground: string; scatter: string; canopy: string } {
  const base = GROUND[kind];
  if (!base) return { ground: "", scatter: "", canopy: "" };

  const rng = tileRng(coordId, seed);
  const { x, y } = parseCoordId(coordId);

  const d = patchPath(same, x, y, seed);
  const parts = [`<path d="${d}" fill="${css(base)}"/>`];

  // Everything placed on this tile must STAND ON the patch. The bands keep
  // objects off the tile edges, but a real corner now cedes a deep bite of the
  // tile to the surrounding grass (CORNER_INSET) — a band-legal position there
  // would put a tree on the lawn or a lily on the shore. A placement outside
  // the outline walks toward the patch centroid until it is inside with a
  // little margin (tested against the polygon inflated about the centroid, so
  // the margin scales with how far out the point sits). Deterministic: no extra
  // rng draws, so positions only move where the geometry demands it.
  const poly = patchOutlinePolygon(same, x, y, seed);
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  const insideWithMargin = (px: number, py: number): boolean =>
    pointInPolygon({ x: cx + (px - cx) / 0.88, y: cy + (py - cy) / 0.88 }, poly);
  const place = (px: number, py: number): Pt2 => {
    for (let k = 0; k <= 10; k++) {
      const q = { x: lerp(px, cx, k / 10), y: lerp(py, cy, k / 10) };
      if (insideWithMargin(q.x, q.y)) return q;
    }
    return { x: cx, y: cy };
  };

  // The rim is a thick inside stroke along the STOPPING edges only (see
  // patchRimPath), clipped to the patch so it reads as a band just inside the
  // shore rather than a line drawn on it.
  //
  // ROUND CAPS, not the default butt. Each tile strokes only its own share of a
  // shore, so on a shore that runs across several tiles the segments ABUT — and
  // two butt caps meeting on the same line antialias to a half-covered pixel
  // column, i.e. a dark tick across the shallows at every tile boundary. It is
  // the same defect SEAM_OVERLAP fixes for the fill, and it only became visible
  // once the shore itself stopped kinking there. The cap's overhang is harmless:
  // the clip path is the patch, so it can only spill into the SEAM_OVERLAP the
  // neighbour also covers, and at a real corner it is cut off entirely.
  const rim = RIM[kind];
  const rimD = rim ? patchRimPath(same, x, y, seed) : "";
  if (rim && rimD) {
    const clip = `terrain-clip-${coordId.replace(",", "-")}-${kind}`;
    parts.unshift(`<clipPath id="${clip}"><path d="${d}"/></clipPath>`);
    parts.push(
      `<path d="${rimD}" fill="none" stroke="${css(rim)}" stroke-width="9" stroke-linecap="round" clip-path="url(#${clip})" opacity="0.75"/>`,
    );
  }

  // How much room a point has to the nearest line. Infinity when the tile and
  // its neighbours carry none, which short-circuits every check below.
  const room = (p: Pt2): number =>
    corridors.length ? corridorClearance(p, corridors) : Infinity;

  // Flat marks first: scree, paving, gardens. They belong to the ground, so they
  // go under everything that stands on it and take no part in the depth sort.
  const marks = groundMarks(kind, rng, base, place, (p, r) => room(p) >= r);
  if (marks) parts.push(marks);

  const [lo, hi] = SCATTER_COUNT[kind];
  let count = lo + Math.floor(rng() * (hi - lo + 1));
  let band = SCATTER_BAND[kind] ?? DEFAULT_BAND;
  if (kind === "forest") {
    // The deeper in the wood, the denser and taller. A tile's depth is how many
    // of its 8 neighbours are forest too — a local measure, but it is exactly
    // the interior of a LARGE area that scores high, so a big wood closes into
    // overlapping canopy while a lone copse keeps today's airy scatter. Local
    // also means it needs nothing beyond the neighbours the cache key already
    // carries.
    const depth =
      [
        same.top,
        same.right,
        same.bottom,
        same.left,
        same.topLeft,
        same.topRight,
        same.bottomRight,
        same.bottomLeft,
      ].filter(Boolean).length / 8;
    // The bonus also compensates for the band: at full depth the placement
    // area grows from the 80x80 interior box to the whole tile, so the count
    // has to grow with it or the deep wood comes out SPARSER per square unit
    // than the copse (which is how the seam-widening first shipped).
    count += Math.round(18 * depth);
    band = {
      ...band,
      // Where the wood continues into the next tile, trees may stand right on
      // the seam — the two tiles' scatter interleaves and the forest closes
      // over the boundary. (The scatter layer renders above every patch fill,
      // so an overhanging canopy no longer gets cut by the neighbour; and a
      // neighbour's rails are already in `corridors`.) Toward grass or another
      // kind the margin stays.
      x: [same.left ? 0 : band.x[0], same.right ? GROUND_UNITS : band.x[1]],
      y: [same.top ? 0 : band.y[0], same.bottom ? GROUND_UNITS : band.y[1]],
      scale: [band.scale[0], band.scale[1] + 0.45 * depth],
    };
  }
  const placed: { y: number; g: string }[] = [];
  const overhead: { y: number; g: string }[] = [];
  for (let i = 0; i < count; i++) {
    // Keep objects ON the patch (see `place` above) and their footprint OFF
    // every corridor. An object that can't find clear ground in a few tries is
    // dropped: the wood thins along the railway, the town steps back from it,
    // which is what a cleared right-of-way looks like.
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = place(
        lerp(band.x[0], band.x[1], rng()),
        lerp(band.y[0], band.y[1], rng()),
      );
      let scale = lerp(band.scale[0], band.scale[1], rng());
      // Glades: reject trees where the density field runs low. A rejected spot
      // occasionally keeps a low BUSH — the lighter growth of a clearing —
      // and trees near a glade's rim come out a little smaller. The roll is
      // drawn every attempt regardless, so the rng stream's shape doesn't
      // depend on the field.
      const gladeRoll = rng();
      if (kind === "forest") {
        const density = forestDensityAt(
          x + p.x / GROUND_UNITS,
          y + p.y / GROUND_UNITS,
          seed,
        );
        const keep = gladeKeep(density);
        if (gladeRoll > keep) {
          // A roll JUST over the bar keeps a low bush: the lighter growth rims
          // the glade rather than carpeting it.
          if (gladeRoll < keep + 0.15 && room(p) >= TRUNK_CLEAR) {
            placed.push({
              y: p.y,
              g: `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">${bush(rng, scale * 0.42)}</g>`,
            });
            break;
          }
          continue;
        }
        // Trees shrink only in the shoulder around a glade; the full wood
        // keeps its full-grown crowns.
        scale *= lerp(0.8, 1, Math.min(1, keep + 0.2));
      }
      const clear = room(p);
      // The forest exception: a trunk standing just OFF the ballast whose
      // canopy reaches over the line. It renders on the canopy layer, above the
      // trains — the pass-under effect — and leans big, because a sapling's
      // crown wouldn't reach the ballast in the first place.
      const overhang =
        kind === "forest" && clear < FOOT.forest * scale && clear >= TRUNK_CLEAR;
      if (clear < FOOT[kind] * scale && !overhang) continue;
      let body: string;
      if (kind === "forest") {
        body = tree(rng, (overhang ? Math.max(scale, 1.05) : scale) * 0.42);
      } else if (kind === "rock") body = boulder(rng, scale);
      else if (kind === "mountain") body = peak(rng, scale);
      else if (kind === "urban") body = building(rng, scale);
      else body = lily(rng, scale);
      (overhang ? overhead : placed).push({
        y: p.y,
        g: `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">${body}</g>`,
      });
      break;
    }
  }
  // Back to front, so a nearer canopy overlaps a farther one naturally.
  placed.sort((a, b) => a.y - b.y);
  overhead.sort((a, b) => a.y - b.y);

  return {
    ground: parts.join(""),
    scatter: placed.map(p => p.g).join(""),
    canopy: overhead.map(p => p.g).join(""),
  };
}

// Test seam: the memo would otherwise make "same input, same output" untestable
// against a changed implementation.
export function _clearTerrainCache(): void {
  cache.clear();
}
