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
