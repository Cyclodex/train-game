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
// the −x verge; the local-UP approach's hinges on +x. On a narrow street that is
// the whole arrangement — the classic diagonal pair of half-barriers, each arm
// covering its own carriageway.
//
// A BIG STREET GETS A BAR ON BOTH VERGES OF BOTH ROWS — four in total. Once a
// carriageway is more than one lane wide, guarding it from the far verge means an
// arm reaching across the oncoming lanes, so each row is closed by its OWN pair:
// one bar in from the left, one in from the right, meeting in the middle. That is
// also how a real wide crossing is built — no arm is ever longer than half the
// road, whatever the lane count.

export type RoadFlow = "two-way" | "down" | "up";

/** The painted tarmac of a crossing tile, as local-x offsets of its two kerbs. */
export interface RoadSpan {
  xMin: number; // px, the −x kerb (negative on a two-way road)
  xMax: number; // px, the +x kerb
  lanes: number; // painted lanes across, both directions — what makes a street "big"
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
// How far up/down the road the light signal stands from its barrier row.
const SIGN_GAP_FRAC = 0.15;
// How far short of each other two facing arms stop, as a fraction of the tile —
// the gap that makes a closed crossing read as two barriers instead of one bar.
// Well under a car's width (0.14 of a tile), so the road still reads as closed.
export const CENTRE_GAP_FRAC = 0.045;
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
  // ONE-WAY only: the lane count of the same-direction one-way straight
  // neighbour UPSTREAM of the entry seam, 0/absent when the feeder is anything
  // else. The centre-side surface adopts it at the entry edge (streetProfile
  // `oneWayCentreBand`): after a gore the crossing tile carries the recovery
  // taper, so its mid-tile span — and the boom lengths derived from it — match
  // the tarmac actually painted under them.
  upstreamCount?: number;
}): RoadSpan {
  const W = p.size * LANE_WIDTH_FRAC;

  // Two-way: a centred band, min-seam tapered at each end. Take it at mid-tile.
  if (p.downLanes > 0 && p.upLanes > 0) {
    const selfTotal = Math.max(p.downLanes + p.upLanes, 2);
    const totalDown = roadSeamPaintTotal(selfTotal, p.crossDown, p.downIsJunction);
    const totalUp = roadSeamPaintTotal(selfTotal, p.crossUp, p.upIsJunction);
    const lanes = (totalDown + totalUp) / 2;
    const half = (lanes * W) / 2;
    return { xMin: -half, xMax: half, lanes, flow: "two-way" };
  }

  // One-way: kerb-anchored to the run's widest count (see laneOffset.ts
  // `oneWayLaneOffsetPx`). The kerb is the right-hand side of travel, which is
  // local −x for a down-running road and local +x for an up-running one.
  const down = p.downLanes > 0;
  const m = Math.max(p.downLanes, p.upLanes, 1);
  const R = Math.max(p.runMax, m);
  const crossEntry = down ? p.crossDown : p.crossUp;
  const jEntry = down ? p.downIsJunction : p.upIsJunction;
  const entryCount = !jEntry && crossEntry > 0 ? Math.min(m, crossEntry) : m;
  const kerb = (R / 2) * W;
  // Entry edge adopts the upstream one-way's own count (recovery taper after a
  // gore); exit edge is this tile's own — the profile's one-way centre rule.
  // Mid-tile is their average.
  const entryBand = p.upstreamCount && p.upstreamCount > 0 ? p.upstreamCount : entryCount;
  const inner = kerb - ((entryBand + m) / 2) * W;
  const lanes = (kerb - inner) / W;
  return down
    ? { xMin: -kerb, xMax: -inner, lanes, flow: "down" }
    : { xMin: inner, xMax: kerb, lanes, flow: "up" };
}

// Above this many painted lanes a street is BIG: every guarded row gets a bar in
// from BOTH verges instead of one bar reaching across. Two lanes (1+1) is the
// narrow street that keeps the classic diagonal pair.
export const BIG_STREET_LANES = 2;

/**
 * Where the booms and signs stand for a road of the given painted span.
 *
 * ROWS. A two-way street is guarded on both sides of the rails — the local-top
 * row stops the down carriageway, the bottom row the up one. A one-way street
 * gets its single row on the approach side only; a barrier behind a one-way
 * crossing guards nothing.
 *
 * BARS PER ROW. A narrow street (≤ `BIG_STREET_LANES`) takes ONE bar per row,
 * hinged on the verge to the approaching driver's right. A big street takes TWO
 * per row — one in from each verge, meeting in the middle — so four in total on
 * an ordinary two-way street. Reaching the far verge on a wide road would mean an
 * arm swinging right across the oncoming lanes; the pair keeps every arm to half
 * the road however many lanes it has.
 *
 * ONE SIGNAL PER POST, not per row. A Swiss crossing carries a Blinklichtsignal
 * on every barrier mast, so a four-bar street has four — one at each corner. It
 * is also what makes a closed crossing READ as two barriers per side rather than
 * one long bar.
 *
 * THE CENTRE GAP does the same job. Two half-barriers meeting exactly on the
 * centreline draw as a single unbroken bar; real ones stop short of each other,
 * so every arm whose tip is the meeting point is shortened by `CENTRE_GAP_FRAC`.
 * The gap stays far narrower than a car, so the road still reads as closed. An
 * arm that ends at a KERB (a narrow one-way street's full barrier) is not
 * shortened — nothing meets it.
 */
export function crossingLayout(size: number, span: RoadSpan): CrossingLayout {
  const verge = size * VERGE_FRAC;
  const limit = size * EDGE_FRAC;
  const clamp = (v: number) => Math.max(-limit, Math.min(limit, v));
  const [rowTop, rowBottom] = BOOM_ROW_FRACS.map(f => f * size);
  const signGap = size * SIGN_GAP_FRAC;
  const centreGap = size * CENTRE_GAP_FRAC;

  const leftHinge = clamp(span.xMin - verge);
  const rightHinge = clamp(span.xMax + verge);
  const big = span.lanes > BIG_STREET_LANES;
  // Where two bars of the same row meet. On a two-way street that is the
  // centreline — each bar then covers exactly its own carriageway — and on a
  // one-way street (no centreline) the middle of the tarmac.
  const meet = span.flow === "two-way" ? 0 : (span.xMin + span.xMax) / 2;

  const booms: CrossingBoom[] = [];
  const signs: CrossingSign[] = [];
  // `stopShort` = this arm ends where another one does, so leave the gap.
  const bar = (y: number, hinge: number, tip: number, stopShort: boolean, signY: number) => {
    const dir: 1 | -1 = tip >= hinge ? 1 : -1;
    const length = Math.max(0, Math.abs(tip - hinge) - (stopShort ? centreGap : 0));
    booms.push({ y, hinge, length, dir });
    signs.push({ x: hinge, y: signY });
  };

  // One guarded row: `side` is the approaching driver's right-hand verge (−1 for
  // the down carriageway, +1 for the up one) — where its single bar hinges when
  // the street is narrow enough for one.
  const row = (y: number, side: 1 | -1, signY: number) => {
    if (big) {
      bar(y, leftHinge, meet, true, signY);
      bar(y, rightHinge, meet, true, signY);
    } else if (side < 0) {
      bar(y, leftHinge, span.flow === "two-way" ? 0 : span.xMax, span.flow === "two-way", signY);
    } else {
      bar(y, rightHinge, span.flow === "two-way" ? 0 : span.xMin, span.flow === "two-way", signY);
    }
  };

  if (span.flow !== "up") row(rowTop, -1, rowTop - signGap);
  if (span.flow !== "down") row(rowBottom, 1, rowBottom + signGap);
  return { booms, signs };
}
