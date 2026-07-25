// Procedural meadow backdrop: a seamless, tileable SVG of little trees scattered
// across the grass. The old meadow theme tiled four `radial-gradient` dots via
// `background-size`, which made each layer a single dot repeated on a strict grid
// — the trees read as rows on lines. Here we place trees with a seeded PRNG so
// their positions, sizes, shapes and tints all vary, and we wrap trees across the
// tile edges so the (necessarily repeating) background tile has no visible seams.
//
// The result is emitted once as a `url("data:image/svg+xml,...")` string and fed
// into `.theme-meadow` via the `--meadow-trees` CSS custom property (see App.vue
// and _themes.scss). The seed is fixed so the layout is stable across reloads.
import { makeRng } from "@/utils/globalHelpers";
import { Rng, lerp, tree as foliageTree } from "@/utils/foliage";

// A big tile keeps the repeat far apart so the eye doesn't lock onto it; a few
// dozen trees inside read as a continuous wood rather than a pattern.
const TILE = 680;
const TREE_COUNT = 46;
// Largest distance a tree's art reaches from its base point; trees within this
// of an edge are also drawn wrapped to the opposite side for a seamless tile.
const WRAP_MARGIN = 60;

/** A backdrop tree: the shared art, biased small with the occasional tall one. */
function tree(rng: Rng): { svg: string; scale: number } {
  const scale = lerp(0.55, 1.25, rng() * rng());
  return { svg: foliageTree(rng, scale), scale };
}

/** Build the seamless tree-scatter SVG as a `url("data:...")` background value. */
export function meadowTreesUrl(seed = 20260606): string {
  const rng = makeRng(seed);
  const placed: { py: number; g: string }[] = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    const x = rng() * TILE;
    const y = rng() * TILE;
    const { svg } = tree(rng);
    // Draw the tree, plus wrapped copies for any tree near an edge so the tile
    // repeats seamlessly across its boundaries.
    for (const dx of [-TILE, 0, TILE]) {
      for (const dy of [-TILE, 0, TILE]) {
        const px = x + dx;
        const py = y + dy;
        const onTile = px > -WRAP_MARGIN && px < TILE + WRAP_MARGIN && py > -WRAP_MARGIN && py < TILE + WRAP_MARGIN;
        if (!onTile) continue;
        placed.push({
          py,
          g: `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})">${svg}</g>`,
        });
      }
    }
  }
  // Paint from back (smaller y, higher up the tile) to front so nearer canopies
  // overlap farther ones naturally.
  const ordered = placed
    .sort((a, b) => a.py - b.py)
    .map(o => o.g)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">` +
    ordered +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
