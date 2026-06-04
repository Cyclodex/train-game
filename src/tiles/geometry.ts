import { Position } from "@/types";
import { Port, oppositePort } from "@/sim/topology";
import { portPoint } from "@/sim/pathGeometry";

// Two rail paths flanking the train path between two ports, each offset by
// `offset` px perpendicular to the direction of travel. Straight/Center links
// are offset lines; adjacent ports curve through the tile centre (quadratic).
export function railPathsFor(
  entry: Port,
  exit: Port,
  size: number,
  offset: number
): string[] {
  const a = portPoint(entry, size);
  const b = portPoint(exit, size);
  const c = portPoint(Position.Center, size);

  const isCenter = entry === Position.Center || exit === Position.Center;
  const isOpposite = oppositePort(entry) === exit;

  // Perpendicular unit vector to (a -> b).
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;

  if (isCenter || isOpposite) {
    const line = (s: number) =>
      `M ${a.x + px * s} ${a.y + py * s} L ${b.x + px * s} ${b.y + py * s}`;
    return [line(offset), line(-offset)];
  }

  // Curve: offset both endpoints and keep the control point at the tile centre.
  const curve = (s: number) =>
    `M ${a.x + px * s} ${a.y + py * s} Q ${c.x} ${c.y} ${b.x + px * s} ${
      b.y + py * s
    }`;
  return [curve(offset), curve(-offset)];
}
