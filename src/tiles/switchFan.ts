import { Position, ActiveIntersection } from "@/types";
import { Port } from "@/sim/topology";
import { armExit, partnersOf, PortPair } from "@/tiles/model";
import { portPoint, Pt } from "@/sim/pathGeometry";

// The junction switch "fan": the on-board control that says where a train
// entering by one port will leave, and lets the player throw it there.
//
// It replaced a 24x18 box of three 3px bulbs pinned to the tile edge, which was
// far too small (at a fitted zoom on a 20x14 world, ~16px of screen with 2px
// bulbs) and said nothing about direction — three identical dots, so the only
// way to learn a junction was to click and watch where the train went.
//
// TRAIN VALLEY'S ANSWER, WHICH IS THE ONE WE TOOK: the switch is not a widget
// beside the track, it is a MARKING ON the track. Each arm is drawn along the
// exact rail curve a train would take across the tile — `segmentPathD`'s
// geometry — with a big head at the edge it leaves by. So the arrow does not
// merely point the way, it IS the way; nothing has to be decoded.
//
// An earlier version drew each arm as a straight stub radiating from a hub near
// the edge. It was readable but abstract, and it needed a rotated per-entry
// frame to keep the stubs honest. Arrows on the real curve need no such trick:
// they are authored directly in tile coordinates and cannot disagree with the
// rails, because they are the same maths.

// How far inside its own tile edge an entry's hub marker sits (the point blade —
// where a fan's arms converge, and its cycle target).
export const SWITCH_INSET = 24;

// Where each arm's arrow starts and ends, as a fraction along the rail curve.
//
// Every arrow is ANCHORED AT ITS ENTRY — it starts on the edge the train comes
// from and runs toward its exit, like Train Valley's. The first version anchored
// them at the exit instead (a tail appearing mid-tile, head on the exit edge),
// and that inverts the meaning: it reads as "something arrives here", not "from
// here you go there", and on a 4-way cross nobody can tell which entry an arrow
// belongs to.
const ARROW_T_START = 0.05;
// At REST the arrow is a SHORT stub — Train Valley proportions: direction
// stated, then out of the way, each entry keeping well inside its own quadrant
// (which is what keeps an all-pairs cross readable; TV never has that case).
// An OPEN fan (the one being aimed) runs further out so the three choices
// visibly diverge, while still stopping short of the neighbours' stubs.
const ARROW_T_END_REST = 0.35;
const ARROW_T_END_OPEN = 0.65;
// Train Valley head proportions (the A1 block head): a big flat-backed triangle
// that is a large share of the whole arrow. Length along the curve and half-width
// across it, in tile px. On a very short arrow the head caps at 45% of the run so
// it always keeps a visible tail.
const HEAD_LEN = 24;
const HEAD_HALF = 12.5;
// Points sampled per arrow. A CROPPED quadratic is not expressible as a `Q` path
// without subdivision, so the shaft is emitted as a polyline; at this density the
// joins are invisible.
const ARROW_STEPS = 20;

export const ARMS: ActiveIntersection[] = [
  ActiveIntersection.Left,
  ActiveIntersection.Straight,
  ActiveIntersection.Right,
];

const round = (v: number) => Math.round(v * 100) / 100;

function quadPoint(p0: Pt, c: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
  };
}

// The arrow for one movement, laid DEAD-CENTRE on the rail a train would
// actually follow — an off-centre arrow reads as imprecision, not intent (an
// early version offset them 8px "to the right of travel" to separate the two
// directions of one arc, and it just looked misdrawn; the rest-crop already
// gives each direction its own half of the curve, so centring is safe).
//
// Both rail cases are the SAME quadratic with the tile centre as control point:
// for adjacent ports that is the curve `segmentPathD` draws, and for opposite
// ports the centre IS the midpoint, so the quadratic degenerates to exactly the
// straight line it draws. One code path covers both — do not special-case them
// apart or the two will drift. Emitted as a sampled polyline because a CROPPED
// quadratic is not expressible as the same `Q` path without subdivision.
// The A1/A3 hybrid: an A3 body — a stroked polyline bending along the exact
// rail curve, so it works at every length the reveal system produces — finished
// with A1's flat-backed triangular head (Train Valley's own silhouette). The
// SHAFT stops where the head's back begins, so the body never pokes through the
// triangle; the head is a filled polygon perpendicular to the curve there.
export function railArrow(
  entry: Port,
  exit: Port,
  size: number,
  tStart: number,
  tEnd: number
): { shaft: string; head: string } {
  const p0 = portPoint(entry, size);
  const p2 = portPoint(exit, size);
  const c = portPoint(Position.Center, size);

  // Sample the cropped curve and its running arc length.
  const pts: Pt[] = [];
  const acc: number[] = [0];
  for (let i = 0; i <= ARROW_STEPS; i++) {
    const t = tStart + ((tEnd - tStart) * i) / ARROW_STEPS;
    const p = quadPoint(p0, c, p2, t);
    if (i > 0) {
      const q = pts[i - 1];
      acc.push(acc[i - 1] + Math.hypot(p.x - q.x, p.y - q.y));
    }
    pts.push(p);
  }
  const total = acc[acc.length - 1];
  const headLen = Math.min(HEAD_LEN, total * 0.45);

  // Walk back from the tip to the head's flat back, interpolating between
  // samples so the joint lands exactly headLen up the curve.
  const backAt = total - headLen;
  let bi = acc.findIndex(a => a >= backAt);
  if (bi <= 0) bi = 1;
  const seg = acc[bi] - acc[bi - 1] || 1;
  const f = (backAt - acc[bi - 1]) / seg;
  const back: Pt = {
    x: pts[bi - 1].x + (pts[bi].x - pts[bi - 1].x) * f,
    y: pts[bi - 1].y + (pts[bi].y - pts[bi - 1].y) * f,
  };

  const tip = pts[pts.length - 1];
  // Orient the head on the chord back→tip (steadier than the point tangent on a
  // tight curve), with the flat back perpendicular to it.
  const dx = tip.x - back.x;
  const dy = tip.y - back.y;
  const dl = Math.hypot(dx, dy) || 1;
  const nx = -dy / dl;
  const ny = dx / dl;

  const shaftPts = pts.slice(0, bi).concat([back]);
  const shaft = "M" + shaftPts.map(p => `${round(p.x)} ${round(p.y)}`).join(" L");
  const head =
    `M${round(tip.x)} ${round(tip.y)} ` +
    `L${round(back.x + nx * HEAD_HALF)} ${round(back.y + ny * HEAD_HALF)} ` +
    `L${round(back.x - nx * HEAD_HALF)} ${round(back.y - ny * HEAD_HALF)} Z`;
  return { shaft, head };
}

// Where an entry's control is anchored, just inside its own edge. The PLAY view
// no longer draws anything here — the arrows start at the entry themselves, so a
// separate marker was just a strange black dot on the board (it was the old
// click-to-cycle hub, and it got asked about). The EDITOR still centres its
// authored-arm cycle zone on this point.
export function switchHubAt(entry: Port, size: number): Pt {
  const c = size / 2;
  const d = SWITCH_INSET;
  switch (entry) {
    case Position.Top:
      return { x: c, y: d };
    case Position.Right:
      return { x: size - d, y: c };
    case Position.Bottom:
      return { x: c, y: size - d };
    default:
      return { x: d, y: c }; // Left
  }
}

// True when this entry can actually reach that arm's exit on this tile — i.e.
// the arm is a real choice rather than a hole in the fan.
export function armReachable(
  connections: PortPair[],
  entry: Port,
  arm: ActiveIntersection
): boolean {
  const exit = armExit(entry, arm);
  return exit !== null && partnersOf(connections, entry).includes(exit);
}

export interface FanArm {
  arm: ActiveIntersection;
  /** The switch currently stands here. */
  on: boolean;
  /** The arrow's shaft, along the rail, in tile coordinates. */
  shaft: string;
  /** The head at the edge the train leaves by. */
  head: string;
}

// One entry's arms as drawable arrows.
//
// AT REST only the SET arm is drawn, so the board reads as "here is how every
// junction is currently routing" — one arrow per entry, and nothing else. That
// restraint is what makes this work at all: an all-pairs 4-way cross has twelve
// possible movements, and drawing them together turns the tile into an asterisk
// nobody can read (it was tried).
//
// `expanded` opens one entry's alternatives — the entry a train is arriving by,
// or the one the pointer is on. That is exactly when a player is choosing rather
// than reading, and it never opens more than one fan at a time.
export function fanArms(
  connections: PortPair[],
  entry: Port,
  size: number,
  activeArm: ActiveIntersection | undefined,
  expanded = false
): FanArm[] {
  return ARMS.filter(
    arm =>
      armReachable(connections, entry, arm) && (expanded || activeArm === arm)
  ).map(arm => ({
    arm,
    on: activeArm === arm,
    ...railArrow(
      entry,
      armExit(entry, arm)!,
      size,
      ARROW_T_START,
      expanded ? ARROW_T_END_OPEN : ARROW_T_END_REST
    ),
  }));
}

// The counter-scale applied to the arrows' STROKE widths (and their hit areas)
// on a zoomed-out board. The arrows themselves are track markings and rightly
// shrink with the board, but their weight should not — that is what made the old
// widget unusable. Below 50% zoom they thicken, capped at 1.7x.
export function switchFanScale(zoom: number): number {
  const z = zoom || 1;
  return Math.min(1.7, Math.max(1, 0.5 / z));
}
