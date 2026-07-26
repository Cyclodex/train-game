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
  const f = rowFrame(row, size);
  const long = row.reserved === "long";
  const pitch = stallPitchPx(row.kind, size, long);
  const depth = stallDepthPx(row.kind, size, long);
  const near = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size;
  const far = near + depth;
  // An echelon rank's apron has to cover the rake as well as the bays.
  const skew = row.kind === "angled" ? depth : 0;
  const first = stallPose(row, 0, size, kerbPx);
  const a0 = first.t * size - pitch / 2;
  const a1 = a0 + pitch * row.count;
  return poly([
    f.at(a0 - skew / 2, near),
    f.at(a1 - skew / 2, near),
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
  const f = rowFrame(row, size);
  const long = row.reserved === "long";
  const pitch = stallPitchPx(row.kind, size, long);
  const depth = stallDepthPx(row.kind, size, long);
  const far = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size + depth;
  const skew = row.kind === "angled" ? depth : 0;
  const first = stallPose(row, 0, size, kerbPx);
  const a0 = first.t * size - pitch / 2 + skew / 2;
  const a1 = a0 + pitch * row.count;
  return poly([f.at(a0, far), f.at(a1, far)], false);
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

export function garageGeometry(
  row: ParkingRow,
  size: number,
  kerbPx: number,
): GarageGeometry {
  const f = rowFrame(row, size);
  const width = RAMP_WIDTH_FRAC * size;
  const depth = stallDepthPx("garage", size);
  const near = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size;
  const far = near + depth;
  const mid = size / 2;
  const a0 = mid - width / 2;
  const a1 = mid + width / 2;
  // The mouth narrows slightly going in, which reads as a ramp descending.
  const inset = width * 0.16;
  const pose = stallPose(row, 0, size, kerbPx);
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
        f.at(mid - width * 0.16, near + depth * 0.18),
        f.at(mid, near + depth * 0.52),
        f.at(mid + width * 0.16, near + depth * 0.18),
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
  const long = row.reserved === "long";
  const depth = row.kind === "garage" ? stallDepthPx("garage", size) : stallDepthPx(row.kind, size, long);
  const out = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size + depth + size * 0.055;
  return f.at(size * 0.5, out);
}
