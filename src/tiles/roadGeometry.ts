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
export function roadLaneMarkingPaths(
  entry: Port,
  exit: Port,
  size: number,
  lanesA: number,
  lanesB: number,
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
      const fromD = i * LANE_W;
      const toD = i < lo ? i * LANE_W : narrowKerb;
      out.push({ d: taperedParallel(entry, exit, size, fromD, toD), kind: "inner" });
    }
    // Between same-direction lanes on the exit→entry side (negative offset).
    for (let i = 1; i < hi; i++) {
      const fromD = -i * LANE_W;
      const toD = i < lo ? -i * LANE_W : -narrowKerb;
      out.push({ d: taperedParallel(entry, exit, size, fromD, toD), kind: "inner" });
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
