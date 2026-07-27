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

// Trees are drawn TOP-DOWN: the board is a plan view (tracks, trains and roads
// all are), so a tree is its canopy seen from above, centred on (0,0). Light
// comes from the NORTH-WEST — a lit lobe offset up-left, a shaded rim down-right
// — and the drop shadow is a same-size disc offset to the SOUTH-EAST. That one
// sun direction is shared by every standing object on the board.

// How far a canopy's drop shadow is displaced, as a fraction of its radius.
const SHADOW_SHIFT = 0.3;

function canopyShadow(r: number, fill = "rgba(30,60,30,0.2)"): string {
  const off = (r * SHADOW_SHIFT).toFixed(1);
  return `<circle cx="${off}" cy="${off}" r="${r.toFixed(1)}" fill="${fill}"/>`;
}

/**
 * A conifer from above: a spiky whorl of branch tips — a star polygon whose
 * long and short radii both jitter — darker and denser than a broadleaf, with a
 * smaller lit whorl nudged toward the light.
 */
export function conifer(rng: Rng, scale: number): string {
  const r = lerp(22, 30, rng()) * scale; // canopy radius
  const lit = green(rng, lerp(36, 44, rng()));
  const shade = green(rng, lerp(24, 30, rng()));
  const spikes = 9 + Math.floor(rng() * 3);
  const rot = rng() * Math.PI;
  const star = (radius: number, cx: number, cy: number): string => {
    const pts: string[] = [];
    for (let i = 0; i < spikes * 2; i++) {
      const ang = rot + (i / (spikes * 2)) * Math.PI * 2;
      const rad = radius * (i % 2 === 0 ? lerp(0.92, 1.08, rng()) : lerp(0.55, 0.68, rng()));
      pts.push(
        `${(cx + Math.cos(ang) * rad).toFixed(1)} ${(cy + Math.sin(ang) * rad).toFixed(1)}`,
      );
    }
    return `M${pts.join(" L")} Z`;
  };
  return (
    canopyShadow(r * 0.92) +
    `<path d="${star(r, 0, 0)}" fill="${shade}"/>` +
    `<path d="${star(r * 0.55, -r * 0.12, -r * 0.12)}" fill="${lit}"/>`
  );
}

/** A broadleaf from above: a clump of overlapping round lobes, lit toward NW. */
export function roundTree(rng: Rng, scale: number): string {
  const r = lerp(17, 23, rng()) * scale; // canopy radius
  const lit = green(rng, lerp(42, 52, rng()));
  const mid = green(rng, lerp(34, 40, rng()));
  const shade = green(rng, lerp(24, 30, rng()));
  const lobe = (cx: number, cy: number, rad: number, fill: string) =>
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="${fill}"/>`;
  return (
    canopyShadow(r) +
    lobe(0, 0, r, mid) +
    // The shaded rim: a lobe pushed down-right, then the lit crown up-left on
    // top of it, plus two smaller lumps so the outline is a clump, not a disc.
    lobe(r * 0.3, r * 0.3, r * 0.72, shade) +
    lobe(-r * 0.22, -r * 0.22, r * 0.66, lit) +
    lobe(r * 0.55, -r * 0.28, r * 0.4, mid) +
    lobe(-r * 0.3, r * 0.5, r * 0.38, shade)
  );
}

/** A single tree with its shadow, centred on its canopy centre. */
export function tree(rng: Rng, scale: number): string {
  return rng() < 0.62 ? conifer(rng, scale) : roundTree(rng, scale);
}

/**
 * A low bush: a couple of small bright lobes hugging the ground, with barely
 * any shadow. This is what grows in a GLADE — the light gets through where the
 * canopy doesn't close — so it reads a step lighter and lower than the trees
 * around it.
 */
export function bush(rng: Rng, scale: number): string {
  const r = lerp(6, 9, rng()) * scale;
  const lit = green(rng, lerp(48, 56, rng()));
  const mid = green(rng, lerp(40, 46, rng()));
  const lobe = (cx: number, cy: number, rad: number, fill: string) =>
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="${fill}"/>`;
  return (
    canopyShadow(r * 0.8, "rgba(30,60,30,0.12)") +
    lobe(r * 0.25, r * 0.15, r * 0.8, mid) +
    lobe(-r * 0.3, -r * 0.1, r * 0.7, lit) +
    lobe(r * 0.05, -r * 0.35, r * 0.5, lit)
  );
}
