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
  // True for a SOLID (unbroken) divider — a line drivers may not cross. Used at a
  // junction for a DEDICATED turn lane (a lane that may only turn, not go
  // straight): the guide separating it from the through lanes is solid, so the
  // dashed "you may also continue straight" reading is reserved for shared lanes.
  solid?: boolean;
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

// The lateral bounds of a closure gore at both ends of a straight tile, in px
// along +n (right-of-travel) from the entry→exit centreline. `outer` is the edge
// on the CLOSING side (the kerb a bidirectional road sheds, or the centre edge a
// one-way highway sheds); `inner` is the boundary with the SURVIVING lanes. Where
// the two coincide at an end, the quad degenerates to a point — that is the
// upstream tip of a normal lane drop. Signs are the caller's: whichever side the
// lane closes on, `inner` is by definition on the survivor side of `outer`.
export interface GoreBounds {
  outerEntry: number;
  innerEntry: number;
  outerExit: number;
  innerExit: number;
}

// THE closure-gore primitive (Swiss Sperrfläche) — one implementation for both
// road types. The tarmac stays full width, so a closing lane is real road painted
// as a hatched closed area: the quad outer→inner at each end, hatched diagonally
// FORWARD + TOWARD THE SURVIVORS so the stripes lean the way cars must merge.
// The hatch side is derived from the bounds (`inner - outer` at the wide end), so
// a caller cannot get it backwards — the drift that made the one-way gore point
// the wrong way before these two were unified.
export function laneClosureGore(
  entry: Port,
  exit: Port,
  size: number,
  bounds: GoreBounds,
): LaneDropGore {
  const LANE_W = size * 0.14;
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const f = { x: dx / len, y: dy / len }; // forward (travel) unit
  const n = perpUnit(a, b); // right-of-travel unit
  const P = (along: number, off: number) => ({
    x: a.x + f.x * along + n.x * off,
    y: a.y + f.y * along + n.y * off,
  });
  const r = (v: number) => Math.round(v * 100) / 100;

  const { outerEntry, innerEntry, outerExit, innerExit } = bounds;
  // Walk the closed area: inner edge upstream → outer edge upstream → outer edge
  // downstream → inner edge downstream. A degenerate end (inner === outer) simply
  // repeats a point, which is how a lane drop's upstream tip is expressed.
  const A = P(0, innerEntry), B = P(0, outerEntry);
  const C = P(len, outerExit), D = P(len, innerExit);
  const corners = A.x === B.x && A.y === B.y ? [A, C, D] : [A, B, C, D];
  const triangle =
    corners.map((c, i) => `${i === 0 ? "M" : "L"} ${r(c.x)} ${r(c.y)}`).join(" ") + " Z";

  // Stripe direction: forward, leaning toward the survivor side. Measure at the
  // end where the band is widest so a degenerate end can't make the sign 0.
  const spread = Math.abs(innerExit - outerExit) >= Math.abs(innerEntry - outerEntry)
    ? innerExit - outerExit
    : innerEntry - outerEntry;
  const toward = Math.sign(spread) || 1;
  const u = { x: f.x + toward * n.x, y: f.y + toward * n.y };
  const um = Math.hypot(u.x, u.y) || 1;
  u.x /= um; u.y /= um;
  const p = { x: -u.y, y: u.x }; // perpendicular: successive stripes step along p
  const projs = corners.map(c => (c.x - A.x) * p.x + (c.y - A.y) * p.y);
  const sMin = Math.min(...projs), sMax = Math.max(...projs);
  const spacing = LANE_W * 0.55;
  const reach =
    len + 2 * Math.max(Math.abs(outerEntry), Math.abs(outerExit)) + LANE_W;
  const hatch: string[] = [];
  for (let s = sMin; s <= sMax; s += spacing) {
    const c = { x: A.x + p.x * s, y: A.y + p.y * s };
    hatch.push(
      `M ${r(c.x - u.x * reach)} ${r(c.y - u.y * reach)} L ${r(c.x + u.x * reach)} ${r(c.y + u.y * reach)}`,
    );
  }
  return { triangle, hatch };
}

// The closure gore for the lanes ending in one travel direction (entry→exit) on a
// BIDIRECTIONAL straight reducer tile. `survivors` lanes continue; lanes
// [survivors, selfN) close. Lanes are anchored at the centreline and grow to the
// kerb, so the closing band is the OUTER (kerb) one: a tip at the kerb upstream
// widening inward to the survivors' divider downstream. Returned in this travel
// direction's frame (lanes on the +n side), so call it once per direction.
export function laneDropGore(
  entry: Port,
  exit: Port,
  size: number,
  survivors: number,
  selfN: number,
): LaneDropGore {
  const LANE_W = size * 0.14;
  const outer = selfN * LANE_W; // outer kerb — the closing side
  const inner = survivors * LANE_W; // boundary with the surviving lanes
  return laneClosureGore(entry, exit, size, {
    outerEntry: outer,
    innerEntry: outer, // tip: the gore starts as a point on the kerb
    outerExit: outer,
    innerExit: inner,
  });
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

// A kerb-anchored road ribbon for a ONE-WAY HIGHWAY tile: the surface fills
// between a centre (left, −n) edge and a kerb (right, +n) edge whose offsets (px
// along +n, right of travel) are given independently at the entry and exit ends.
// One-way roads anchor to the kerb (index 0) at the run's widest count, so the
// kerb edge is a straight constant offset and the centre edge tapers in (a lane
// drop) or out (a lane added) — the motorway look, vs the symmetric trapezoid of
// `roadSurfacePolygonPath`. (The four offset params are plain +n distances; the
// caller decides which edge is constant — this fn is side-neutral.)
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

// One in-lane merge arrow for a ONE-WAY HIGHWAY closing lane: a slim open chevron
// in the closing lane at offset `laneOff` px on +n, pointing forward and leaning
// the way the car must move. `alongT` (0..1) is the arrow midpoint along the
// entry→exit centreline. `mergeDir` is the side the SURVIVING lanes are on,
// ±1 along n — for a kerb-anchored one-way that is always +1 (the kerb), since
// such a road sheds its centre-most lane.
//
// `mergeDir` is a REQUIRED argument on purpose. It used to be inferred as
// `Math.sign(laneOff) || 1` ("lean toward the centreline"), which silently broke
// whenever the closing lane straddled the centreline: `Math.sign(0)` is 0, the
// fallback picked the wrong side, and the arrows pointed away from the survivors.
// That is exactly the 2→1 drop on a run whose widest section is 3 lanes.
export function oneWayMergeArrowPath(
  entry: Port,
  exit: Port,
  size: number,
  laneOff: number,
  alongT: number,
  mergeDir: 1 | -1,
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
  const n = perpUnit(a, b); // +n right-of-travel
  const along0 = alongT * len;
  // The chevron leans toward the SURVIVING lanes: the head sits on the survivor
  // side of the lane centre, the tail on the closing side. Driven by the caller's
  // `mergeDir`, never by the lane's own offset — a lane centred on the centreline
  // has no sign to read.
  const tailOff = laneOff - mergeDir * 0.3 * LANE_W; // away from the survivors
  const headOff = laneOff + mergeDir * 0.3 * LANE_W; // toward the survivors
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

// --- Signalised-junction markings (stop line + per-lane signal gantry) --------
// A signalised road junction paints, on each signal-controlled approach arm:
//   • a solid white STOP LINE across the incoming lanes, near the arm's mouth;
//   • a dark GANTRY bar spanning those lanes just behind the stop line;
//   • one small signal HEAD per incoming lane, centred on the lane and facing the
//     oncoming driver (so a 3-lane arm shows three heads, not one head per arm).
// Everything is derived from the approach port, the tile size and the per-lane
// list (index + kind) so each head lands exactly where the lane's cars drive —
// the same (band − 0.5 − index)·W offset the renderer uses for the cars.

export type HeadLaneKind = "all" | "bus";

export interface JunctionSignalHead {
  cx: number;
  cy: number;
  angle: number; // travel-direction heading (deg) — rotates the head housing
  index: number;
  kind: HeadLaneKind;
}

export interface JunctionApproachSignalGeom {
  stopLine: string; // white transverse bar (stroked)
  gantry: string; // dark bar polygon (filled)
  heads: JunctionSignalHead[];
}

export function junctionApproachSignalGeom(
  port: Port,
  size: number,
  band: number,
  lanes: { index: number; kind?: HeadLaneKind }[],
): JunctionApproachSignalGeom {
  const LANE_W = size * 0.14;
  const a = portPoint(port, size);
  const c = portPoint(Position.Center, size);
  const dx = c.x - a.x, dy = c.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const f = { x: dx / len, y: dy / len }; // forward, into the junction box
  const n = perpUnit(a, c); // right-of-travel
  const r = (v: number) => Math.round(v * 100) / 100;

  const offs = lanes.map(l => (band - 0.5 - l.index) * LANE_W);
  const lo = Math.min(...offs) - 0.5 * LANE_W; // incoming side, near the centreline
  const hi = Math.max(...offs) + 0.5 * LANE_W; // incoming side, near the kerb

  // Cars are held at the ARM MOUTH (the junction-tile boundary), so the stop line
  // is painted right AT the tile edge — where the leading car's bumper waits, with
  // no gap to the border. The signal heads sit just inside, roughly where the stop
  // line used to be, so they land right at the cars. (Paint order / z-index is the
  // caller's: the line goes in the road layer under the cars, the heads above.)
  const sAlong = size * 0.015; // stop line flush at the mouth edge
  const gAlong = size * 0.05; // heads just inside, at the cars
  const sBase = { x: a.x + f.x * sAlong, y: a.y + f.y * sAlong };
  const sp0 = { x: sBase.x + n.x * lo, y: sBase.y + n.y * lo };
  const sp1 = { x: sBase.x + n.x * hi, y: sBase.y + n.y * hi };
  const stopLine = `M ${r(sp0.x)} ${r(sp0.y)} L ${r(sp1.x)} ${r(sp1.y)}`;

  // Gantry bar: a thin filled rectangle just inside the stop line, by the cars,
  // with the heads sitting on it (the white line reads in front of it).
  const gThick = size * 0.05;
  const gBase = { x: a.x + f.x * gAlong, y: a.y + f.y * gAlong };
  const corner = (o: number, t: number) => ({
    x: gBase.x + n.x * o + f.x * t,
    y: gBase.y + n.y * o + f.y * t,
  });
  const g0 = corner(lo, -gThick / 2), g1 = corner(hi, -gThick / 2);
  const g2 = corner(hi, gThick / 2), g3 = corner(lo, gThick / 2);
  const gantry =
    `M ${r(g0.x)} ${r(g0.y)} L ${r(g1.x)} ${r(g1.y)} ` +
    `L ${r(g2.x)} ${r(g2.y)} L ${r(g3.x)} ${r(g3.y)} Z`;

  const angle = (Math.atan2(f.y, f.x) * 180) / Math.PI;
  const heads: JunctionSignalHead[] = lanes.map((l, i) => ({
    cx: r(gBase.x + n.x * offs[i]),
    cy: r(gBase.y + n.y * offs[i]),
    angle: r(angle),
    index: l.index,
    kind: l.kind ?? "all",
  }));

  return { stopLine, gantry, heads };
}

// --- Per-lane direction arrows (lane-turn guidance) ---------------------------
// A car-lane direction arrow painted on a STRAIGHT road tile that approaches a
// junction, telling the driver which movements the lane ahead permits — the
// white road arrows real lanes carry ("↑", "↰", "↱", or combinations). Drawn in
// the same slim white open-chevron style as the lane-drop arrows, on the exact
// lane the cars drive (centreOff px right-of-travel). `movements` is the lane's
// permitted turn set classified relative to the travel direction (entry→exit).
// The arrow is a forward stem with one barbed head per movement.

export type LaneMove = "left" | "straight" | "right";

export function laneDirectionArrowPath(
  entry: Port,
  exit: Port,
  size: number,
  centreOff: number,
  movements: LaneMove[],
  alongT = 0.7,
): { shaft: string; heads: string[] } {
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const f = { x: dx / len, y: dy / len }; // forward (travel)
  const n = perpUnit(a, b); // right-of-travel
  const r = (v: number) => Math.round(v * 100) / 100;

  const STEM = size * 0.1; // shaft length back from the split point
  const REACH = size * 0.055; // barb reach from the split point
  const HEAD = size * 0.042; // chevron barb length
  const SPLAY = 0.62; // chevron half-angle (radians)

  // The split point: where the stem ends and the movement barbs fan out.
  const split = {
    x: a.x + f.x * (alongT * len) + n.x * centreOff,
    y: a.y + f.y * (alongT * len) + n.y * centreOff,
  };
  const tail = { x: split.x - f.x * STEM, y: split.y - f.y * STEM };
  const shaft = `M ${r(tail.x)} ${r(tail.y)} L ${r(split.x)} ${r(split.y)}`;

  // Heading unit vector per movement: straight = forward; right/left lean forward
  // and to the side so the barb reads as a turn, not a sideways stub.
  const dir = (m: LaneMove): { x: number; y: number } => {
    if (m === "straight") return f;
    const s = m === "right" ? 1 : -1;
    const vx = f.x * 0.55 + n.x * s, vy = f.y * 0.55 + n.y * s;
    const mag = Math.hypot(vx, vy) || 1;
    return { x: vx / mag, y: vy / mag };
  };

  const heads = movements.map(m => {
    const d = dir(m);
    const tip = { x: split.x + d.x * REACH, y: split.y + d.y * REACH };
    const ang = Math.atan2(d.y, d.x);
    const a1 = ang + Math.PI - SPLAY;
    const a2 = ang + Math.PI + SPLAY;
    // Branch line split→tip, then the open chevron at the tip.
    return (
      `M ${r(split.x)} ${r(split.y)} L ${r(tip.x)} ${r(tip.y)} ` +
      `M ${r(tip.x + Math.cos(a1) * HEAD)} ${r(tip.y + Math.sin(a1) * HEAD)} ` +
      `L ${r(tip.x)} ${r(tip.y)} ` +
      `L ${r(tip.x + Math.cos(a2) * HEAD)} ${r(tip.y + Math.sin(a2) * HEAD)}`
    );
  });

  return { shaft, heads };
}

// Classify a junction exit port `e` relative to a car travelling in heading
// direction `exit` (the port it leaves through): straight (same heading), a right
// turn, a left turn, or a U-turn (returns null — never a painted movement). Uses
// the screen-space cross product (y-down): a clockwise turn (cross > 0) is a
// right turn under right-hand traffic.
export function classifyMove(exit: Port, e: Port): LaneMove | null {
  const c = portPoint(Position.Center, 2);
  const h = portPoint(exit, 2);
  const t = portPoint(e, 2);
  const hx = h.x - c.x, hy = h.y - c.y;
  const tx = t.x - c.x, ty = t.y - c.y;
  const hm = Math.hypot(hx, hy) || 1, tm = Math.hypot(tx, ty) || 1;
  const dot = (hx * tx + hy * ty) / (hm * tm);
  if (dot > 0.7) return "straight";
  if (dot < -0.7) return null; // U-turn / back the way it came
  const cross = hx * ty - hy * tx;
  return cross > 0 ? "right" : "left";
}
