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

// A big tile keeps the repeat far apart so the eye doesn't lock onto it; a few
// dozen trees inside read as a continuous wood rather than a pattern.
const TILE = 680;
const TREE_COUNT = 46;
// Largest distance a tree's art reaches from its base point; trees within this
// of an edge are also drawn wrapped to the opposite side for a seamless tile.
const WRAP_MARGIN = 60;

type Rng = () => number;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A harmonious meadow green at the given lightness, with small hue/sat jitter. */
function green(rng: Rng, light: number): string {
  const hue = Math.round(lerp(96, 138, rng()));
  const sat = Math.round(lerp(34, 52, rng()));
  return `hsl(${hue} ${sat}% ${Math.round(light)}%)`;
}

/** A conifer: a trunk and three stacked triangular tiers, lit from the left. */
function conifer(rng: Rng, scale: number): string {
  const w = 26 * scale; // canopy half-width at the base
  const h = 58 * scale; // canopy height (grows upward, -y)
  const lit = green(rng, lerp(40, 50, rng()));
  const shade = green(rng, lerp(24, 32, rng()));
  const trunkH = 9 * scale;
  const trunkW = 4 * scale;
  const tiers: string[] = [];
  for (let i = 0; i < 3; i++) {
    const t = i / 3; // 0 (bottom) .. ~0.67 (top)
    const baseY = -trunkH - h * t;
    const tierTop = baseY - h * 0.42;
    const halfW = w * (1 - t * 0.55);
    // Split each tier down the middle: lit left half, shaded right half.
    tiers.push(
      `<path d="M0 ${baseY.toFixed(1)} L${(-halfW).toFixed(1)} ${baseY.toFixed(1)} L0 ${tierTop.toFixed(1)} Z" fill="${lit}"/>`,
      `<path d="M0 ${baseY.toFixed(1)} L${halfW.toFixed(1)} ${baseY.toFixed(1)} L0 ${tierTop.toFixed(1)} Z" fill="${shade}"/>`,
    );
  }
  return (
    `<rect x="${(-trunkW / 2).toFixed(1)}" y="${(-trunkH).toFixed(1)}" width="${trunkW.toFixed(1)}" height="${(trunkH + 1).toFixed(1)}" fill="#6b4a2b"/>` +
    tiers.join("")
  );
}

/** A round-canopy tree: a trunk and a clump of overlapping leafy blobs. */
function roundTree(rng: Rng, scale: number): string {
  const r = 20 * scale; // canopy radius
  const trunkH = 12 * scale;
  const trunkW = 5 * scale;
  const lit = green(rng, lerp(42, 52, rng()));
  const mid = green(rng, lerp(34, 40, rng()));
  const shade = green(rng, lerp(24, 30, rng()));
  const cy = -trunkH - r * 0.7;
  const blobs = [
    `<circle cx="0" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${mid}"/>`,
    `<circle cx="${(-r * 0.6).toFixed(1)}" cy="${(cy + r * 0.25).toFixed(1)}" r="${(r * 0.75).toFixed(1)}" fill="${lit}"/>`,
    `<circle cx="${(r * 0.55).toFixed(1)}" cy="${(cy + r * 0.3).toFixed(1)}" r="${(r * 0.7).toFixed(1)}" fill="${shade}"/>`,
    `<circle cx="${(r * 0.1).toFixed(1)}" cy="${(cy - r * 0.45).toFixed(1)}" r="${(r * 0.6).toFixed(1)}" fill="${lit}"/>`,
  ];
  return (
    `<rect x="${(-trunkW / 2).toFixed(1)}" y="${(-trunkH).toFixed(1)}" width="${trunkW.toFixed(1)}" height="${(trunkH + 1).toFixed(1)}" fill="#6f4c2a"/>` +
    blobs.join("")
  );
}

/** A single tree group with a soft ground shadow, centred on its base point. */
function tree(rng: Rng): { svg: string; scale: number } {
  // Bias towards smaller trees with the occasional tall one, for depth.
  const scale = lerp(0.55, 1.25, rng() * rng());
  const shadow = `<ellipse cx="0" cy="0" rx="${(22 * scale).toFixed(1)}" ry="${(7 * scale).toFixed(1)}" fill="rgba(30,60,30,0.18)"/>`;
  const body = rng() < 0.62 ? conifer(rng, scale) : roundTree(rng, scale);
  return { svg: shadow + body, scale };
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
