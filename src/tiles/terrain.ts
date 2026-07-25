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
import { TerrainKind, TileCell } from "@/tiles/model";
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

// How far a terrain patch rounds off where it does NOT continue into the
// neighbour. Big enough that a lone water tile reads as a pond rather than a
// blue square; small enough that a run of them still reads as one body.
const CORNER_R = 22;

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

// Base ground colour per kind. `null` = draw nothing (see terrainOf).
const GROUND: Record<TerrainKind, string | null> = {
  grass: null,
  forest: "hsl(96 30% 30%)",
  water: "hsl(196 44% 47%)",
  rock: "hsl(35 11% 58%)",
  urban: "hsl(38 20% 72%)",
};

// A second, lighter tone drawn just inside the patch edge — shallows at a
// shoreline, a lighter apron of gravel around rock. Without it a terrain patch
// reads as a flat sticker; with it the edge reads as a place where two grounds
// meet. `null` = no rim.
const RIM: Record<TerrainKind, string | null> = {
  grass: null,
  forest: null,
  water: "hsl(190 46% 62%)",
  rock: "hsl(35 13% 66%)",
  urban: null,
};

// --- Patch shape -------------------------------------------------------------

// The outline of this tile's terrain patch. Edges where the neighbour carries the
// SAME kind run full-bleed to the tile boundary, so adjacent tiles fuse into one
// body with no seam; edges where it doesn't are rounded off at the corners. This
// is the same "look at your neighbours" derivation autotile.ts already does for
// rails — a lake is authored as an area, not as a set of lake-corner sprites.
export function patchPath(
  same: { top: boolean; right: boolean; bottom: boolean; left: boolean },
  size = GROUND_UNITS,
  radius = CORNER_R,
): string {
  // A corner rounds only when BOTH of its edges stop here. If either continues
  // into a neighbour, the patch runs straight through the corner.
  const tl = !same.top && !same.left ? radius : 0;
  const tr = !same.top && !same.right ? radius : 0;
  const br = !same.bottom && !same.right ? radius : 0;
  const bl = !same.bottom && !same.left ? radius : 0;
  const n = (v: number) => v.toFixed(1);
  const arc = (r: number, x: number, y: number) =>
    r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y)}` : "";
  return [
    `M${n(tl)} 0`,
    `L${n(size - tr)} 0`,
    arc(tr, size, tr),
    `L${n(size)} ${n(size - br)}`,
    arc(br, size - br, size),
    `L${n(bl)} ${n(size)}`,
    arc(bl, 0, size - bl),
    `L0 ${n(tl)}`,
    arc(tl, tl, 0),
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Just the segments of the outline where the terrain actually STOPS — the parts
 * that are a real shore, not an internal join. Stroking the whole patch outline
 * instead draws a bright line down every shared edge, which turns a 2x2 lake
 * into four visibly tiled ponds: the one thing patchPath() exists to prevent.
 * Each stopping edge and each rounded corner becomes its own subpath.
 */
export function patchRimPath(
  same: { top: boolean; right: boolean; bottom: boolean; left: boolean },
  size = GROUND_UNITS,
  radius = CORNER_R,
): string {
  const tl = !same.top && !same.left ? radius : 0;
  const tr = !same.top && !same.right ? radius : 0;
  const br = !same.bottom && !same.right ? radius : 0;
  const bl = !same.bottom && !same.left ? radius : 0;
  const n = (v: number) => v.toFixed(1);
  const out: string[] = [];
  if (!same.top) out.push(`M${n(tl)} 0 L${n(size - tr)} 0`);
  if (tr > 0) out.push(`M${n(size - tr)} 0 A${n(tr)} ${n(tr)} 0 0 1 ${n(size)} ${n(tr)}`);
  if (!same.right) out.push(`M${n(size)} ${n(tr)} L${n(size)} ${n(size - br)}`);
  if (br > 0)
    out.push(`M${n(size)} ${n(size - br)} A${n(br)} ${n(br)} 0 0 1 ${n(size - br)} ${n(size)}`);
  if (!same.bottom) out.push(`M${n(size - br)} ${n(size)} L${n(bl)} ${n(size)}`);
  if (bl > 0) out.push(`M${n(bl)} ${n(size)} A${n(bl)} ${n(bl)} 0 0 1 0 ${n(size - bl)}`);
  if (!same.left) out.push(`M0 ${n(size - bl)} L0 ${n(tl)}`);
  if (tl > 0) out.push(`M0 ${n(tl)} A${n(tl)} ${n(tl)} 0 0 1 ${n(tl)} 0`);
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
  const fill = GROUND[kind];
  if (!fill) return "";

  const d = patchPath(same);
  const parts = [`<path d="${d}" fill="${fill}"/>`];

  // The rim is a thick inside stroke along the STOPPING edges only (see
  // patchRimPath), clipped to the patch so it reads as a band just inside the
  // shore rather than a line drawn on it.
  const rim = RIM[kind];
  const rimD = rim ? patchRimPath(same) : "";
  if (rim && rimD) {
    const clip = `terrain-clip-${coordId.replace(",", "-")}-${kind}`;
    parts.unshift(`<clipPath id="${clip}"><path d="${d}"/></clipPath>`);
    parts.push(
      `<path d="${rimD}" fill="none" stroke="${rim}" stroke-width="9" clip-path="url(#${clip})" opacity="0.75"/>`,
    );
  }

  const rng = tileRng(coordId, seed);
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
