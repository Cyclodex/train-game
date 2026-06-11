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

// --- Road turn geometry: a circular arc around the wrapped tile corner -------
//
// RAIL curves sweep through the tile centre (the quadratic above) — right for
// trains. A ROAD turn between adjacent arms is different: a real street corner
// is a 90° arc centred on the TILE CORNER the turn wraps, tangent to both
// streets exactly at the port edges. The centre-quad version bulged into the
// junction box (every turn looked like it dipped toward the middle); the
// corner-centred arc is the "perfect curve from one street to the other".

// The tile corner shared by two adjacent ports — the corner a road turn wraps.
// (a + b − centre works for every adjacent pair: Top+Right → the NE corner.)
export function turnCornerPoint(a: Port, b: Port, size: number): Pt {
  const pa = portPoint(a, size);
  const pb = portPoint(b, size);
  const c = portPoint(Position.Center, size);
  return { x: pa.x + pb.x - c.x, y: pa.y + pb.y - c.y };
}

// The SVG path a ROAD vehicle follows across one tile: a straight line for
// opposite/Center ports (same as segmentPathD), a quarter-CIRCLE around the
// wrapped corner for adjacent ports (radius size/2, exact `A` arc — tangent to
// both arms at the port edges). The rail path (segmentPathD) keeps its quad.
export function roadSegmentPathD(entryPort: Port, exitPort: Port, size: number): string {
  const a = portPoint(entryPort, size);
  const b = portPoint(exitPort, size);
  const isCenter = entryPort === Position.Center || exitPort === Position.Center;
  if (isCenter || oppositePort(entryPort) === exitPort) {
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }
  const k = turnCornerPoint(entryPort, exitPort, size);
  const r = size / 2;
  // SVG sweep flag: 1 = clockwise in screen coords (y down). The arc bends the
  // way the corner lies: cross of (a−k)×(b−k) gives the orientation.
  const cross = (a.x - k.x) * (b.y - k.y) - (a.y - k.y) * (b.x - k.x);
  const sweep = cross > 0 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 0 ${sweep} ${b.x} ${b.y}`;
}

// The true arc length of a ROAD tile segment (same units as size): straights
// are the chord; an adjacent-port turn is the quarter-circle around the corner,
// (π/2)·(size/2). The rail version (segmentLength) keeps the quad's length.
export function roadSegmentLength(entryPort: Port, exitPort: Port, size = 1): number {
  if (
    entryPort === Position.Center ||
    exitPort === Position.Center ||
    oppositePort(entryPort) === exitPort
  ) {
    const a = portPoint(entryPort, size);
    const b = portPoint(exitPort, size);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  return (Math.PI / 2) * (size / 2);
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

// --- Turn lane path: the corner FILLET of the two offset lane lines ----------
//
// A turning lane's path used to be the port-to-port quarter-arc pushed sideways
// by lerp(offEntry, offExit, t). With EQUAL offsets that is a clean concentric
// arc, but with UNEQUAL ones (any turn between arms of different lane counts)
// the linear drift breaks the tangent at both ends: the path leaves the entry
// road at an angle — a visible kink right at the seam — and spirals to the
// exit. That was the "strange bend" on every mixed-width junction, while
// equal-arm junctions looked fine.
//
// A real turn is the corner fillet of the two LANE LINES: follow the entry
// lane line straight, take the largest constant-radius arc tangent to both
// lane lines, then follow the exit lane line straight to the seam — exactly
// how a driver corners between two streets. It is tangent-continuous at the
// entry seam, around the arc, and at the exit seam, for ANY offset pair. With
// equal offsets the straight legs collapse to zero and the arc IS the old
// concentric arc, so equal-arm turns are pixel-identical.
interface TurnLaneFrame {
  a2: Pt; // entry seam point on the lane line
  tE: Pt; // entry travel direction (unit)
  tX: Pt; // exit travel direction (unit)
  tp2: Pt; // arc end on the exit lane line
  centre: Pt; // fillet arc centre
  rf: number; // fillet radius
  angA: number; // arc start angle (at tp1, from centre)
  turn: number; // +1 right turn, −1 left (also the arc sweep sign)
  lenIn: number; // straight leg on the entry lane line
  lenArc: number; // quarter-arc length, rf·π/2
  lenOut: number; // straight leg on the exit lane line
  total: number;
}

function turnLaneFrame(
  entryPort: Port,
  exitPort: Port,
  size: number,
  offEntry: number,
  offExit: number
): TurnLaneFrame | null {
  const a = portPoint(entryPort, size);
  const b = portPoint(exitPort, size);
  const c = size / 2;
  // Unit travel directions: in via the entry port (toward the centre), out via
  // the exit port (away from the centre). Port points sit mid-edge, so these
  // are axis-aligned units.
  const tE = { x: (c - a.x) / c, y: (c - a.y) / c };
  const tX = { x: (b.x - c) / c, y: (b.y - c) / c };
  // Right-of-travel normals (screen coords, y down): right of (tx,ty) is (-ty,tx).
  const nE = { x: -tE.y, y: tE.x };
  const nX = { x: -tX.y, y: tX.x };
  const a2 = { x: a.x + nE.x * offEntry, y: a.y + nE.y * offEntry };
  const b2 = { x: b.x + nX.x * offExit, y: b.y + nX.y * offExit };
  // The lane lines are perpendicular; their corner P lies `s` along the entry
  // line from a2 and `u` back along the exit line from b2.
  const dx = b2.x - a2.x;
  const dy = b2.y - a2.y;
  const s = dx * tE.x + dy * tE.y;
  const u = dx * tX.x + dy * tX.y;
  if (s <= 1e-6 || u <= 1e-6) return null; // degenerate offsets: caller falls back
  const rf = Math.min(s, u);
  const lenIn = s - rf;
  const lenOut = u - rf;
  const lenArc = (Math.PI / 2) * rf;
  const tp1 = { x: a2.x + tE.x * lenIn, y: a2.y + tE.y * lenIn };
  const tp2 = { x: b2.x - tX.x * lenOut, y: b2.y - tX.y * lenOut };
  const turn = Math.sign(tE.x * tX.y - tE.y * tX.x) || 1;
  const centre = { x: tp1.x + nE.x * rf * turn, y: tp1.y + nE.y * rf * turn };
  const angA = Math.atan2(tp1.y - centre.y, tp1.x - centre.x);
  return { a2, tE, tX, tp2, centre, rf, angA, turn, lenIn, lenArc, lenOut, total: lenIn + lenArc + lenOut };
}

// Point + exact unit tangent on the fillet path at arc-length fraction t
// (uniform speed). The tangent is analytic per piece — entry direction, arc
// derivative, exit direction — so a vehicle or arrowhead at a seam aims
// EXACTLY along the road it is joining (no finite-difference wobble).
function turnLanePointAt(f: TurnLaneFrame, t: number): { p: Pt; tx: number; ty: number } {
  const d = t * f.total;
  if (d <= f.lenIn) {
    return { p: { x: f.a2.x + f.tE.x * d, y: f.a2.y + f.tE.y * d }, tx: f.tE.x, ty: f.tE.y };
  }
  if (d <= f.lenIn + f.lenArc) {
    const ang = f.angA + (f.turn * (d - f.lenIn)) / f.rf;
    return {
      p: { x: f.centre.x + f.rf * Math.cos(ang), y: f.centre.y + f.rf * Math.sin(ang) },
      tx: -Math.sin(ang) * f.turn,
      ty: Math.cos(ang) * f.turn,
    };
  }
  const d2 = d - f.lenIn - f.lenArc;
  return { p: { x: f.tp2.x + f.tX.x * d2, y: f.tp2.y + f.tX.y * d2 }, tx: f.tX.x, ty: f.tX.y };
}

// Centreline point + (un-normalised) tangent at parameter t∈[0,1]: a straight
// line for opposite/Center ports, the quarter-CIRCLE around the wrapped tile
// corner for adjacent ports (the same curve roadSegmentPathD draws — a road
// turn, not the rail quad). A circle's parameter is proportional to arc length,
// so this t matches the renderer's arc-length DOM sampler exactly.
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
  const k = turnCornerPoint(entryPort, exitPort, size);
  const r = size / 2;
  const angA = Math.atan2(a.y - k.y, a.x - k.x);
  // Signed sweep to the exit angle: adjacent ports are always ±90° apart around
  // their shared corner, oriented by the cross product (screen coords, y down).
  const cross = (a.x - k.x) * (b.y - k.y) - (a.y - k.y) * (b.x - k.x);
  const delta = cross > 0 ? Math.PI / 2 : -Math.PI / 2;
  const ang = angA + delta * t;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  return {
    p: { x: k.x + r * cos, y: k.y + r * sin },
    // Tangent = d/dt of the arc point: r·delta·(−sin, cos).
    tx: -sin * delta,
    ty: cos * delta,
  };
}

// The lane point at t. Straights (and Center links) are the centreline pushed
// right-of-travel by lerp(offEntry, offExit) — exact, since an affine offset of
// a straight line is itself straight. TURNS (adjacent ports) follow the corner
// fillet of the two lane lines (turnLaneFrame above): tangent-continuous at
// both seams for any offset pair, identical to the old concentric arc when
// offEntry === offExit. The pre-fillet lerp remains only as a fallback for
// degenerate offsets (a lane line at or beyond the corner point).
function laneOffsetPointAt(
  entryPort: Port,
  exitPort: Port,
  size: number,
  offEntry: number,
  offExit: number,
  t: number
): Pt {
  const isTurn =
    entryPort !== Position.Center &&
    exitPort !== Position.Center &&
    oppositePort(entryPort) !== exitPort;
  if (isTurn) {
    const f = turnLaneFrame(entryPort, exitPort, size, offEntry, offExit);
    if (f) return turnLanePointAt(f, t).p;
  }
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
  const isTurn =
    entryPort !== Position.Center &&
    exitPort !== Position.Center &&
    oppositePort(entryPort) !== exitPort;
  if (isTurn) {
    // Fillet turns carry an exact analytic tangent per piece, so a sprite or
    // arrowhead at a seam aims precisely along the road it joins.
    const f = turnLaneFrame(entryPort, exitPort, size, offEntry, offExit);
    if (f) {
      const { p, tx, ty } = turnLanePointAt(f, t);
      return { x: p.x, y: p.y, tangentDeg: (Math.atan2(ty, tx) * 180) / Math.PI };
    }
  }
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
