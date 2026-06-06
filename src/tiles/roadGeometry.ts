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

// A straight line parallel to the entry→exit centreline, offset by `d` px in
// the right-hand-of-travel direction: (-dy, dx) in screen space (y-down).
// Only valid for straight (opposite-port) segments; callers must check first.
function parallelLinePath(entry: Port, exit: Port, size: number, d: number): string {
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mag = Math.hypot(dx, dy) || 1;
  // Right-hand perpendicular in screen space: (-dy, dx)
  const nx = (-dy / mag) * d;
  const ny = (dx / mag) * d;
  return `M ${a.x + nx} ${a.y + ny} L ${b.x + nx} ${b.y + ny}`;
}

export interface LaneMarkingPath {
  d: string;
  kind: "centre" | "inner";
}

// Lane markings for one road edge [entry, exit] with lanesA lanes in the
// entry→exit direction and lanesB lanes in the exit→entry direction.
//
// Always returns a "centre" divider (solid yellow in the view) at offset 0.
// For straight roads (opposite ports) with >1 lane per side, also returns
// "inner" dividers (dashed white) between same-direction lanes.
// Curved tiles only get the centre marking — parallel Bezier offsets are skipped.
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
    // Between same-direction lanes on the entry→exit side (positive offset)
    for (let i = 1; i < lanesA; i++) {
      out.push({ d: parallelLinePath(entry, exit, size, i * LANE_W), kind: "inner" });
    }
    // Between same-direction lanes on the exit→entry side (negative offset)
    for (let i = 1; i < lanesB; i++) {
      out.push({ d: parallelLinePath(entry, exit, size, -i * LANE_W), kind: "inner" });
    }
  }

  return out;
}
