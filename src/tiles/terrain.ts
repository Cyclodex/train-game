// Terrain rendering, derived from tile data.
//
// `TileCell.terrain` says what a cell IS (grass/forest/water/rock/urban); this
// module turns that into ground art. Nothing here is authored per tile: an author
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
const EDGE_BOW = 9;

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

// The four edge neighbours' kinds, in the order a clockwise path walks them.
export interface TerrainNeighbours {
  top: TerrainKind;
  right: TerrainKind;
  bottom: TerrainKind;
  left: TerrainKind;
}

const ALL_GRASS: TerrainNeighbours = {
  top: "grass",
  right: "grass",
  bottom: "grass",
  left: "grass",
};

type Hsl = [h: number, s: number, l: number];
const css = ([h, s, l]: Hsl) => `hsl(${h} ${s}% ${l.toFixed(1)}%)`;

// Base ground colour per kind. `null` = draw nothing (see terrainOf).
// Rock is deliberately COOL grey and urban WARM tan: as two beiges they were
// indistinguishable on the board at any distance.
const GROUND: Record<TerrainKind, Hsl | null> = {
  grass: null,
  forest: [96, 30, 30],
  water: [196, 44, 47],
  rock: [210, 7, 56],
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
 * them. Canonicalised on the endpoint pair: `edgeBow(a, b) === edgeBow(b, a)`,
 * which is what lets the tile on each side draw the identical curve.
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
  return (r() * 2 - 1) * EDGE_BOW;
}

type Pt = { x: number; y: number };

// The tile's four corners in local space, each displaced by its lattice point's
// shared offset. Clockwise from the top-left.
function corners(x: number, y: number, seed: number, size: number): Pt[] {
  const at = (gx: number, gy: number, lx: number, ly: number): Pt => {
    const { dx, dy } = latticeOffset(gx, gy, seed);
    return { x: lx + dx, y: ly + dy };
  };
  return [
    at(x, y, 0, 0),
    at(x + 1, y, size, 0),
    at(x + 1, y + 1, size, size),
    at(x, y + 1, 0, size),
  ];
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

// One boundary, as a quadratic bowing off the straight line between corners.
// The control point is offset by twice the bow because a quadratic only reaches
// half its control offset at the midpoint.
function bowedEdge(a: Pt, b: Pt, bow: number): string {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.hypot(ex, ey) || 1;
  const cx = (a.x + b.x) / 2 - (ey / len) * bow * 2;
  const cy = (a.y + b.y) / 2 + (ex / len) * bow * 2;
  return `Q${n1(cx)} ${n1(cy)} ${n1(b.x)} ${n1(b.y)}`;
}

// Edge order matches `corners`: top, right, bottom, left.
function edgeStops(same: {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}): boolean[] {
  return [!same.top, !same.right, !same.bottom, !same.left];
}

/**
 * The outline of this tile's terrain patch. An edge whose neighbour carries the
 * SAME kind runs straight between the two shared corners — both tiles draw that
 * identical line, so the bodies fuse invisibly. An edge where the terrain stops
 * bows into a shoreline. A lake is authored as an area, never as corner sprites.
 */
export function patchPath(
  same: { top: boolean; right: boolean; bottom: boolean; left: boolean },
  x = 0,
  y = 0,
  seed = 1,
  size = GROUND_UNITS,
): string {
  const c = corners(x, y, seed, size);
  const g = cornerLattice(x, y);
  const stops = edgeStops(same);
  const out = [`M${n1(c[0].x)} ${n1(c[0].y)}`];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    if (!stops[i]) {
      out.push(bowedEdge(a, b, -SEAM_OVERLAP));
      continue;
    }
    const [ax, ay] = g[i];
    const [bx, by] = g[(i + 1) % 4];
    out.push(bowedEdge(a, b, edgeBow(ax, ay, bx, by, seed)));
  }
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
  same: { top: boolean; right: boolean; bottom: boolean; left: boolean },
  x = 0,
  y = 0,
  seed = 1,
  size = GROUND_UNITS,
): string {
  const c = corners(x, y, seed, size);
  const g = cornerLattice(x, y);
  const stops = edgeStops(same);
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    if (!stops[i]) continue;
    const a = c[i];
    const b = c[(i + 1) % 4];
    const [ax, ay] = g[i];
    const [bx, by] = g[(i + 1) % 4];
    out.push(
      `M${n1(a.x)} ${n1(a.y)} ${bowedEdge(a, b, edgeBow(ax, ay, bx, by, seed))}`,
    );
  }
  return out.join(" ");
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
  rock: [3, 5],
  urban: [2, 4],
};

/** A boulder: overlapping angular faces, lit from the left like the trees. */
function boulder(rng: Rng, scale: number): string {
  const r = 11 * scale;
  const light = `hsl(${Math.round(lerp(30, 44, rng()))} 10% ${Math.round(lerp(72, 82, rng()))}%)`;
  const dark = `hsl(${Math.round(lerp(30, 44, rng()))} 10% ${Math.round(lerp(50, 60, rng()))}%)`;
  const n = (v: number) => v.toFixed(1);
  return (
    groundShadow(scale * 0.55, 20) +
    `<path d="M${n(-r)} 0 L${n(-r * 0.7)} ${n(-r * 1.1)} L${n(r * 0.1)} ${n(-r * 1.35)} L${n(r * 0.85)} ${n(-r * 0.6)} L${n(r)} 0 Z" fill="${light}"/>` +
    `<path d="M${n(r * 0.1)} ${n(-r * 1.35)} L${n(r * 0.85)} ${n(-r * 0.6)} L${n(r)} 0 L${n(r * 0.15)} 0 Z" fill="${dark}"/>`
  );
}

/** A little house: a warm wall block under a darker pitched roof. */
function house(rng: Rng, scale: number): string {
  const w = 15 * scale;
  const h = 11 * scale;
  const roof = 7 * scale;
  const wall = `hsl(${Math.round(lerp(28, 40, rng()))} ${Math.round(lerp(18, 30, rng()))}% ${Math.round(lerp(78, 88, rng()))}%)`;
  const tile = `hsl(${Math.round(lerp(4, 20, rng()))} ${Math.round(lerp(35, 50, rng()))}% ${Math.round(lerp(38, 48, rng()))}%)`;
  const n = (v: number) => v.toFixed(1);
  return (
    groundShadow(scale * 0.7, 18) +
    `<rect x="${n(-w / 2)}" y="${n(-h)}" width="${n(w)}" height="${n(h)}" fill="${wall}"/>` +
    `<path d="M${n(-w / 2 - 1.5 * scale)} ${n(-h)} L0 ${n(-h - roof)} L${n(w / 2 + 1.5 * scale)} ${n(-h)} Z" fill="${tile}"/>`
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
  const same = {
    top: neighbours.top === kind,
    right: neighbours.right === kind,
    bottom: neighbours.bottom === kind,
    left: neighbours.left === kind,
  };
  const key = `${kind}|${+same.top}${+same.right}${+same.bottom}${+same.left}|${coordId}|${seed}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const svg = buildGround(kind, coordId, same, seed);
  cache.set(key, svg);
  return svg;
}

function buildGround(
  kind: TerrainKind,
  coordId: string,
  same: { top: boolean; right: boolean; bottom: boolean; left: boolean },
  seed: number,
): string {
  const base = GROUND[kind];
  if (!base) return "";

  const rng = tileRng(coordId, seed);
  const { x, y } = parseCoordId(coordId);

  const d = patchPath(same, x, y, seed);
  const parts = [`<path d="${d}" fill="${css(base)}"/>`];

  // The rim is a thick inside stroke along the STOPPING edges only (see
  // patchRimPath), clipped to the patch so it reads as a band just inside the
  // shore rather than a line drawn on it.
  const rim = RIM[kind];
  const rimD = rim ? patchRimPath(same, x, y, seed) : "";
  if (rim && rimD) {
    const clip = `terrain-clip-${coordId.replace(",", "-")}-${kind}`;
    parts.unshift(`<clipPath id="${clip}"><path d="${d}"/></clipPath>`);
    parts.push(
      `<path d="${rimD}" fill="none" stroke="${css(rim)}" stroke-width="9" clip-path="url(#${clip})" opacity="0.75"/>`,
    );
  }

  const [lo, hi] = SCATTER_COUNT[kind];
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const placed: { y: number; g: string }[] = [];
  for (let i = 0; i < count; i++) {
    // Keep objects off the very edge so a tree's canopy doesn't collide with the
    // neighbouring tile's, and so nothing overhangs a rail on the tile boundary.
    const x = lerp(16, 84, rng());
    const y = lerp(24, 88, rng());
    const scale = lerp(0.72, 1.15, rng());
    let body: string;
    if (kind === "forest") body = tree(rng, scale * 0.42);
    else if (kind === "rock") body = boulder(rng, scale);
    else if (kind === "urban") body = house(rng, scale);
    else body = lily(rng, scale);
    placed.push({
      y,
      g: `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">${body}</g>`,
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
