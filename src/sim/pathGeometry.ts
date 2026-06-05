import { Position } from "@/types";
import { Port, oppositePort } from "./topology";

export interface Pt {
  x: number;
  y: number;
}

// The point on a tile's box (size x size) for each port.
export function portPoint(port: Port, size: number): Pt {
  const c = size / 2;
  switch (port) {
    case Position.Top:
      return { x: c, y: 0 };
    case Position.Right:
      return { x: size, y: c };
    case Position.Bottom:
      return { x: c, y: size };
    case Position.Left:
      return { x: 0, y: c };
    default:
      return { x: c, y: c }; // Center
  }
}

// The SVG path a train follows across one tile, from the entry port to the exit
// port, in tile-local coordinates. Opposite ports (and depot Center links) are a
// straight line; adjacent ports curve through the centre. This is the same
// geometry the tile components draw, derived purely from the two ports.
export function segmentPathD(
  entryPort: Port,
  exitPort: Port,
  size: number
): string {
  const a = portPoint(entryPort, size);
  const b = portPoint(exitPort, size);
  const c = portPoint(Position.Center, size);

  const isCenter =
    entryPort === Position.Center || exitPort === Position.Center;
  const isOpposite = oppositePort(entryPort) === exitPort;

  if (isCenter || isOpposite) {
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
}

// Numerically integrate the arc length of a quadratic Bézier a -> c -> b.
function quadLength(a: Pt, c: Pt, b: Pt, samples = 64): number {
  let len = 0;
  let prev = a;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    const p = {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    };
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

// All curve segments are the same shape (adjacent ports via the centre), so their
// length is one constant × size — memoise it (computed once for size 1).
let curveUnit: number | null = null;
function curveUnitLength(): number {
  if (curveUnit === null) {
    curveUnit = quadLength(
      portPoint(Position.Left, 1),
      portPoint(Position.Center, 1),
      portPoint(Position.Bottom, 1)
    );
  }
  return curveUnit;
}

// The true arc length of a tile segment, in the same units as `size` (a straight
// tile = size). Straights and depot-centre links are the line a->b; adjacent
// ports curve through the centre and are ~0.81× a straight. The simulation uses
// this to space coupled cars by *real* path length, so they don't bunch up (and
// overlap) on curves, where normalised per-tile progress would under-count.
export function segmentLength(
  entryPort: Port,
  exitPort: Port,
  size = 1
): number {
  if (
    entryPort === Position.Center ||
    exitPort === Position.Center ||
    oppositePort(entryPort) === exitPort
  ) {
    const a = portPoint(entryPort, size);
    const b = portPoint(exitPort, size);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  return curveUnitLength() * size;
}
