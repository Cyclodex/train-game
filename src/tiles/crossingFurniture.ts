import { LANE_WIDTH_FRAC } from "@/sim/laneOffset";
import { roadSeamPaintTotal } from "@/tiles/lanes";

// LEVEL-CROSSING FURNITURE GEOMETRY — where the boom barriers and the warning
// signs stand on a crossing tile, DERIVED FROM THE ROAD they guard.
//
// The furniture used to be pinned to fixed tile percentages (post at 30%, arm
// 30%→70%). That happens to look right on a 1+1-lane street and is wrong on
// everything else: on a 3+3-lane street the tarmac is 84% of the tile, so the
// post stood in the middle of the carriageway and the arm covered only the two
// inner lanes. The road's painted width is data — so the furniture is derived
// from it, exactly like the pavement offset in `tiles/footway.ts`.
//
// THE LOCAL FRAME. `Crossing.vue` draws one layout — the road running vertically
// — and rotates the whole overlay a quarter turn (CSS `rotate(90deg)`) when the
// road runs Left↔Right. Everything here is in that upright local frame:
//
//   local +y = "down the road"   local +x = the right-hand side of the tile
//   x = 0    = the road's centreline (a two-way road is painted centred on it)
//
// CSS `rotate(90deg)` maps local (x,y) → screen (−y, x), so for a horizontal
// road local +y is screen-LEFT: "local down" is the Right→Left movement, and the
// caller must pass the ports that way round (see `Crossing.vue`).
//
// HANDEDNESS. Traffic keeps right, so a vehicle travelling local-DOWN drives on
// the local −x half (facing +y on a y-down screen, its right hand points −x) and
// meets the rails coming from the local top. Its half-barrier therefore hinges on
// the −x verge; the local-UP approach's hinges on +x. That diagonal pair — one
// bar left, one bar right, each covering its own carriageway — is how a real
// Bahnübergang guards a dual carriageway, and it scales to any lane count: each
// arm is only ever half the road long.

export type RoadFlow = "two-way" | "down" | "up";

/** The painted tarmac of a crossing tile, as local-x offsets of its two kerbs. */
export interface RoadSpan {
  xMin: number; // px, the −x kerb (negative on a two-way road)
  xMax: number; // px, the +x kerb
  flow: RoadFlow;
}

export interface CrossingBoom {
  y: number; // px from the tile's top edge: which side of the rails this row is
  hinge: number; // px from the centreline: the post, always outside the kerb
  length: number; // px the arm reaches from the hinge (always > 0)
  dir: 1 | -1; // which way the arm sweeps from the hinge
}

export interface CrossingSign {
  x: number; // px from the centreline (the sign's centre)
  y: number; // px from the tile's top edge (the sign's centre)
}

export interface CrossingLayout {
  booms: CrossingBoom[];
  signs: CrossingSign[];
}

// How far past the kerb the post stands, as a fraction of the tile. The pavement
// is drawn from the kerb outward for 8 ground units (`tiles/footway.ts`), so 4%
// puts the post in the middle of it — on the footpath, never on the tarmac.
export const VERGE_FRAC = 0.04;
// The two barrier rows, either side of the rails (which run through the middle).
export const BOOM_ROW_FRACS: [number, number] = [0.28, 0.72];
// How far up/down the road the warning sign stands from its barrier row.
const SIGN_GAP_FRAC = 0.15;
// Keep the post inside the tile even on an absurdly wide road.
const EDGE_FRAC = 0.48;

/**
 * The painted tarmac of a STRAIGHT crossing tile in the local frame.
 *
 * Mirrors the straight-road branch of `Tile.vue`'s `roadPaths` (the authority on
 * what is actually painted) at the MIDDLE of the tile, where the rails run: a
 * two-way road is a centred band that tapers between its two seams, a one-way
 * road is kerb-anchored to its run's widest lane count.
 *
 * `downLanes` / `upLanes` are the lanes entering from the local-top and
 * local-bottom ports; `crossDown` / `crossUp` the neighbour's `laneCountAt`
 * across those two seams (0 = no road neighbour).
 */
export function crossingRoadSpan(p: {
  size: number;
  downLanes: number;
  upLanes: number;
  crossDown: number;
  crossUp: number;
  downIsJunction: boolean;
  upIsJunction: boolean;
  runMax: number;
}): RoadSpan {
  const W = p.size * LANE_WIDTH_FRAC;

  // Two-way: a centred band, min-seam tapered at each end. Take it at mid-tile.
  if (p.downLanes > 0 && p.upLanes > 0) {
    const selfTotal = Math.max(p.downLanes + p.upLanes, 2);
    const totalDown = roadSeamPaintTotal(selfTotal, p.crossDown, p.downIsJunction);
    const totalUp = roadSeamPaintTotal(selfTotal, p.crossUp, p.upIsJunction);
    const half = (((totalDown + totalUp) / 2) * W) / 2;
    return { xMin: -half, xMax: half, flow: "two-way" };
  }

  // One-way: kerb-anchored to the run's widest count (see laneOffset.ts
  // `oneWayLaneOffsetPx`). The kerb is the right-hand side of travel, which is
  // local −x for a down-running road and local +x for an up-running one.
  const down = p.downLanes > 0;
  const m = Math.max(p.downLanes, p.upLanes, 1);
  const R = Math.max(p.runMax, m);
  const crossEntry = down ? p.crossDown : p.crossUp;
  const crossExit = down ? p.crossUp : p.crossDown;
  const jEntry = down ? p.downIsJunction : p.upIsJunction;
  const jExit = down ? p.upIsJunction : p.downIsJunction;
  const entryCount = !jEntry && crossEntry > 0 ? Math.min(m, crossEntry) : m;
  const exitCount = !jExit && crossExit > 0 ? Math.min(m, crossExit) : m;
  const kerb = (R / 2) * W;
  // The closing lane keeps its tarmac across a narrowing tile, so the inner edge
  // runs at the wider of the two ends on the exit side; take the mid-tile value.
  const inner = kerb - ((entryCount + Math.max(entryCount, exitCount)) / 2) * W;
  return down
    ? { xMin: -kerb, xMax: -inner, flow: "down" }
    : { xMin: inner, xMax: kerb, flow: "up" };
}

/**
 * Where the booms and signs stand for a road of the given painted span.
 *
 * Two-way → two half-barriers, one hinged on each verge, each reaching to the
 * centreline: the local-top row guards the down carriageway (−x), the bottom row
 * the up carriageway (+x). One-way → a single FULL barrier, on the approach side
 * only, spanning the whole width (there is no oncoming half to leave clear, and
 * a barrier behind a one-way crossing guards nothing).
 */
export function crossingLayout(size: number, span: RoadSpan): CrossingLayout {
  const verge = size * VERGE_FRAC;
  const limit = size * EDGE_FRAC;
  const clamp = (v: number) => Math.max(-limit, Math.min(limit, v));
  const [rowTop, rowBottom] = BOOM_ROW_FRACS.map(f => f * size);
  const gap = size * SIGN_GAP_FRAC;

  const leftHinge = clamp(span.xMin - verge);
  const rightHinge = clamp(span.xMax + verge);
  // The tip of a half-barrier: the centreline, but never behind its own hinge
  // (a one-way road can sit entirely on one side of it).
  const midTip = Math.min(Math.max(0, span.xMin), span.xMax);

  const booms: CrossingBoom[] = [];
  const signs: CrossingSign[] = [];
  const add = (y: number, hinge: number, tip: number, signY: number) => {
    const length = Math.abs(tip - hinge);
    booms.push({ y, hinge, length, dir: tip >= hinge ? 1 : -1 });
    signs.push({ x: hinge, y: signY });
  };

  if (span.flow !== "up") {
    // The down carriageway approaches from the local top.
    add(rowTop, leftHinge, span.flow === "down" ? span.xMax : midTip, rowTop - gap);
  }
  if (span.flow !== "down") {
    add(rowBottom, rightHinge, span.flow === "up" ? span.xMin : midTip, rowBottom + gap);
  }
  return { booms, signs };
}
