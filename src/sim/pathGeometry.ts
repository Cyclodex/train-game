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

// --- Lane path (centreline + lateral offset), shared by renderer and overlay ---
//
// A road vehicle drives the tile centreline pushed sideways (right-of-travel) by
// a lateral offset. Both the renderer (game.ts, positioning each car) and the
// debug overlay (Tile.vue, drawing the lane arrows) — and the road painting
// (tiles/roadGeometry.ts) — MUST follow the exact same curve, so this is the
// single source of that geometry: analytic (no DOM sampler), Vue-free, and the
// TRUE constant-distance offset (a perpendicular push of the sampled centreline),
// not a control-point-pushout Bézier approximation. The offset is interpolated
// from `offEntry` (t=0) to `offExit` (t=1), which covers both a lane that tapers
// across a seam AND a vehicle turning from a wide arm onto a narrower one: it
// glides to its exit-arm lane instead of holding the approach offset and snapping
// at the boundary.

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// Centreline point + (un-normalised) tangent at parameter t∈[0,1]: a straight
// line for opposite/Center ports, the quadratic Bézier a→centre→b for adjacent
// ports (the same curve segmentPathD draws).
function centrelineAt(
  entryPort: Port,
  exitPort: Port,
  size: number,
  t: number
): { p: Pt; tx: number; ty: number } {
  const a = portPoint(entryPort, size);
  const b = portPoint(exitPort, size);
  const isStraight =
    entryPort === Position.Center ||
    exitPort === Position.Center ||
    oppositePort(entryPort) === exitPort;
  if (isStraight) {
    return {
      p: { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) },
      tx: b.x - a.x,
      ty: b.y - a.y,
    };
  }
  const c = portPoint(Position.Center, size);
  const u = 1 - t;
  return {
    p: {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    },
    tx: 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x),
    ty: 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y),
  };
}

// The lane point at t: centreline pushed right-of-travel by lerp(offEntry,offExit).
function laneOffsetPointAt(
  entryPort: Port,
  exitPort: Port,
  size: number,
  offEntry: number,
  offExit: number,
  t: number
): Pt {
  const { p, tx, ty } = centrelineAt(entryPort, exitPort, size, t);
  const off = lerp(offEntry, offExit, t);
  if (off === 0) return p;
  // Right-of-travel unit normal: in screen space (y down) the right hand of a
  // heading (tx,ty) is (-ty, tx) — east→south, north→east.
  const mag = Math.hypot(tx, ty) || 1;
  return { x: p.x + (-ty / mag) * off, y: p.y + (tx / mag) * off };
}

// Point + travel heading (degrees) at t along the offset lane path. The heading
// is a finite difference of the OFFSET path, so a tapering/turning lane's sprite
// or arrowhead aims along the drawn curve (not the bare centreline).
export function laneSegmentPointAt(
  entryPort: Port,
  exitPort: Port,
  size: number,
  offEntry: number,
  offExit: number,
  t: number
): { x: number; y: number; tangentDeg: number } {
  const here = laneOffsetPointAt(entryPort, exitPort, size, offEntry, offExit, t);
  const eps = 1e-3;
  const pa = laneOffsetPointAt(entryPort, exitPort, size, offEntry, offExit, Math.max(0, t - eps));
  const pb = laneOffsetPointAt(entryPort, exitPort, size, offEntry, offExit, Math.min(1, t + eps));
  let dx = pb.x - pa.x;
  let dy = pb.y - pa.y;
  if (dx === 0 && dy === 0) {
    const { tx, ty } = centrelineAt(entryPort, exitPort, size, t);
    dx = tx;
    dy = ty;
  }
  return { x: here.x, y: here.y, tangentDeg: (Math.atan2(dy, dx) * 180) / Math.PI };
}

// SVG `d` polyline of the offset lane path (for the painting + the debug overlay
// shaft). A constant-offset straight collapses to a 2-point line (pixel-identical
// to the old straight markings); everything else samples the curve. Tile-local.
export function laneSegmentPathD(
  entryPort: Port,
  exitPort: Port,
  size: number,
  offEntry: number,
  offExit: number,
  samples = 24
): string {
  const isStraight =
    entryPort === Position.Center ||
    exitPort === Position.Center ||
    oppositePort(entryPort) === exitPort;
  // A straight centreline offset by a linearly-interpolated amount is itself a
  // straight segment (affine in t), so two endpoints are exact — even for a taper.
  const n = isStraight ? 1 : samples;
  const r = (v: number) => Math.round(v * 100) / 100;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const p = laneOffsetPointAt(entryPort, exitPort, size, offEntry, offExit, i / n);
    pts.push(`${r(p.x)} ${r(p.y)}`);
  }
  return "M " + pts.join(" L ");
}

// A closed ribbon polygon between two offset lane paths (offsets `offLeft` and
// `offRight`, both right-of-travel px), the exact-offset replacement for the
// k-Bézier `roadCurvePolygonPath`. Walks the right edge entry→exit, then the left
// edge exit→entry, and closes.
export function laneRibbonPathD(
  entryPort: Port,
  exitPort: Port,
  size: number,
  offLeftEntry: number,
  offLeftExit: number,
  offRightEntry: number,
  offRightExit: number,
  samples = 24
): string {
  const isStraight =
    entryPort === Position.Center ||
    exitPort === Position.Center ||
    oppositePort(entryPort) === exitPort;
  const n = isStraight ? 1 : samples;
  const r = (v: number) => Math.round(v * 100) / 100;
  const right: string[] = [];
  const left: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const pr = laneOffsetPointAt(entryPort, exitPort, size, offRightEntry, offRightExit, t);
    const pl = laneOffsetPointAt(entryPort, exitPort, size, offLeftEntry, offLeftExit, t);
    right.push(`${r(pr.x)} ${r(pr.y)}`);
    left.push(`${r(pl.x)} ${r(pl.y)}`);
  }
  left.reverse();
  return "M " + right.join(" L ") + " L " + left.join(" L ") + " Z";
}

// A small open V-chevron arrowhead at `tip`, pointing along `tangentDeg`. Matches
// the overlay's previous arrowhead so the look is unchanged.
export function arrowHeadD(
  tip: { x: number; y: number },
  tangentDeg: number,
  s = 7
): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  const rad = (tangentDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const px = -dy;
  const py = dx; // perpendicular splay
  return (
    `M${r(tip.x - dx * s + px * s * 0.55)} ${r(tip.y - dy * s + py * s * 0.55)} ` +
    `L${r(tip.x)} ${r(tip.y)} ` +
    `L${r(tip.x - dx * s - px * s * 0.55)} ${r(tip.y - dy * s - py * s * 0.55)}`
  );
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
