import { Position } from "@/types";
import { Port, oppositePort } from "@/sim/topology";
import {
  roadSegmentPathD,
  laneSegmentPathD,
  laneRibbonPathD,
  portPoint,
} from "@/sim/pathGeometry";

// Road rendering is the sibling of tiles/geometry.ts (rail): both derive their
// SVG from a cell's port pairs. A road carries no two flanking rails — it is a
// single paved ribbon — so the surface is just the centreline a car drives along
// (the same geometry trains follow, segmentPathD), stroked wide by the renderer.

// The paved-surface path for a road pair: a straight line for opposite/Center
// links, a quarter-circle around the wrapped corner for adjacent ports (the
// road-turn geometry — see sim/pathGeometry.ts roadSegmentPathD). Stroke wide.
export function roadSurfacePath(entry: Port, exit: Port, size: number): string {
  return roadSegmentPathD(entry, exit, size);
}

// The unit right-hand-of-travel perpendicular to the entry→exit centreline in
// screen space (y-down), returned as {nx, ny} to be scaled by the desired
// offset. Returns the zero vector if a and b coincide (shouldn't happen for
// real road pairs, but keeps callers from dividing by zero).
function perpUnit(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mag = Math.hypot(dx, dy) || 1;
  // Right-hand perpendicular in screen space: (-dy, dx)
  return { x: -dy / mag, y: dx / mag };
}

export interface LaneMarkingPath {
  d: string;
  kind: "centre" | "inner";
  // True for a lane-drop divider — the boundary of a lane that ends at this
  // tile (a 3→2 / 2→1 taper), which merging cars cross. The view paints these
  // with a tighter dash than ordinary continuing lane dividers.
  merge?: boolean;
}

// One painted lane-drop arrow: a stroked shaft plus an open (two-stroke)
// chevron head. Both parts are stroked, not filled — the slim open-chevron
// look of the real Swiss lane-reduction marking.
export interface MergeArrowPath {
  shaft: string;
  head: string;
}

// One in-lane lane-drop arrow ("this lane is ending, move over") on a straight
// road edge, in the Swiss style: a slim open-chevron arrow painted inside the
// ending lane, pointing in the direction of travel (entry→exit) and angled
// toward the centre divider (the merge direction). The lean is balanced around
// the lane centre so the whole arrow stays centred in — and contained by — its
// own lane. `laneIndex` is the lane it sits in (0 = centre-adjacent; the outer,
// higher-index lanes are the ones that end). `alongT` (0..1) is the position of
// the arrow's midpoint along the entry→exit centreline.
export function laneDropArrowPath(
  entry: Port,
  exit: Port,
  size: number,
  laneIndex: number,
  alongT: number,
): MergeArrowPath {
  const LANE_W = size * 0.14;
  const HALF = size * 0.075; // half the shaft length (compact)
  const LATERAL = 0.6; // chevron lean (in lane widths) toward the centre divider
  const HEAD = size * 0.05; // chevron barb length (slim head)
  const SPLAY = 0.5; // half-angle of the open chevron, radians

  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const fx = dx / len, fy = dy / len; // forward (travel) unit
  const n = perpUnit(a, b); // right-of-travel unit (lanes sit on +n)

  // Split the lateral lean symmetrically about the lane centre so the angled
  // arrow stays centred in its lane: tail sits outward, head leans inward.
  const along0 = alongT * len;
  const laneMid = (laneIndex + 0.5) * LANE_W;
  const tailOff = laneMid + (LATERAL / 2) * LANE_W;
  const headOff = laneMid - (LATERAL / 2) * LANE_W;
  const tail = {
    x: a.x + fx * (along0 - HALF) + n.x * tailOff,
    y: a.y + fy * (along0 - HALF) + n.y * tailOff,
  };
  const head = {
    x: a.x + fx * (along0 + HALF) + n.x * headOff,
    y: a.y + fy * (along0 + HALF) + n.y * headOff,
  };

  const ang = Math.atan2(head.y - tail.y, head.x - tail.x);
  const a1 = ang + Math.PI - SPLAY;
  const a2 = ang + Math.PI + SPLAY;
  const r = (v: number) => Math.round(v * 100) / 100;
  // Open chevron: a barb back to the tip and out to the other barb (no fill).
  return {
    shaft: `M ${r(tail.x)} ${r(tail.y)} L ${r(head.x)} ${r(head.y)}`,
    head:
      `M ${r(head.x + Math.cos(a1) * HEAD)} ${r(head.y + Math.sin(a1) * HEAD)} ` +
      `L ${r(head.x)} ${r(head.y)} ` +
      `L ${r(head.x + Math.cos(a2) * HEAD)} ${r(head.y + Math.sin(a2) * HEAD)}`,
  };
}

// Decide where lane-drop arrows go for one travel direction on a straight tile.
// `selfN` is this direction's lane count; `downstream1` / `downstream2` are the
// same direction's lane counts 1 and 2 tiles ahead (0 = no road / map edge).
// Returns one `{ laneIndex, alongT }` per arrow to paint:
//   - drop at this tile's far seam (downstream1 < selfN): one arrow per ending
//     lane, placed in the entry half (before the surface taper near the exit).
//   - drop one tile ahead (downstream1 === selfN, downstream2 < selfN): two
//     advance arrows per ending lane, leading toward the exit.
// Ending lanes are the outer indices [survivors, selfN) that don't continue.
// Anything else (no drop, a widening, or the road simply ending) yields nothing.
export function laneDropArrowPlan(
  selfN: number,
  downstream1: number,
  downstream2: number,
): { laneIndex: number; alongT: number }[] {
  if (selfN < 2) return [];
  let survivors: number;
  let positions: number[];
  if (downstream1 > 0 && downstream1 < selfN) {
    survivors = downstream1;
    positions = [0.15];
  } else if (downstream1 === selfN && downstream2 > 0 && downstream2 < selfN) {
    survivors = downstream2;
    // Evenly spaced with the narrowing tile's 0.15 arrow: continuous positions
    // 0.35, 0.75, 1.15 — equal 0.40-tile gaps across the two tiles.
    positions = [0.35, 0.75];
  } else {
    return [];
  }
  const out: { laneIndex: number; alongT: number }[] = [];
  for (let lane = survivors; lane < selfN; lane++) {
    for (const alongT of positions) out.push({ laneIndex: lane, alongT });
  }
  return out;
}

// A painted lane-closure gore (Swiss Sperrfläche): the closed area of a lane
// that ends at this tile. `triangle` is the closed polygon — used both as the
// bold solid border and as a clip for the diagonal `hatch` stripes that fill it.
export interface LaneDropGore {
  triangle: string;
  hatch: string[];
}

// The closure gore for the lanes ending in one travel direction (entry→exit) on
// a straight reducer tile. `survivors` lanes continue; lanes [survivors, selfN)
// close. The tarmac stays full width, so the closing lanes are real road painted
// as a gore: a triangle whose point sits at the OUTER kerb upstream and widens
// inward to fill the closing lanes at the downstream seam — i.e. the diverging
// line shepherds cars in toward the surviving lanes. Returned in this travel
// direction's frame (lanes on the +n side), so call it once per direction.
export function laneDropGore(
  entry: Port,
  exit: Port,
  size: number,
  survivors: number,
  selfN: number,
): LaneDropGore {
  const LANE_W = size * 0.14;
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const f = { x: dx / len, y: dy / len }; // forward (travel) unit
  const n = perpUnit(a, b); // right-of-travel unit (this direction's lanes on +n)

  const innerOff = survivors * LANE_W; // inner edge of the closing region
  const outerOff = selfN * LANE_W; // outer kerb
  const P = (along: number, off: number) => ({
    x: a.x + f.x * along + n.x * off,
    y: a.y + f.y * along + n.y * off,
  });
  const r = (v: number) => Math.round(v * 100) / 100;

  // Tip at the outer kerb upstream (A); widens to the full closing band at the
  // downstream seam (B outer, C inner).
  const A = P(0, outerOff), B = P(len, outerOff), C = P(len, innerOff);
  const triangle = `M ${r(A.x)} ${r(A.y)} L ${r(B.x)} ${r(B.y)} L ${r(C.x)} ${r(C.y)} Z`;

  // Diagonal hatch stripes (forward + inward), spaced; the view clips them to the
  // triangle. Iterate the stripe offset only across the triangle's own extent so
  // we don't emit lines that fall entirely outside it.
  const u = { x: f.x - n.x, y: f.y - n.y }; // stripe direction
  const um = Math.hypot(u.x, u.y) || 1;
  u.x /= um; u.y /= um;
  const p = { x: -u.y, y: u.x }; // perpendicular: successive stripes step along p
  const projA = 0;
  const projB = (B.x - A.x) * p.x + (B.y - A.y) * p.y;
  const projC = (C.x - A.x) * p.x + (C.y - A.y) * p.y;
  const sMin = Math.min(projA, projB, projC);
  const sMax = Math.max(projA, projB, projC);
  const spacing = LANE_W * 0.55;
  const reach = len + outerOff * 2;
  const hatch: string[] = [];
  for (let s = sMin; s <= sMax; s += spacing) {
    const c = { x: A.x + p.x * s, y: A.y + p.y * s };
    const s0 = { x: c.x - u.x * reach, y: c.y - u.y * reach };
    const s1 = { x: c.x + u.x * reach, y: c.y + u.y * reach };
    hatch.push(`M ${r(s0.x)} ${r(s0.y)} L ${r(s1.x)} ${r(s1.y)}`);
  }
  return { triangle, hatch };
}

// The outer kerb edge line of a straight road ribbon — the white line where the
// pavement meets the grass. `side` is +1 (right-of-travel) or -1 (left); the
// offset tapers from `halfA` at the entry to `halfB` at the exit, so the line
// follows a tapered tarmac edge exactly. Stroked (not filled) by the renderer.
export function roadKerbEdge(
  entry: Port,
  exit: Port,
  size: number,
  halfA: number,
  halfB: number,
  side: 1 | -1,
): string {
  return taperedParallel(entry, exit, size, side * halfA, side * halfB);
}

// The outer kerb edge line of a CURVED road ribbon — the offset Bézier at
// half-width `half` on the given side (+1 outer / right-of-travel, -1 inner).
// Matches the edge of `roadCurvePolygonPath`, so it traces exactly where the
// curved tarmac meets the grass.
export function roadCurveKerbEdge(
  entry: Port,
  exit: Port,
  size: number,
  half: number,
  side: 1 | -1,
): string {
  return curvedParallelPath(entry, exit, size, side * half);
}

// The kerb edge of a TAPERED curved ribbon (roadCurvePolygonPathTapered): the
// offset arc blends from `halfA` at the entry to `halfB` at the exit, so the
// white edge line traces exactly where the tapering tarmac meets the grass.
export function roadCurveKerbEdgeTapered(
  entry: Port,
  exit: Port,
  size: number,
  halfA: number,
  halfB: number,
  side: 1 | -1,
): string {
  return laneSegmentPathD(entry, exit, size, side * halfA, side * halfB);
}

// The port flanking a STRAIGHT road edge on the given side (+1 = right of
// entry→exit travel, -1 = left): e.g. for a Right→Left edge, +1 is Top. A
// junction uses this to decide whether a straight kerb line may be drawn on a
// side: no arm there → a real, uninterrupted kerb (a T-junction's flat side);
// an arm there → the kerb is broken by the arm's opening and is drawn by the
// corner fillets instead.
export function flankPort(entry: Port, exit: Port, side: 1 | -1): Port {
  const S = 2; // any size — the geometry is scale-free
  const a = portPoint(entry, S);
  const b = portPoint(exit, S);
  const c = portPoint(Position.Center, S);
  const n = perpUnit(a, b);
  const ports: Port[] = [Position.Top, Position.Right, Position.Bottom, Position.Left];
  let best = ports[0];
  let bestDot = -Infinity;
  for (const p of ports) {
    const q = portPoint(p, S);
    const d = ((q.x - c.x) * n.x + (q.y - c.y) * n.y) * side;
    if (d > bestDot) {
      bestDot = d;
      best = p;
    }
  }
  return best;
}

// The paved-surface polygon for a road edge whose width tapers linearly from
// `widthA` at the entry end to `widthB` at the exit end. Used by the tile
// renderer to draw a road whose width changes at a seam (a merge or a split):
// the wider of the two tiles dictates the width at the shared edge, and the
// narrower side tapers over the length of its tile. Returns a closed <path>
// d-string that is filled (not stroked) by the renderer.
export function roadSurfacePolygonPath(
  entry: Port,
  exit: Port,
  size: number,
  widthA: number,
  widthB: number,
): string {
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const n = perpUnit(a, b);
  const halfA = widthA / 2;
  const halfB = widthB / 2;
  // Four corners of the trapezoid, walked in order. The "right" side is
  // (a + n·halfA) -> (b + n·halfB); the "left" side is the return path
  // (b - n·halfB) -> (a - n·halfA). Fill is non-zero by default; the closed
  // shape renders as a solid trapezoid.
  const ax = a.x + n.x * halfA, ay = a.y + n.y * halfA;
  const bx = b.x + n.x * halfB, by = b.y + n.y * halfB;
  const cx = b.x - n.x * halfB, cy = b.y - n.y * halfB;
  const dx = a.x - n.x * halfA, dy = a.y - n.y * halfA;
  return `M ${ax} ${ay} L ${bx} ${by} L ${cx} ${cy} L ${dx} ${dy} Z`;
}

// A left-anchored road ribbon for a ONE-WAY HIGHWAY tile: the surface fills
// between a LEFT edge and a RIGHT edge whose offsets (px along +n, right of
// travel) are given independently at the entry and exit ends. One-way roads
// left-align to the run's widest count, so the left edge is a straight constant
// offset and the right edge tapers in (a lane drop) or out (a lane added) — the
// motorway look, vs the symmetric trapezoid of `roadSurfacePolygonPath`.
export function roadRibbonPolygonPath(
  entry: Port,
  exit: Port,
  size: number,
  leftA: number,
  rightA: number,
  leftB: number,
  rightB: number,
): string {
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const n = perpUnit(a, b);
  const r = (v: number) => Math.round(v * 100) / 100;
  // left edge entry→exit, then right edge exit→entry (closed).
  return (
    `M ${r(a.x + n.x * leftA)} ${r(a.y + n.y * leftA)} ` +
    `L ${r(b.x + n.x * leftB)} ${r(b.y + n.y * leftB)} ` +
    `L ${r(b.x + n.x * rightB)} ${r(b.y + n.y * rightB)} ` +
    `L ${r(a.x + n.x * rightA)} ${r(a.y + n.y * rightA)} Z`
  );
}

// A line parallel to the entry→exit centreline at offset `dA` (entry) → `dB`
// (exit) px along +n. Used for one-way kerb edges (left straight, right tapering)
// and lane dividers. Exposes the module-internal `taperedParallel`.
export function roadParallelLine(entry: Port, exit: Port, size: number, dA: number, dB: number): string {
  return taperedParallel(entry, exit, size, dA, dB);
}

// A lane-closure gore (Sperrfläche) for a ONE-WAY HIGHWAY narrowing, on the RIGHT
// (+n) side where the road sheds its outermost lane. The closed region is the
// band between the closing lane's INNER divider and the OUTER kerb; offsets are
// px along +n at each end. Where the lane has fully closed the inner and kerb
// offsets coincide and the quad degenerates to a triangle. Returns the closed
// polygon + clipped diagonal hatch, like `laneDropGore`.
export function oneWayClosingGore(
  entry: Port,
  exit: Port,
  size: number,
  innerEntry: number,
  kerbEntry: number,
  innerExit: number,
  kerbExit: number,
): LaneDropGore {
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const f = { x: dx / len, y: dy / len };
  const n = perpUnit(a, b); // +n right-of-travel; the gore sits on +n
  const P = (along: number, off: number) => ({
    x: a.x + f.x * along + n.x * off,
    y: a.y + f.y * along + n.y * off,
  });
  const r = (v: number) => Math.round(v * 100) / 100;
  const A = P(0, innerEntry), B = P(0, kerbEntry), C = P(len, kerbExit), D = P(len, innerExit);
  const triangle =
    `M ${r(A.x)} ${r(A.y)} L ${r(B.x)} ${r(B.y)} L ${r(C.x)} ${r(C.y)} L ${r(D.x)} ${r(D.y)} Z`;

  // Diagonal hatch (forward + outward), clipped to the polygon by the view.
  const u = { x: f.x + n.x, y: f.y + n.y };
  const um = Math.hypot(u.x, u.y) || 1;
  u.x /= um; u.y /= um;
  const p = { x: -u.y, y: u.x };
  const corners = [A, B, C, D];
  const projs = corners.map(c => (c.x - A.x) * p.x + (c.y - A.y) * p.y);
  const sMin = Math.min(...projs), sMax = Math.max(...projs);
  const spacing = size * 0.14 * 0.55;
  const reach = len + Math.max(kerbEntry, kerbExit) * 2 + size * 0.14;
  const hatch: string[] = [];
  for (let s = sMin; s <= sMax; s += spacing) {
    const c = { x: A.x + p.x * s, y: A.y + p.y * s };
    hatch.push(
      `M ${r(c.x - u.x * reach)} ${r(c.y - u.y * reach)} L ${r(c.x + u.x * reach)} ${r(c.y + u.y * reach)}`,
    );
  }
  return { triangle, hatch };
}

// One in-lane merge arrow for a ONE-WAY HIGHWAY closing lane: a slim open chevron
// in the closing (right) lane at offset `laneOff` px on +n, pointing forward and
// leaning toward the centreline (left, the merge direction). `alongT` (0..1) is
// the arrow midpoint along the entry→exit centreline.
export function oneWayMergeArrowPath(
  entry: Port,
  exit: Port,
  size: number,
  laneOff: number,
  alongT: number,
): MergeArrowPath {
  const LANE_W = size * 0.14;
  const HALF = size * 0.075;
  const HEAD = size * 0.05;
  const SPLAY = 0.5;
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const fx = dx / len, fy = dy / len;
  const n = perpUnit(a, b); // +n right-of-travel; closing lane is on +n
  const along0 = alongT * len;
  // Tail sits further out (+n), head leans inward (toward the centreline) so the
  // chevron points the way the closing lane merges (left).
  const tailOff = laneOff + 0.3 * LANE_W;
  const headOff = laneOff - 0.3 * LANE_W;
  const tail = { x: a.x + fx * (along0 - HALF) + n.x * tailOff, y: a.y + fy * (along0 - HALF) + n.y * tailOff };
  const head = { x: a.x + fx * (along0 + HALF) + n.x * headOff, y: a.y + fy * (along0 + HALF) + n.y * headOff };
  const ang = Math.atan2(head.y - tail.y, head.x - tail.x);
  const a1 = ang + Math.PI - SPLAY;
  const a2 = ang + Math.PI + SPLAY;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    shaft: `M ${r(tail.x)} ${r(tail.y)} L ${r(head.x)} ${r(head.y)}`,
    head:
      `M ${r(head.x + Math.cos(a1) * HEAD)} ${r(head.y + Math.sin(a1) * HEAD)} ` +
      `L ${r(head.x)} ${r(head.y)} ` +
      `L ${r(head.x + Math.cos(a2) * HEAD)} ${r(head.y + Math.sin(a2) * HEAD)}`,
  };
}

// A filled polygon for a single STRAIGHT lane's strip, used to tint one lane of
// the road (e.g. a kerb-side bus lane) without recolouring the whole ribbon. The
// strip is centred at `centreOff` px right-of-travel from the entry→exit
// centreline and is `2·half` px wide. Returns a closed d-string for a filled
// <path>. (Straight tiles only — bus-lane tinting on curves isn't needed yet.)
export function roadLaneBandPath(
  entry: Port,
  exit: Port,
  size: number,
  centreOff: number,
  half: number,
): string {
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const n = perpUnit(a, b);
  const lo = centreOff - half;
  const hi = centreOff + half;
  const ax = a.x + n.x * lo, ay = a.y + n.y * lo;
  const bx = b.x + n.x * lo, by = b.y + n.y * lo;
  const cx = b.x + n.x * hi, cy = b.y + n.y * hi;
  const dx = a.x + n.x * hi, dy = a.y + n.y * hi;
  return `M ${ax} ${ay} L ${bx} ${by} L ${cx} ${cy} L ${dx} ${dy} Z`;
}

// Lane markings for one road edge [entry, exit] with `lanesA` lanes in the
// entry→exit direction and `lanesB` lanes in the exit→entry direction.
//
// Returns a "centre" divider (solid yellow in the view) at offset 0, plus
// "inner" dividers (dashed white) between same-direction lanes. A lane
// boundary that exists on *both* ends of the edge (indices 1..min-1) is a
// straight parallel. A lane boundary that only exists on the wider end
// (indices min..max-1) is a tapered line that runs from i·LANE_W on the
// wide end down to the narrow side's kerb (lo·LANE_W), so a lane that no
// longer exists is not drawn past the seam. Curved tiles only get the
// centre marking.
//
// `capHalfA` / `capHalfB` (px) clamp the maximum marking offset at each end
// to the rendered surface half-width, so markings never escape the road when
// the surface tapers to match a narrower neighbour.
export function roadLaneMarkingPaths(
  entry: Port,
  exit: Port,
  size: number,
  lanesA: number,
  lanesB: number,
  capHalfA?: number,
  capHalfB?: number,
): LaneMarkingPath[] {
  const LANE_W = size * 0.14;
  const out: LaneMarkingPath[] = [];
  const isStraight = oppositePort(entry) === exit;

  // A one-way road carries lanes in only one direction (the other count is 0).
  // It is CENTRED in the tile and has NO yellow centre line — there is no
  // opposing stream to divide, so its same-direction lanes are split by dashed
  // white dividers only, evenly spaced about the centreline. (A bidirectional
  // road keeps the yellow centreline below as the divider between the two
  // opposing streams.) See sim/laneOffset.ts positioningBand for the matching
  // car / debug-overlay centring.
  if ((lanesA === 0) !== (lanesB === 0)) {
    const m = Math.max(lanesA, lanesB); // the single direction's lane count
    // One-way lanes are CENTRED, so divider k (between lanes k-1 and k) sits at
    // offset (band - k)·W. At a lane-count change the dividers follow the cars by
    // BAND SUBSTITUTION (see sim/laneOffset.ts): a surviving divider takes its
    // narrow-side offset (band → seamCount/2) and a dropped divider (index at or
    // beyond seamCount) sweeps out to the narrow-side kerb, closing the merging
    // lane. seamCount at each end comes from the TRUE seam half-width passed as a
    // cap (the un-floored neighbour band — NOT the min-2 paint width — so the
    // dashes meet the cyan lane lines, which use the true band). No caps (a curve
    // or a uniform straight) → the constant centred offsets, unchanged.
    const seamCountA = capHalfA !== undefined ? Math.max(1, Math.round((2 * capHalfA) / LANE_W)) : m;
    const seamCountB = capHalfB !== undefined ? Math.max(1, Math.round((2 * capHalfB) / LANE_W)) : m;
    const off = (seamCount: number, k: number) => (seamCount / 2 - Math.min(k, seamCount)) * LANE_W;
    const dropFrom = Math.min(seamCountA, seamCountB); // dividers >= this one drop
    for (let k = 1; k < m; k++) {
      out.push(
        isStraight
          ? {
              d: taperedParallel(entry, exit, size, off(seamCountA, k), off(seamCountB, k)),
              kind: "inner",
              merge: k >= dropFrom,
            }
          : { d: curvedParallelPath(entry, exit, size, (m / 2 - k) * LANE_W), kind: "inner" },
      );
    }
    return out;
  }

  // Centre divider always present (bidirectional road)
  out.push({ d: roadSegmentPathD(entry, exit, size), kind: "centre" });

  if (isStraight) {
    const lo = Math.min(lanesA, lanesB);
    const hi = Math.max(lanesA, lanesB);
    const narrowKerb = lo * LANE_W;

    // A divider is a lane-drop line (the one merging cars cross) when the lane
    // it bounds ends within this tile. Real tiles have a uniform lane count
    // (lanesA === lanesB) and taper only via the caps, so the signal is the
    // caps: on a tapering edge (capHalfA ≠ capHalfB) any divider at or beyond
    // the narrower painted half-width sits on the kerb where a lane drops. The
    // `i >= lo` term keeps it working for the cap-less unit-test calls that
    // pass lanesA ≠ lanesB directly. Lane-drop lines get a tighter dash.
    const tapered =
      capHalfA !== undefined && capHalfB !== undefined && capHalfA !== capHalfB;
    const capNarrow =
      capHalfA !== undefined && capHalfB !== undefined
        ? Math.min(capHalfA, capHalfB)
        : Infinity;
    const isMerge = (i: number) => i >= lo || (tapered && i * LANE_W >= capNarrow);

    // Between same-direction lanes on the entry→exit side (positive offset).
    for (let i = 1; i < hi; i++) {
      let fromD = i * LANE_W;
      let toD = i < lo ? i * LANE_W : narrowKerb;
      if (capHalfA !== undefined) fromD = Math.min(fromD, capHalfA);
      if (capHalfB !== undefined) toD = Math.min(toD, capHalfB);
      out.push({ d: taperedParallel(entry, exit, size, fromD, toD), kind: "inner", merge: isMerge(i) });
    }
    // Between same-direction lanes on the exit→entry side (negative offset).
    for (let i = 1; i < hi; i++) {
      let fromD = -i * LANE_W;
      let toD = i < lo ? -i * LANE_W : -narrowKerb;
      if (capHalfA !== undefined) fromD = Math.max(fromD, -capHalfA);
      if (capHalfB !== undefined) toD = Math.max(toD, -capHalfB);
      out.push({ d: taperedParallel(entry, exit, size, fromD, toD), kind: "inner", merge: isMerge(i) });
    }
  } else {
    // Curved tile (adjacent ports): add offset Bézier inner dividers for each
    // same-direction lane boundary, using the entry→exit and exit→entry sides.
    for (let i = 1; i < lanesA; i++) {
      out.push({ d: curvedParallelPath(entry, exit, size, i * LANE_W), kind: "inner" });
    }
    for (let i = 1; i < lanesB; i++) {
      out.push({ d: curvedParallelPath(entry, exit, size, -i * LANE_W), kind: "inner" });
    }
  }

  return out;
}

// A line offset by `dA` at the entry end and `dB` at the exit end, parallel
// to the entry→exit centreline in the right-hand-of-travel direction. When
// `dA === dB` this is a straight constant-offset parallel (the original
// markings behaviour); when they differ it draws a tapered line that follows
// the road's painted edge or the kerb of the narrower side.
function taperedParallel(entry: Port, exit: Port, size: number, dA: number, dB: number): string {
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const n = perpUnit(a, b);
  return `M ${a.x + n.x * dA} ${a.y + n.y * dA} L ${b.x + n.x * dB} ${b.y + n.y * dB}`;
}

// A filled road-ribbon polygon for a curved tile (adjacent ports), approximated
// by offsetting the quadratic Bézier along perpendiculars at each endpoint.
// The control point is always the tile centre (portPoint(Center, size)).
// `width` is the total road width (total lanes × LANE_W).
// Returns a closed SVG path string suitable for a filled <path>.
export function roadCurvePolygonPath(entry: Port, exit: Port, size: number, width: number): string {
  return roadCurvePolygonPathTapered(entry, exit, size, width, width);
}

// The curved road ribbon with a DIFFERENT width at each end: `widthA` at the
// entry port tapering to `widthB` at the exit port. A junction's turn edge
// needs this: each end must meet ITS arm flush (a 1-lane arm and a 2-lane arm
// on the same turn). Built on the SHARED road-turn geometry (laneRibbonPathD —
// the quarter-circle around the wrapped corner with a lateral offset), so the
// painted bend is exactly the curve the cars drive.
export function roadCurvePolygonPathTapered(
  entry: Port,
  exit: Port,
  size: number,
  widthA: number,
  widthB: number,
): string {
  return laneRibbonPathD(entry, exit, size, -widthA / 2, -widthB / 2, widthA / 2, widthB / 2);
}

// An offset quadratic Bézier path for a curved lane marking at perpendicular
// offset `d` from the centreline. Used for inner lane dividers on curved tiles.
// Positive `d` = right of travel direction; negative = left.
function curvedParallelPath(entry: Port, exit: Port, size: number, d: number): string {
  return laneSegmentPathD(entry, exit, size, d, d);
}
