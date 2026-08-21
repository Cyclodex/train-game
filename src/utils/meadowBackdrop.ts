// Procedural meadow backdrop trees: a seeded, seamlessly repeating scatter of
// little trees across the grass. The old meadow theme tiled four
// `radial-gradient` dots via `background-size`, which made each layer a single
// dot repeated on a strict grid — the trees read as rows on lines. Here trees
// are placed with a seeded PRNG so their positions, sizes, shapes and tints all
// vary; the pattern tile is big enough that the eye doesn't lock onto the
// repeat.
//
// The layout used to be baked into a `url("data:image/svg+xml,...")` CSS
// background UNDER the board, which put every crown BEHIND the rails and roads
// laid over it. It is now rendered by `components/BackdropTrees.vue` as a
// world overlay in the canopy z band — above the rails, trains and cars — so a
// crown overlapping a corridor reads as foliage the traffic passes under, the
// same way a forest canopy does (tiles/terrain.ts, KEEP-OUT CORRIDORS). This
// module owns the deterministic layout and the "does this cell swallow a
// backdrop tree" rule; the seed is fixed so the layout is stable across
// reloads.
import { makeRng } from "@/utils/globalHelpers";
import { Rng, lerp, tree as foliageTree } from "@/utils/foliage";
import { Level, TileCell } from "@/tiles/model";
import {
  Corridor,
  GROUND_UNITS,
  TRUNK_CLEAR,
  corridorClearance,
  corridorsFor,
  terrainOf,
} from "@/tiles/terrain";

// A big pattern tile keeps the repeat far apart so the eye doesn't lock onto
// it; a few dozen trees inside read as a continuous wood rather than a pattern.
export const MEADOW_TILE = 680;
const TREE_COUNT = 46;
// Largest distance a tree's art reaches from its base point — the cull margin
// for trees standing just off the visible board whose crown still leans onto it.
export const MEADOW_TREE_REACH = 60;

export interface BackdropTree {
  x: number; // base point within the MEADOW_TILE pattern, in px
  y: number;
  svg: string; // the shared foliage art, centred on (0,0)
}

/** A backdrop tree: the shared art, biased small with the occasional tall one. */
function tree(rng: Rng): string {
  const scale = lerp(0.55, 1.25, rng() * rng());
  return foliageTree(rng, scale);
}

const layouts = new Map<number, BackdropTree[]>();

/**
 * The deterministic tree layout of ONE pattern tile. Same seed, same trees —
 * that determinism is load-bearing (a level must look identical on every load,
 * and `npm run shot` screenshots must be comparable), which is also why the
 * result is memoised rather than rebuilt per caller.
 */
export function meadowTreeLayout(seed = 20260606): BackdropTree[] {
  const hit = layouts.get(seed);
  if (hit) return hit;
  const rng = makeRng(seed);
  const out: BackdropTree[] = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    const x = rng() * MEADOW_TILE;
    const y = rng() * MEADOW_TILE;
    out.push({ x, y, svg: tree(rng) });
  }
  layouts.set(seed, out);
  return out;
}

/**
 * Whether the cell a backdrop tree's BASE stands on swallows the tree. Ground
 * that paints itself over the meadow — any non-grass terrain patch, a row of
 * parking bays, a depot/station plot — hides the tree exactly as the old
 * under-the-board texture was hidden by the art painted over it. A cell merely
 * carrying rails or a road does NOT hide one by itself — whether the tree
 * survives there is the corridor rule below.
 */
export function backdropTreeHiddenBy(
  cell: TileCell | null | undefined,
): boolean {
  if (!cell) return false;
  if (terrainOf(cell) !== "grass") return true;
  if (cell.parking) return true;
  if (cell.role) return true;
  return false;
}

/**
 * The rail/road corridors a backdrop tree at world cell (cx, cy) has to keep
 * its trunk out of — the cell's own plus its four side-neighbours', in the
 * cell's 0..GROUND_UNITS space (the forest's exact frame, see
 * `corridorsFor`). Split out from the per-tree test so the overlay can compute
 * it once per CELL rather than once per tree.
 */
export function backdropCorridorsAt(
  level: Level,
  cx: number,
  cy: number,
): Corridor[] {
  const at = (dx: number, dy: number) => level[`${cx + dx},${cy + dy}`];
  return corridorsFor(at(0, 0), {
    top: at(0, -1),
    right: at(1, 0),
    bottom: at(0, 1),
    left: at(-1, 0),
  });
}

/**
 * The forest's right-of-way rule, applied to a backdrop tree: a trunk standing
 * IN a corridor (closer than TRUNK_CLEAR to the ballast or the tarmac) is
 * felled, while one just beside the line stays — and its crown, drawn on the
 * canopy overlay, overhangs the traffic passing under it. `local` is the
 * tree's base in the cell's 0..GROUND_UNITS space.
 */
export function backdropTreeFelledBy(
  corridors: Corridor[],
  local: { x: number; y: number },
): boolean {
  if (!corridors.length) return false;
  return corridorClearance(local, corridors) < TRUNK_CLEAR;
}

/** A world px position's cell coordinate and its base point in that cell's
 * 0..GROUND_UNITS space — floor-based, so positions just off the board's
 * origin land on the -1 cells rather than wrapping. */
export function backdropCellOf(
  px: number,
  py: number,
  tileSize: number,
): { cx: number; cy: number; local: { x: number; y: number } } {
  const cx = Math.floor(px / tileSize);
  const cy = Math.floor(py / tileSize);
  return {
    cx,
    cy,
    local: {
      x: (px / tileSize - cx) * GROUND_UNITS,
      y: (py / tileSize - cy) * GROUND_UNITS,
    },
  };
}
