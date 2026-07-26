// Shared procedural foliage art: the tree shapes used both by the seamless
// backdrop texture (utils/meadowBackdrop.ts) and by per-tile terrain scatter
// (tiles/terrain.ts).
//
// Extracted so a forest painted INTO the world and the trees in the distance are
// drawn by the same code — two different tree styles meeting at the board edge
// would give the parallax away as surely as the old static backdrop did.
//
// Everything here is a pure function of an injected RNG: same seed, same tree.
// That determinism is load-bearing (a level must look identical on every load,
// and `npm run shot` screenshots must be comparable).

export type Rng = () => number;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A harmonious meadow green at the given lightness, with small hue/sat jitter. */
export function green(rng: Rng, light: number): string {
  const hue = Math.round(lerp(96, 138, rng()));
  const sat = Math.round(lerp(34, 52, rng()));
  return `hsl(${hue} ${sat}% ${Math.round(light)}%)`;
}

/**
 * A conifer: a trunk and three stacked triangular tiers, lit from the left.
 * Drawn centred on its BASE point (the trunk foot at 0,0), growing up (-y), so
 * callers can place it by ground position and sort by y for depth.
 */
export function conifer(rng: Rng, scale: number): string {
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
export function roundTree(rng: Rng, scale: number): string {
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

/**
 * The soft ground shadow every standing object gets, centred on its base.
 *
 * The default is GREEN-tinted, because the default ground is meadow. Anything
 * standing on another ground must pass its own tint: the green ellipse under a
 * boulder reads as moss on grey rock, which is a shadow that has become a
 * feature of the wrong colour.
 */
export function groundShadow(
  scale: number,
  spread = 22,
  fill = "rgba(30,60,30,0.18)",
): string {
  return `<ellipse cx="0" cy="0" rx="${(spread * scale).toFixed(1)}" ry="${(spread * 0.32 * scale).toFixed(1)}" fill="${fill}"/>`;
}

/** A single tree with its shadow, centred on its base point. */
export function tree(rng: Rng, scale: number): string {
  const body = rng() < 0.62 ? conifer(rng, scale) : roundTree(rng, scale);
  return groundShadow(scale) + body;
}
