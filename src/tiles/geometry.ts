import { Position } from "@/types";
import { Port, oppositePort } from "@/sim/topology";
import { portPoint } from "@/sim/pathGeometry";

// How finely a curved rail is sampled. 24 legs is what the road layer uses for
// its offset lane lines (`laneSegmentPathD`) and is smooth well past the 200px
// native tile — the camera can zoom in and the bend still reads as a curve.
const CURVE_SAMPLES = 24;

const round2 = (v: number): number => Math.round(v * 100) / 100;

// Two rail paths flanking the train path between two ports, each offset by
// `offset` px perpendicular to the direction of travel. Straight/Center links
// are offset lines; adjacent ports curve through the tile centre (quadratic).
//
// A CURVE IS A TRUE PARALLEL OFFSET — every sample of the centreline pushed out
// along its OWN normal — never the endpoints pushed along the chord with the
// control point left at the tile centre. That older shortcut was not a parallel
// curve at all and produced two visible faults (see /test/railcurves):
//
//  · The gauge collapsed at the apex. At 200px/tile with offset 7 the rails were
//    14px apart at the ports and 7px apart mid-bend — the two rails visibly
//    converged toward one line through every curve.
//  · The track jogged at every seam. The endpoint offset was taken perpendicular
//    to the CHORD, so on a Left↔Bottom curve a rail began at (−4.95, 104.95)
//    while the abutting straight put its own at (0, 107) — ~5px sideways, and
//    outside the tile.
//
// This is the same rule the road layer already follows for a constant-width
// curve (`pathGeometry.ts laneOffsetPointAt`): offset the SAMPLED centreline,
// never the Bézier control point.
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

  if (isCenter || isOpposite) {
    // A straight offset by a constant is itself straight, so two endpoints are
    // exact — and the chord normal IS the travel normal here.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const line = (s: number) =>
      `M ${a.x + px * s} ${a.y + py * s} L ${b.x + px * s} ${b.y + py * s}`;
    return [line(offset), line(-offset)];
  }

  // Curve: the quadratic a -> c -> b, sampled, each point pushed `s` along the
  // unit normal of the tangent AT THAT POINT. At t=0 the tangent is 2(c−a) —
  // the travel direction through the entry port — so the rail lands exactly on
  // the port ± offset, flush with whatever the neighbour draws; the separation
  // between the two rails is 2·offset at every t by construction.
  const railPointAt = (s: number, t: number): { x: number; y: number } => {
    const u = 1 - t;
    const x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
    const y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
    const tx = 2 * (u * (c.x - a.x) + t * (b.x - c.x));
    const ty = 2 * (u * (c.y - a.y) + t * (b.y - c.y));
    const m = Math.hypot(tx, ty) || 1;
    return { x: x + (-ty / m) * s, y: y + (tx / m) * s };
  };

  const curve = (s: number): string => {
    const pts: string[] = [];
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const p = railPointAt(s, i / CURVE_SAMPLES);
      pts.push(`${round2(p.x)} ${round2(p.y)}`);
    }
    return "M " + pts.join(" L ");
  };
  return [curve(offset), curve(-offset)];
}
