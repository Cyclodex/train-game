// SVG for the parking layer: the apron a row of bays sits on, the painted bay
// lines, and the mouth of a garage ramp. Tile-local px, the same frame the road
// layer paints in (`Tile.vue`'s `viewBox="0 0 tileSize tileSize"`).
//
// The split mirrors `roadGeometry.ts` vs `Tile.vue`: the maths lives here as pure
// `(row, index, size, kerb) => d-string` functions and the component only
// assembles them. Every shape is derived from `tiles/parking.ts`'s own
// `stallPose` / `stallBoxPoints`, so a painted bay and the car standing in it can
// never disagree — the same discipline that keeps the cyan debug overlay on top
// of where cars actually drive.

import { oppositePort } from "@/sim/topology";
import { portPoint, type Pt } from "@/sim/pathGeometry";
import { LANE_WIDTH_FRAC } from "@/sim/laneOffset";
import {
  type ParkingRow,
  rowSide,
  stallBoxPoints,
  stallDepthPx,
  stallPitchPx,
  stallPose,
  stallOnLane,
  garageExitFrom,
  needsBigBay,
  layByTaperPx,
} from "./parking";

const r2 = (v: number): number => Math.round(v * 100) / 100;

function poly(points: Pt[], close = true): string {
  if (points.length === 0) return "";
  return (
    "M " + points.map(p => `${r2(p.x)} ${r2(p.y)}`).join(" L ") + (close ? " Z" : "")
  );
}

// The travel frame of a row: origin at its approach port, unit vector along the
// direction of travel and unit vector toward the row's own side. Everything below
// is written in `(along, out)` — never in raw x/y and never by reading a side out
// of the sign of an offset (KNOWHOW: geometry that infers its direction from a
// magnitude breaks at zero).
export interface RowFrame {
  o: Pt;
  fx: number;
  fy: number; // along travel
  nx: number;
  ny: number; // out toward the row's side
  at(along: number, out: number): Pt;
}

export function rowFrame(row: ParkingRow, size: number): RowFrame {
  const a = portPoint(row.from, size);
  const b = portPoint(oppositePort(row.from), size);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const fx = (b.x - a.x) / len;
  const fy = (b.y - a.y) / len;
  const sign = rowSide(row) === "right" ? 1 : -1;
  // Right-of-travel in screen space (y down) is (-fy, fx).
  const nx = -fy * sign;
  const ny = fx * sign;
  return {
    o: a,
    fx,
    fy,
    nx,
    ny,
    at: (along, out) => ({ x: a.x + fx * along + nx * out, y: a.y + fy * along + ny * out }),
  };
}

// The strip of tarmac the bays stand on. Painted UNDER the road's own kerb line
// and markings so the two read as one continuous surface — the same trick
// `.road-gore-fill` uses to stop a hatched closure looking like grass.
export function parkingApronPath(
  row: ParkingRow,
  size: number,
  kerbPx: number,
): string {
  if (row.kind === "garage") return "";
  if (stallOnLane(row.kind)) return ""; // no bay, so no apron to pave
  const f = rowFrame(row, size);
  const big = needsBigBay(row.reserved);
  const pitch = stallPitchPx(row.kind, size, big);
  const depth = stallDepthPx(row.kind, size, big);
  const near = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size;
  const far = near + depth;
  // An echelon rank's apron has to cover the rake as well as the bays.
  const skew = row.kind === "angled" ? depth : 0;
  const first = stallPose(row, 0, size, kerbPx);
  const a0 = first.t * size - pitch / 2;
  const a1 = a0 + pitch * row.count;
  // A LAY-BY opens out of the kerb and closes back into it. The apron is then a
  // trapezoid, not a rectangle: its road-side edge runs the full length including
  // both tapers, while the far edge spans only the bay itself. A rank of ordinary
  // spaces has no taper (`layByTaperPx` returns 0) and this collapses back to the
  // rectangle it was.
  const taper = layByTaperPx(row, size);
  return poly([
    f.at(a0 - skew / 2 - taper, near),
    f.at(a1 - skew / 2 + taper, near),
    f.at(a1 + skew / 2, far),
    f.at(a0 + skew / 2, far),
  ]);
}

// One bay's painted outline. The dividing lines between bays are what a player
// actually reads as "parking", so each bay is drawn in full rather than as a run
// of ticks — a bay whose neighbour is occupied still reads as its own space.
export function stallOutlinePath(
  row: ParkingRow,
  index: number,
  size: number,
  kerbPx: number,
): string {
  if (row.kind === "garage") return "";
  // A HALT has no bay to outline — it is a length of kerb, and its depth is zero
  // by definition. Drawing one anyway produces a DEGENERATE box: zero long and a
  // full pitch wide, which renders as a bare line straight across the road. Its
  // yellow kerb marking and legend are what mark it (`busStopGeometry`).
  if (stallOnLane(row.kind)) return "";
  return poly(stallBoxPoints(row, index, size, kerbPx));
}

// The kerb line along the OUTER edge of an apron — where the parking strip meets
// the verge. The road's own kerb is hidden under the apron on this side, so
// without this the tarmac would bleed into the grass.
export function parkingKerbPath(
  row: ParkingRow,
  size: number,
  kerbPx: number,
): string {
  if (row.kind === "garage") return "";
  // Same for a HALT: its kerb IS the road's own, and `busStopGeometry` paints the
  // yellow marking on it. A second white line here would just double it.
  if (stallOnLane(row.kind)) return "";
  const f = rowFrame(row, size);
  const big = needsBigBay(row.reserved);
  const pitch = stallPitchPx(row.kind, size, big);
  const depth = stallDepthPx(row.kind, size, big);
  const near = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size;
  const far = near + depth;
  const skew = row.kind === "angled" ? depth : 0;
  const first = stallPose(row, 0, size, kerbPx);
  const a0 = first.t * size - pitch / 2 + skew / 2;
  const a1 = a0 + pitch * row.count;
  const taper = layByTaperPx(row, size);
  // Without a taper the kerb is just the bay's outer edge. WITH one it is the
  // whole opening — in off the road, along the back of the bay, and out again —
  // which is the line that makes a lay-by read as cut into the verge rather than
  // stuck onto it.
  if (taper <= 0) return poly([f.at(a0, far), f.at(a1, far)], false);
  return poly(
    [
      f.at(a0 - skew / 2 - taper, near),
      f.at(a0, far),
      f.at(a1, far),
      f.at(a1 - skew / 2 + taper, near),
    ],
    false,
  );
}

// --- Garage ------------------------------------------------------------------

// The ramp mouth: a short apron cut into the kerb plus the dark opening that the
// building swallows a car through. A car that drives to a bare kerb and vanishes
// reads as a despawn BUG; the ramp and the building above it are what make it
// read as a garage instead.
export interface GarageGeometry {
  apron: string; // the tarmac of the driveway
  mouth: string; // the dark opening
  arrow: string; // a chevron pointing in
  // Where the building art hangs, and which way it faces.
  centre: Pt;
  angleDeg: number;
}

// Width of a garage ramp along the kerb, as a fraction of a tile: wide enough for
// a car to swing into, narrow enough to read as a driveway and not a side street.
const RAMP_WIDTH_FRAC = 0.26;

// A garage has TWO mouths — one to go in, one to come out — so build each from
// the same primitive. `mouth` picks which; the arrow points the way traffic runs
// through it, which is what tells a player at a glance which driveway is which.
export function garageGeometry(
  row: ParkingRow,
  size: number,
  kerbPx: number,
  mouth: "in" | "out" = "in",
): GarageGeometry {
  // The out-ramp is framed on the approach the car LEAVES by, so with a separate
  // `exitTo` it sits on the far kerb facing the other way.
  const framed = mouth === "out" ? { ...row, from: garageExitFrom(row) } : row;
  const f = rowFrame(framed, size);
  const width = RAMP_WIDTH_FRAC * size;
  const depth = stallDepthPx("garage", size);
  const near = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size;
  const far = near + depth;
  const pose = stallPose(framed, 0, size, kerbPx, mouth);
  // `pose.t` already carries the mouth's position along the tile.
  const mid = pose.t * size;
  const a0 = mid - width / 2;
  const a1 = mid + width / 2;
  // The mouth narrows slightly going in, which reads as a ramp descending.
  const inset = width * 0.16;
  // The chevron points INTO the building on the in-ramp and OUT of it on the
  // out-ramp — the only thing on the tile that says which driveway is which.
  const tipOut = mouth === "in" ? near + depth * 0.52 : near + depth * 0.18;
  const baseOut = mouth === "in" ? near + depth * 0.18 : near + depth * 0.52;
  return {
    apron: poly([f.at(a0, near), f.at(a1, near), f.at(a1 - inset, far), f.at(a0 + inset, far)]),
    mouth: poly([
      f.at(a0 + inset, far - depth * 0.34),
      f.at(a1 - inset, far - depth * 0.34),
      f.at(a1 - inset, far),
      f.at(a0 + inset, far),
    ]),
    arrow: poly(
      [
        f.at(mid - width * 0.16, baseOut),
        f.at(mid, tipOut),
        f.at(mid + width * 0.16, baseOut),
      ],
      false,
    ),
    centre: { x: pose.x, y: pose.y },
    angleDeg: pose.angleDeg,
  };
}

// --- The facility sign -------------------------------------------------------

// Where a car park's "P 3/12" sign hangs on a tile: just outside the bays, at the
// leading end of the row, facing the reader. Without it "cars avoid a car park
// that is full" is a behaviour no player can ever perceive — the entire routing
// half of the feature would be invisible work.
export function parkingSignAnchor(
  row: ParkingRow,
  size: number,
  kerbPx: number,
): Pt {
  const f = rowFrame(row, size);
  const big = needsBigBay(row.reserved);
  const depth = row.kind === "garage" ? stallDepthPx("garage", size) : stallDepthPx(row.kind, size, big);
  const out = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size + depth + size * 0.055;
  return f.at(size * 0.5, out);
}

// --- Bus stops ---------------------------------------------------------------
// Two shapes, one idea. A LAY-BY is a bay off the carriageway; a HALT is a length
// of kerb the bus stops against, in lane. Both need to say "bus" at a glance, and
// neither can do it by outline alone — a lay-by is the same size and shape as a
// lorry bay, and a halt has no shape at all. So they say it the way real ones do:
// a yellow kerb marking and a shelter.

export interface BusStopGeometry {
  // The yellow kerb line the bus pulls up against, dashed the way a stopping
  // restriction is painted.
  kerbLine: string;
  // The BUS legend on the tarmac — three bars, because real lettering is
  // unreadable at this size and a glyph that cannot be read is just noise.
  legend: string[];
  // A shelter: back wall and roof, set behind the kerb on the verge.
  shelter: string;
  shelterRoof: string;
  // The pole + flag of a stop sign, for a HALT that has no bay to mark.
  sign: string;
  signFlag: string;
}

export function busStopGeometry(
  row: ParkingRow,
  size: number,
  kerbPx: number,
): BusStopGeometry {
  const f = rowFrame(row, size);
  const big = needsBigBay(row.reserved);
  const pitch = stallPitchPx(row.kind, size, big);
  const depth = stallDepthPx(row.kind, size, big);
  const near = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size;
  // A lay-by's markings sit at the FAR edge of its bay; a halt has no bay, so they
  // sit on the kerb itself.
  const mark = near + depth;
  const first = stallPose(row, 0, size, kerbPx);
  const a0 = first.t * size - pitch / 2;
  const a1 = a0 + pitch * row.count;

  // Three bars standing in for the word BUS, centred on the stop.
  const mid = (a0 + a1) / 2;
  const barLen = pitch * 0.16;
  const legend: string[] = [];
  for (const k of [-1, 0, 1]) {
    const c = mid + k * barLen * 1.9;
    const out = depth > 0 ? near + depth * 0.5 : near - LANE_WIDTH_FRAC * size * 0.45;
    legend.push(
      poly([f.at(c - barLen / 2, out), f.at(c + barLen / 2, out)], false),
    );
  }

  // The shelter, on the verge just beyond the markings.
  const shOut = mark + size * 0.02;
  const shDepth = size * 0.055;
  const shHalf = pitch * 0.3;
  const roofOver = size * 0.012;

  // The sign: a short pole at the downstream end with a flag on top.
  const poleAt = a1 - pitch * 0.14;
  const poleOut = mark + size * 0.015;
  const poleLen = size * 0.05;
  const flagHalf = size * 0.022;

  return {
    kerbLine: poly([f.at(a0, mark), f.at(a1, mark)], false),
    legend,
    shelter: poly([
      f.at(mid - shHalf, shOut),
      f.at(mid + shHalf, shOut),
      f.at(mid + shHalf, shOut + shDepth),
      f.at(mid - shHalf, shOut + shDepth),
    ]),
    shelterRoof: poly(
      [f.at(mid - shHalf - roofOver, shOut), f.at(mid + shHalf + roofOver, shOut)],
      false,
    ),
    sign: poly([f.at(poleAt, poleOut), f.at(poleAt, poleOut + poleLen)], false),
    signFlag: poly([
      f.at(poleAt - flagHalf, poleOut + poleLen),
      f.at(poleAt + flagHalf, poleOut + poleLen),
      f.at(poleAt + flagHalf, poleOut + poleLen + flagHalf * 1.4),
      f.at(poleAt - flagHalf, poleOut + poleLen + flagHalf * 1.4),
    ]),
  };
}
