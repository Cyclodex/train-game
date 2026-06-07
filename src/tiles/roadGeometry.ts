import { Position } from "@/types";
import { Port, oppositePort } from "@/sim/topology";
import { segmentPathD, portPoint } from "@/sim/pathGeometry";

// Road rendering is the sibling of tiles/geometry.ts (rail): both derive their
// SVG from a cell's port pairs. A road carries no two flanking rails — it is a
// single paved ribbon — so the surface is just the centreline a car drives along
// (the same geometry trains follow, segmentPathD), stroked wide by the renderer.

// The paved-surface path for a road pair: a straight line for opposite/Center
// links, a quadratic through the tile centre for adjacent ports. Stroke it wide.
export function roadSurfacePath(entry: Port, exit: Port, size: number): string {
  return segmentPathD(entry, exit, size);
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

  // Centre divider always present
  out.push({ d: segmentPathD(entry, exit, size), kind: "centre" });

  if (oppositePort(entry) === exit) {
    const lo = Math.min(lanesA, lanesB);
    const hi = Math.max(lanesA, lanesB);
    const narrowKerb = lo * LANE_W;

    // Between same-direction lanes on the entry→exit side (positive offset).
    for (let i = 1; i < hi; i++) {
      let fromD = i * LANE_W;
      let toD = i < lo ? i * LANE_W : narrowKerb;
      if (capHalfA !== undefined) fromD = Math.min(fromD, capHalfA);
      if (capHalfB !== undefined) toD = Math.min(toD, capHalfB);
      out.push({ d: taperedParallel(entry, exit, size, fromD, toD), kind: "inner" });
    }
    // Between same-direction lanes on the exit→entry side (negative offset).
    for (let i = 1; i < hi; i++) {
      let fromD = -i * LANE_W;
      let toD = i < lo ? -i * LANE_W : -narrowKerb;
      if (capHalfA !== undefined) fromD = Math.max(fromD, -capHalfA);
      if (capHalfB !== undefined) toD = Math.max(toD, -capHalfB);
      out.push({ d: taperedParallel(entry, exit, size, fromD, toD), kind: "inner" });
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
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const c = portPoint(Position.Center, size);
  const halfW = width / 2;

  // Unit right-hand perpendiculars at t=0 (entry tangent: a→c) and t=1 (exit tangent: c→b).
  const nA = perpUnit(a, c);
  const nB = perpUnit(c, b);
  // Average direction for the Bézier control-point offset, then normalize.
  const avgX = nA.x + nB.x;
  const avgY = nA.y + nB.y;
  const avgMag = Math.hypot(avgX, avgY) || 1;
  const nC = { x: avgX / avgMag, y: avgY / avgMag };

  // Outer edge: offset by +halfW (right side of travel).
  const ax = a.x + nA.x * halfW, ay = a.y + nA.y * halfW;
  const cx1 = c.x + nC.x * halfW, cy1 = c.y + nC.y * halfW;
  const bx1 = b.x + nB.x * halfW, by1 = b.y + nB.y * halfW;
  // Inner edge: offset by -halfW (left side of travel), traversed in reverse.
  const bx2 = b.x - nB.x * halfW, by2 = b.y - nB.y * halfW;
  const cx2 = c.x - nC.x * halfW, cy2 = c.y - nC.y * halfW;
  const ax2 = a.x - nA.x * halfW, ay2 = a.y - nA.y * halfW;

  return (
    `M ${ax} ${ay} ` +
    `Q ${cx1} ${cy1} ${bx1} ${by1} ` +
    `L ${bx2} ${by2} ` +
    `Q ${cx2} ${cy2} ${ax2} ${ay2} ` +
    `Z`
  );
}

// An offset quadratic Bézier path for a curved lane marking at perpendicular
// offset `d` from the centreline. Used for inner lane dividers on curved tiles.
// Positive `d` = right of travel direction; negative = left.
function curvedParallelPath(entry: Port, exit: Port, size: number, d: number): string {
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const c = portPoint(Position.Center, size);

  const nA = perpUnit(a, c);
  const nB = perpUnit(c, b);
  const avgX = nA.x + nB.x;
  const avgY = nA.y + nB.y;
  const avgMag = Math.hypot(avgX, avgY) || 1;
  const nC = { x: avgX / avgMag, y: avgY / avgMag };

  const ax = a.x + nA.x * d, ay = a.y + nA.y * d;
  const cx = c.x + nC.x * d, cy = c.y + nC.y * d;
  const bx = b.x + nB.x * d, by = b.y + nB.y * d;

  return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
}
