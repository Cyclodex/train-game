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
import { makeRng } from "@/utils/globalHelpers";
import { Rng, groundShadow, lerp, tree } from "@/utils/foliage";

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
  forest: [4, 7],
  water: [0, 2],
  rock: [4, 6],
  mountain: [2, 3],
  urban: [4, 6],
};

// Where on the tile the standing objects go, and how big they get. Objects are
// kept off the very edge so a canopy doesn't collide with the neighbour's and
// nothing overhangs a rail on the tile boundary — but a mountain needs its feet
// LOW in the tile, because it is tall enough to run out of headroom otherwise.
interface ScatterBand {
  x: [number, number];
  y: [number, number];
  scale: [number, number];
}
const DEFAULT_BAND: ScatterBand = { x: [16, 84], y: [24, 88], scale: [0.72, 1.15] };
const SCATTER_BAND: Partial<Record<TerrainKind, ScatterBand>> = {
  // Boulders are bigger than a tree's footprint, so they keep a deeper margin.
  rock: { x: [20, 80], y: [24, 86], scale: [0.72, 1.15] },
  // Peaks stand ~50 units tall, so they start in the bottom half and grow up
  // through the tile. Overflowing into the tile ABOVE is deliberate: the row
  // below is later in the DOM, so a near peak correctly occludes a far one.
  mountain: { x: [26, 74], y: [60, 88], scale: [0.8, 1.15] },
  // Buildings are wider than a tree, so they need a deeper margin to stay clear
  // of the tile edge.
  urban: { x: [22, 78], y: [32, 86], scale: [0.78, 1.1] },
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
// a lawn. See groundShadow.
const STONE_SHADOW = "rgba(28,36,48,0.22)";
const TOWN_SHADOW = "rgba(58,48,38,0.18)";

// One irregular silhouette, walked from the left foot over the top to the right
// foot. The facets are then cut OUT of it, so shape and shading can never
// disagree — the old boulder was a fixed five-point polygon with a triangle
// stuck on the right, which meant every rock on the board was the same rock.
function rockOutline(rng: Rng, r: number, h: number, steps = 6): Pt2[] {
  const pts: Pt2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 = left foot .. 1 = right foot
    const ang = Math.PI * (1 - t);
    const jit = lerp(0.8, 1.15, rng());
    pts.push({ x: Math.cos(ang) * r * jit, y: -Math.sin(ang) * h * jit });
  }
  // Feet must sit exactly on the ground line or the rock floats.
  pts[0] = { x: -r, y: 0 };
  pts[steps] = { x: r, y: 0 };
  return pts;
}

/** The index of the highest point of an outline — the rock's summit. */
function apexIndex(sil: Pt2[]): number {
  let ai = 0;
  for (let i = 1; i < sil.length; i++) if (sil[i].y < sil[ai].y) ai = i;
  return ai;
}

/**
 * A boulder: an irregular block split into a lit left face and a shaded right
 * face along its own ridge, with a highlight facet on the crown. Squat by
 * default, occasionally blocky and upright, so a rock field reads as varied
 * ground rather than as a row of identical props.
 *
 * The tones sit CLOSE together on purpose. A near-white face against a near-
 * black one turns every rock into a paper cutout; a boulder is one lump of grey
 * catching the light unevenly, which is three tones a few steps apart.
 */
function boulder(rng: Rng, scale: number): string {
  const r = lerp(13, 20, rng()) * scale;
  const upright = rng() < 0.35;
  const h = r * (upright ? lerp(0.95, 1.25, rng()) : lerp(0.5, 0.78, rng()));
  const sil = rockOutline(rng, r, h);
  const light = stone(rng, lerp(68, 75, rng()));
  const mid = stone(rng, lerp(58, 64, rng()));
  const dark = stone(rng, lerp(44, 51, rng()));

  const ai = apexIndex(sil);
  const apex = sil[ai];
  // Where the ridge running down the front of the rock meets the ground. Off
  // centre, so the lit face is the bigger one (light comes from the left).
  const front: Pt2 = { x: apex.x * 0.3 + r * 0.14, y: 0 };
  const litFace = [...sil.slice(0, ai + 1), front];
  const shadeFace = [apex, ...sil.slice(ai + 1), front];

  // A crown facet: the sliver either side of the apex, a touch brighter than
  // the lit face. It is what stops a big rock reading as a two-tone wedge.
  const prev = sil[Math.max(0, ai - 1)];
  const next = sil[Math.min(sil.length - 1, ai + 1)];
  const crown = poly(
    [
      { x: lerp(prev.x, apex.x, 0.5), y: lerp(prev.y, apex.y, 0.5) },
      apex,
      { x: lerp(next.x, apex.x, 0.55), y: lerp(next.y, apex.y, 0.55) },
      { x: apex.x * 0.55, y: apex.y * 0.5 },
    ],
    stone(rng, lerp(77, 83, rng())),
  );

  // A bedding plane / crack across the lit face, at low opacity so it reads as
  // texture rather than as an outline.
  const crack =
    rng() < 0.55
      ? `<path d="M${n1(apex.x)} ${n1(apex.y)} L${n1(lerp(sil[0].x, front.x, 0.35))} ${n1(-h * 0.12)}" stroke="${dark}" stroke-width="${n1(Math.max(0.5, r * 0.07))}" fill="none" opacity="0.3" stroke-linecap="round"/>`
      : "";

  return (
    groundShadow(scale * 0.62, 18, STONE_SHADOW) +
    poly(sil, mid) +
    poly(litFace, light) +
    poly(shadeFace, dark) +
    crown +
    crack
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
  const r = lerp(3.4, 6.2, rng()) * scale;
  const h = r * lerp(0.35, 0.6, rng());
  const sil = rockOutline(rng, r, h, 3);
  const ai = apexIndex(sil);
  return (
    groundShadow(scale * 0.16, 18, STONE_SHADOW) +
    poly(sil, stone(rng, lerp(light, light + 7, rng()))) +
    poly(
      [sil[ai], ...sil.slice(ai + 1), { x: sil[ai].x * 0.3, y: 0 }],
      stone(rng, lerp(light - 23, light - 16, rng())),
    )
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
 * A peak: a massif with a ridge, a lit and a shaded flank, and a snow cap —
 * roughly four times a boulder's height, so a mountain range never reads as a
 * rock field that happened to get big. A smaller shoulder behind it, in a hazier
 * tone, gives the range depth on a single tile.
 */
function peak(rng: Rng, scale: number): string {
  // Proportions matter more than size here. A tall narrow cone reads as a spike
  // or a witch's hat; a massif is roughly as wide at the foot as it is tall.
  const w = lerp(24, 33, rng()) * scale; // half-width at the foot
  const h = lerp(34, 48, rng()) * scale; // apex above the foot
  const apexX = lerp(-0.26, 0.26, rng()) * w;
  const apex: Pt2 = { x: apexX, y: -h };

  const face = stone(rng, lerp(54, 62, rng()), [10, 18]);
  const shade = stone(rng, lerp(34, 42, rng()), [12, 20]);
  const haze = stone(rng, lerp(44, 50, rng()), [8, 14]);

  // Each flank breaks once, so the ridgeline has a shoulder instead of being a
  // clean isoceles triangle.
  const leftBreak: Pt2 = {
    x: lerp(-w, apexX, lerp(0.42, 0.62, rng())),
    y: -h * lerp(0.34, 0.5, rng()),
  };
  const rightBreak: Pt2 = {
    x: lerp(apexX, w, lerp(0.36, 0.58, rng())),
    y: -h * lerp(0.36, 0.52, rng()),
  };
  const foot: Pt2 = { x: apexX * 0.35, y: 0 };

  const massif = [{ x: -w, y: 0 }, leftBreak, apex, rightBreak, { x: w, y: 0 }];
  const litFlank = [{ x: -w, y: 0 }, leftBreak, apex, foot];
  const shadeFlank = [apex, rightBreak, { x: w, y: 0 }, foot];

  // The back range: a broad, low, hazy massif standing behind the main summit,
  // on whichever side the apex leans away from. It is what turns one peak into
  // a RANGE, and it fills the sky a lone cone leaves empty.
  const side = apexX > 0 ? -1 : 1;
  const sw = w * lerp(0.75, 1.05, rng());
  const sh = h * lerp(0.42, 0.62, rng());
  const sx = side * w * lerp(0.65, 1.0, rng());
  const shoulder = poly(
    [
      { x: sx - sw, y: 0 },
      { x: sx - sw * 0.35, y: -sh * lerp(0.62, 0.8, rng()) },
      { x: sx + side * sw * 0.12, y: -sh },
      { x: sx + sw * 0.45, y: -sh * lerp(0.5, 0.7, rng()) },
      { x: sx + sw, y: 0 },
    ],
    haze,
  );

  // Snow, when there is any: everything above a jagged line across the summit.
  // The cap is cut from the massif's OWN flanks — `snowAt` lands on the segment
  // between a break and the apex, and every other vertex is interior — so it can
  // never hang off the silhouette the way a free-standing white wedge does.
  const snowY = lerp(apex.y, Math.min(leftBreak.y, rightBreak.y), lerp(0.4, 0.75, rng()));
  const snowAt = (a: Pt2, b: Pt2): Pt2 => {
    const t = (snowY - b.y) / (a.y - b.y || 1);
    return { x: lerp(b.x, a.x, t), y: snowY };
  };
  const snowL = snowAt(leftBreak, apex);
  const snowR = snowAt(rightBreak, apex);
  // Where the ridge running down the front of the mountain crosses the snowline.
  const ridgeMid: Pt2 = {
    x: lerp(apex.x, foot.x, (snowY - apex.y) / (0 - apex.y || 1)),
    y: snowY,
  };
  const tongue = (a: Pt2, b: Pt2, t: number, drop: number): Pt2 => ({
    x: lerp(a.x, b.x, t),
    y: snowY + h * drop,
  });
  const snow = rng() < 0.82;
  const snowLit = snow
    ? poly(
        [snowL, apex, ridgeMid, tongue(ridgeMid, snowL, 0.55, lerp(0.03, 0.1, rng()))],
        "hsl(202 24% 94%)",
      )
    : "";
  const snowShade = snow
    ? poly(
        [apex, snowR, tongue(snowR, ridgeMid, 0.45, lerp(0.02, 0.08, rng())), ridgeMid],
        "hsl(208 18% 78%)",
      )
    : "";

  return (
    groundShadow(scale * 0.95, 24, STONE_SHADOW) +
    shoulder +
    poly(massif, face) +
    poly(litFlank, face) +
    poly(shadeFlank, shade) +
    snowLit +
    snowShade
  );
}

// --- Town --------------------------------------------------------------------

/** A warm plaster/render wall, and a slightly darker tone for the shaded side. */
function renderTone(rng: Rng, light: number): string {
  return `hsl(${Math.round(lerp(26, 44, rng()))} ${Math.round(lerp(12, 26, rng()))}% ${Math.round(light)}%)`;
}

/** A row of little dark windows across a facade. */
function windows(w: number, h: number, cols: number, rows: number, tone: string): string {
  const out: string[] = [];
  const ww = (w / cols) * 0.45;
  const wh = (h / rows) * 0.42;
  for (let c = 0; c < cols; c++) {
    for (let rI = 0; rI < rows; rI++) {
      const cx = -w / 2 + (w / cols) * (c + 0.5);
      const cy = -h + (h / rows) * (rI + 0.5);
      out.push(
        `<rect x="${n1(cx - ww / 2)}" y="${n1(cy - wh / 2)}" width="${n1(ww)}" height="${n1(wh)}" fill="${tone}" opacity="0.75"/>`,
      );
    }
  }
  return out.join("");
}

/**
 * One building. A town is not a row of identical cottages, so this is three
 * archetypes off one RNG: a pitched-roof house, a flat-roofed block (the "town
 * centre" mass that makes a settlement read as bigger than a hamlet), and a low
 * hall/shed. All share the trees' lighting: lit left, shaded right.
 */
function building(rng: Rng, scale: number): string {
  const roll = rng();
  const lit = renderTone(rng, lerp(82, 90, rng()));
  const dim = renderTone(rng, lerp(62, 70, rng()));
  const glass = "hsl(210 20% 38%)";

  // Flat-roofed block: taller and wider than a house, with real windows.
  if (roll < 0.3) {
    const w = lerp(19, 27, rng()) * scale;
    const h = lerp(16, 24, rng()) * scale;
    const split = w * lerp(0.55, 0.68, rng());
    return (
      groundShadow(scale * 0.85, 16, TOWN_SHADOW) +
      `<rect x="${n1(-w / 2)}" y="${n1(-h)}" width="${n1(split)}" height="${n1(h)}" fill="${lit}"/>` +
      `<rect x="${n1(-w / 2 + split)}" y="${n1(-h)}" width="${n1(w - split)}" height="${n1(h)}" fill="${dim}"/>` +
      // Parapet: a thin darker cap that reads as the roof slab's edge.
      `<rect x="${n1(-w / 2 - 0.8 * scale)}" y="${n1(-h - 2 * scale)}" width="${n1(w + 1.6 * scale)}" height="${n1(2.4 * scale)}" fill="${renderTone(rng, lerp(52, 60, rng()))}"/>` +
      windows(w * 0.86, h * 0.86, 3, 3, glass)
    );
  }

  // Low hall / shed: wide, shallow-pitched, one big door.
  if (roll < 0.5) {
    const w = lerp(20, 28, rng()) * scale;
    const h = lerp(7, 10, rng()) * scale;
    const roof = lerp(3.5, 5.5, rng()) * scale;
    const metal = `hsl(${Math.round(lerp(200, 216, rng()))} ${Math.round(lerp(6, 12, rng()))}% ${Math.round(lerp(46, 56, rng()))}%)`;
    return (
      groundShadow(scale * 0.9, 15, TOWN_SHADOW) +
      `<rect x="${n1(-w / 2)}" y="${n1(-h)}" width="${n1(w)}" height="${n1(h)}" fill="${dim}"/>` +
      `<rect x="${n1(-w / 2)}" y="${n1(-h)}" width="${n1(w * 0.6)}" height="${n1(h)}" fill="${lit}"/>` +
      `<path d="M${n1(-w / 2 - 1.5 * scale)} ${n1(-h)} L${n1(-w * 0.12)} ${n1(-h - roof)} L${n1(w * 0.12)} ${n1(-h - roof)} L${n1(w / 2 + 1.5 * scale)} ${n1(-h)} Z" fill="${metal}"/>` +
      `<rect x="${n1(-w * 0.16)}" y="${n1(-h * 0.78)}" width="${n1(w * 0.32)}" height="${n1(h * 0.78)}" fill="${glass}" opacity="0.6"/>`
    );
  }

  // Pitched-roof house: the common case. The roof is split down the ridge so it
  // catches the same light as everything else on the board.
  const w = lerp(12, 18, rng()) * scale;
  const h = lerp(9, 14, rng()) * scale;
  const roof = lerp(6, 9, rng()) * scale;
  const eave = 1.6 * scale;
  const tileHue = Math.round(lerp(4, 22, rng()));
  const tileSat = Math.round(lerp(34, 52, rng()));
  const tileLit = `hsl(${tileHue} ${tileSat}% ${Math.round(lerp(48, 56, rng()))}%)`;
  const tileDim = `hsl(${tileHue} ${tileSat}% ${Math.round(lerp(32, 40, rng()))}%)`;
  const chimney =
    rng() < 0.45
      ? `<rect x="${n1(w * 0.18)}" y="${n1(-h - roof * 1.15)}" width="${n1(2.6 * scale)}" height="${n1(roof * 0.75)}" fill="${tileDim}"/>`
      : "";
  return (
    groundShadow(scale * 0.65, 15, TOWN_SHADOW) +
    `<rect x="${n1(-w / 2)}" y="${n1(-h)}" width="${n1(w)}" height="${n1(h)}" fill="${lit}"/>` +
    `<rect x="${n1(w * 0.08)}" y="${n1(-h)}" width="${n1(w * 0.42)}" height="${n1(h)}" fill="${dim}"/>` +
    `<rect x="${n1(-w * 0.32)}" y="${n1(-h * 0.62)}" width="${n1(w * 0.2)}" height="${n1(h * 0.62)}" fill="${glass}" opacity="0.55"/>` +
    chimney +
    `<path d="M${n1(-w / 2 - eave)} ${n1(-h)} L0 ${n1(-h - roof)} L0 ${n1(-h)} Z" fill="${tileLit}"/>` +
    `<path d="M0 ${n1(-h - roof)} L${n1(w / 2 + eave)} ${n1(-h)} L0 ${n1(-h)} Z" fill="${tileDim}"/>`
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
): string {
  const spread = (
    count: number,
    make: () => string,
    yBand: [number, number] = [20, 88],
  ): string => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const p = place(lerp(14, 86, rng()), lerp(yBand[0], yBand[1], rng()));
      out.push(`<g transform="translate(${n1(p.x)} ${n1(p.y)})">${make()}</g>`);
    }
    return out.join("");
  };
  if (kind === "rock") {
    return (
      spread(3 + Math.floor(rng() * 3), () => shelf(rng, base)) +
      spread(5 + Math.floor(rng() * 4), () => pebble(rng, 1))
    );
  }
  if (kind === "mountain") {
    // Shelves anywhere, but scree only along the FOOT of the range: a standing
    // stone placed high in a mountain tile reads as gravel floating in the sky,
    // because that part of the picture is where the peaks are.
    return (
      spread(3 + Math.floor(rng() * 3), () => shelf(rng, base)) +
      spread(4 + Math.floor(rng() * 3), () => pebble(rng, 0.85, 53), [70, 88])
    );
  }
  if (kind === "urban") {
    return (
      spread(3 + Math.floor(rng() * 3), () => paving(rng)) +
      spread(2 + Math.floor(rng() * 3), () => garden(rng))
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
// its coord or the world seed change — none of which move during play. Without
// this, panning a 20x14 board would redraw ~280 tiles of procedural art per
// frame.
const cache = new Map<string, string>();

/**
 * The complete ground art for one tile as an SVG fragment, in a 0..100 box:
 * the terrain patch, its rim, and whatever stands on it, painted back to front.
 * Returns "" for grass (see terrainOf) so the common tile costs nothing.
 */
export function tileGroundSvg(
  kind: TerrainKind,
  coordId: string,
  neighbours: TerrainNeighbours = ALL_GRASS,
  seed = 1,
): string {
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
  const key =
    `${kind}|${+same.top}${+same.right}${+same.bottom}${+same.left}` +
    `${+same.topLeft!}${+same.topRight!}${+same.bottomRight!}${+same.bottomLeft!}` +
    `|${coordId}|${seed}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const svg = buildGround(kind, coordId, same, seed);
  cache.set(key, svg);
  return svg;
}

function buildGround(
  kind: TerrainKind,
  coordId: string,
  same: PatchSame,
  seed: number,
): string {
  const base = GROUND[kind];
  if (!base) return "";

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

  // Flat marks first: scree, paving, gardens. They belong to the ground, so they
  // go under everything that stands on it and take no part in the depth sort.
  const marks = groundMarks(kind, rng, base, place);
  if (marks) parts.push(marks);

  const [lo, hi] = SCATTER_COUNT[kind];
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const band = SCATTER_BAND[kind] ?? DEFAULT_BAND;
  const placed: { y: number; g: string }[] = [];
  for (let i = 0; i < count; i++) {
    // Keep objects off the very edge so a tree's canopy doesn't collide with the
    // neighbouring tile's, and so nothing overhangs a rail on the tile boundary
    // — then keep them ON the patch (see `place` above).
    const p = place(
      lerp(band.x[0], band.x[1], rng()),
      lerp(band.y[0], band.y[1], rng()),
    );
    const scale = lerp(band.scale[0], band.scale[1], rng());
    let body: string;
    if (kind === "forest") body = tree(rng, scale * 0.42);
    else if (kind === "rock") body = boulder(rng, scale);
    else if (kind === "mountain") body = peak(rng, scale);
    else if (kind === "urban") body = building(rng, scale);
    else body = lily(rng, scale);
    placed.push({
      y: p.y,
      g: `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">${body}</g>`,
    });
  }
  // Back to front, so a nearer canopy overlaps a farther one naturally.
  placed.sort((a, b) => a.y - b.y);
  parts.push(...placed.map(p => p.g));

  return parts.join("");
}

// Test seam: the memo would otherwise make "same input, same output" untestable
// against a changed implementation.
export function _clearTerrainCache(): void {
  cache.clear();
}
