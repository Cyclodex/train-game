// The PARKING layer — the fourth axis of the tile model.
//
// `connections` say what RAIL crosses a cell, `road` what STREET crosses it and
// `terrain` what the cell IS. `parking` says where a road vehicle may STOP on it.
//
// THE UNIFICATION that makes this small: a surface car park's AISLE is just an
// ordinary one- or two-way `road: Lane[]` run, so the existing router and car sim
// drive the rows of a car park for free — no second graph, no second follower
// model. What is left is one primitive:
//
//     a ROW of stalls attached to one road APPROACH of one tile, on one side.
//
// A kerbside bay on a wide street and a 90° bay off a car-park aisle are the SAME
// thing with different paint. An underground garage is the same thing again with
// its stalls HIDDEN inside the building: the car glides into the ramp mouth and
// disappears, and `count` is simply the building's capacity.
//
// Everything else — a stall's rectangle, the pull-in curve a car drives, a
// facility's capacity — is DERIVED here, so the sim and the renderer share one
// source of truth exactly as they do for lanes (`tiles/lanes.ts`).

import type { Coordinates } from "@/types";
import { rotatePort, type Port, type TileCell, type Level } from "./model";
import {
  laneCountAt,
  roadSeamPaintTotal,
  isRoadJunction,
  isOneWayStraight,
  oneWayRunMax,
  exitsFrom,
} from "./lanes";
import { LANE_WIDTH_FRAC } from "@/sim/laneOffset";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { portPoint, laneSegmentPointAt, type Pt } from "@/sim/pathGeometry";
import { getCoordinatesId } from "@/utils/tileHelpers";

// --- Data --------------------------------------------------------------------

// How a stall is laid out relative to the road that serves it.
//  • "parallel"      — the car lies ALONG the kerb (Längsparken). The wide-street
//                      case: shallow, so it still fits beside a 4-lane road.
//  • "perpendicular" — a 90° bay pointing away from the aisle. The car-park case:
//                      deep, so it only fits beside a narrow aisle or 2-lane street.
//  • "angled"        — a 45° echelon bay. Between the two on both counts, and the
//                      one that reads as a supermarket forecourt.
//  • "garage"        — no visible bay at all: a ramp mouth at the kerb leading into
//                      a building. `count` is the building's capacity and a parked
//                      car is not drawn (see `stallIsHidden`).
export type StallKind = "parallel" | "perpendicular" | "angled" | "garage";

// Who may use a row. Absent = anything that physically fits.
//  • "disabled" / "delivery" — reserved bays. v1 paints them and keeps ordinary
//    traffic out; nothing yet issues a permit, so they simply stay empty and read
//    as the real thing (a car park is never 100% usable).
//  • "long" — sized for a truck/semi/bus; short vehicles may use it too.
export type StallReservation = "disabled" | "delivery" | "long";

// A run of stalls served by one approach of one tile, on one side of it.
export interface ParkingRow {
  // The approach the row is served from: a vehicle that entered this tile through
  // `from` can pull out of its lane into these stalls. A row is only legal on a
  // STRAIGHT approach (`from` ↔ oppositePort(from)) — nobody parks in a bend or a
  // junction box, and the geometry below assumes it (see `validateParking`).
  from: Port;
  // Which side of the DIRECTION OF TRAVEL the row sits on. "right" is the kerb
  // side and the normal case. "left" is the far bank — legal only where the
  // approach carries no oncoming stream (a one-way aisle), since otherwise the
  // driver would have to cross oncoming traffic to reach it.
  side?: "right" | "left"; // default "right"
  kind: StallKind;
  count: number; // stalls in this row on THIS tile
  // How the row sits along the tile.
  //  • "pack" (default) starts the first bay at the tile's leading edge, so a row
  //    running across SEVERAL tiles reads as ONE continuous run of bays. Centring
  //    unconditionally would leave a bay-sized hole at every tile seam — the
  //    length of a car of empty kerb, repeated down the whole street.
  //  • "centre" centres the row on its tile. For a lone lay-by or a short bay
  //    group that should not look like the end of a longer run.
  align?: "pack" | "centre";
  // GARAGE ONLY. The approach a car rejoins the road on when it drives back out,
  // and therefore which bank its EXIT ramp sits on. Defaults to `from` — a single
  // ramp mouth serving both directions.
  //
  // A real underground garage has an in ramp and an out ramp, and the difference
  // is game-visible rather than cosmetic: with one mouth, departures and arrivals
  // serialise through the same barrier, so a busy garage's leavers block its
  // joiners. Two mouths let both flow at once.
  exitTo?: Port;
  // Extra clearance between the kerb and the near edge of the bays, in lane
  // widths (a pavement, a verge, a service strip). Default 0.
  gap?: number;
  reserved?: StallReservation;
}

// The parking layer of one cell.
export interface ParkingCell {
  // The facility these stalls belong to. Tiles sharing an id are ONE car park:
  // capacity, fullness and "drive to car park A" are all per facility. Absent =
  // the tile is its own facility (keyed by its coordinate id), which is what a
  // lone kerbside bay wants.
  //
  // A cell may carry ONLY this — `{ facility: "P1" }` with no rows is how an
  // AISLE tile joins a car park. That is what makes "have I driven the whole car
  // park yet?" answerable: the sim watches for the car leaving the facility's
  // tiles, and without the aisles in the set it would think so far too early.
  facility?: string;
  // Human name for signage / the HUD ("Kaufhaus P", "Bahnhof Nord").
  label?: string;
  // Seconds a car stays, drawn uniformly. Per FACILITY, not per car: a kerbside
  // bay that churns every 20 seconds beside a garage whose cars sit for two
  // minutes is what makes a street read as a street. Falls back to the sim's
  // default when absent.
  dwellSec?: [number, number];
  rows?: ParkingRow[];
}

// Where a single stall lives. Stable and derivable from the level alone, so it
// round-trips through a save and can key an occupancy map.
export interface StallRef {
  tileId: string;
  from: Port;
  side: "right" | "left";
  index: number; // 0-based within the row, counted along the direction of travel
}

export function stallId(ref: StallRef): string {
  return `${ref.tileId}|${ref.from}|${ref.side}|${ref.index}`;
}

// --- Dimensions --------------------------------------------------------------
// All in FRACTIONS OF A TILE, so they scale with `tileSize` exactly like
// LANE_WIDTH_FRAC does. At the native 200px tile a car sprite is 38x20px.

// Depth of a bay measured out from the kerb (how far it eats into the verge).
const DEPTH_FRAC: Record<StallKind, number> = {
  parallel: 0.13, // 26px — a car is 20px wide
  perpendicular: 0.24, // 48px — a car is 38px long
  // 42px = (carLength + carWidth)·sin45 = (38 + 20)·0.707. A 45° car needs less
  // depth than a 90° one, which is the other half of why echelon parking exists.
  angled: 0.21,
  garage: 0.11, // 22px — just the ramp mouth at the kerb
};

// Longitudinal PITCH of one stall along the kerb, as a fraction of a tile. This
// is what decides how many stalls fit per tile: `count` is authored, and the row
// is centred on the tile, so an over-long row simply spills past the tile edge —
// `validateParking` flags it rather than silently drawing nonsense.
const PITCH_FRAC: Record<StallKind, number> = {
  parallel: 0.3, // 60px — a 38px car plus room to get in and out
  perpendicular: 0.14, // 28px — a car is 20px wide
  // 29px. NOT the 45° diagonal of the car: in a real echelon rank the along-kerb
  // pitch is the car's WIDTH divided by sin45 (20 / 0.707 = 28px) — the cars nest
  // into each other's shadow, which is the whole point of parking at an angle.
  // Deriving it from the diagonal instead (~41px) spaces them like badly parked
  // 90° bays and wastes a third of the kerb.
  angled: 0.145,
  garage: 1, // the ramp mouth is one object, whatever the capacity
};

// A LONG bay — the lorry/coach bay. The longest single-box vehicle the sim builds
// is a rigid truck at TRUCK_LEN = 1.7 car lengths = 65px at the native tile
// (`sim/road.ts` TRUCK_LEN / BUS_LEN); this must swallow that plus room to get in
// and out. LOCKSTEP: if road.ts's vehicle table grows a longer single-box kind,
// this number moves with it — the same discipline LANE_WIDTH_FRAC lives under.
// The honest consequence is that a lorry bay eats most of a tile: at 110px pitch
// only one fits per tile. That is what a real loading bay looks like.
const LONG_FRAC = 0.55;

// Along a `parallel` bay the car lies down the kerb, so LENGTH is the pitch; in
// every other kind it noses in, so LENGTH is the depth. `stallLengthPx` is the
// dimension a vehicle's body has to fit inside, whichever that is — the single
// number `stallFits` compares against, so the "does a truck fit" question is
// never asked of the wrong axis.
export function stallDepthPx(kind: StallKind, tileSize: number, long = false): number {
  if (long && kind !== "parallel") return LONG_FRAC * tileSize;
  return DEPTH_FRAC[kind] * tileSize;
}

export function stallPitchPx(kind: StallKind, tileSize: number, long = false): number {
  if (long && kind === "parallel") return LONG_FRAC * tileSize;
  // A long 90° bay is DEEPER, not wider — it needs a touch more width too, but
  // nothing like its extra depth.
  if (long && kind !== "garage") return PITCH_FRAC[kind] * 1.35 * tileSize;
  return PITCH_FRAC[kind] * tileSize;
}

// The length of body a stall can hold, in px. A garage slot is inside a building
// — no geometry constrains it, so it takes anything that is allowed to park.
export function stallLengthPx(row: ParkingRow, tileSize: number): number {
  const long = row.reserved === "long";
  if (row.kind === "garage") return Number.POSITIVE_INFINITY;
  return row.kind === "parallel"
    ? stallPitchPx(row.kind, tileSize, long)
    : stallDepthPx(row.kind, tileSize, long);
}

// The resting angle of a parked car RELATIVE to the direction of travel, in
// degrees. 0 = nose along the road (parallel), 90 = nose into the bay.
const REST_ANGLE: Record<StallKind, number> = {
  parallel: 0,
  perpendicular: 90,
  angled: 45,
  garage: 90,
};

// A garage stall is inside the building — the car is not drawn while it holds one.
export function stallIsHidden(kind: StallKind): boolean {
  return kind === "garage";
}

// How many stalls a row of `kind` can hold on one tile before it overflows.
// A garage's capacity is abstract (the slots are inside a building), but it is
// still BOUNDED: an unbounded count would let one typo allocate a million stalls
// at module import and take the tab with it.
export const MAX_GARAGE_CAPACITY = 400;

export function maxStallsPerTile(kind: StallKind, tileSize = 200, long = false): number {
  if (kind === "garage") return MAX_GARAGE_CAPACITY;
  return Math.floor(tileSize / stallPitchPx(kind, tileSize, long) + 1e-9);
}

// --- Derivations over a cell -------------------------------------------------

export function rowSide(row: ParkingRow): "right" | "left" {
  return row.side ?? "right";
}

// Every row of a cell, normalised (side defaulted, empty rows dropped).
export function rowsOf(cell: TileCell | undefined): ParkingRow[] {
  return (cell?.parking?.rows ?? []).filter(r => r.count > 0);
}

// The facility id a cell's parking belongs to: the authored one, else the cell's
// own coordinate id (a lone bay is its own one-tile facility).
export function facilityOf(cell: TileCell | undefined, tileId: string): string | null {
  if (!cell?.parking || rowsOf(cell).length === 0) return null;
  return cell.parking.facility ?? tileId;
}

// The row a StallRef belongs to, or undefined when the ref is stale. RANGE
// CHECKED: matching on `(from, side)` alone would keep resolving a ref whose
// index no longer exists, and `stallPose` would happily place that phantom bay
// a pitch beyond the end of the row — off the tile entirely for a short row.
export function rowFor(cell: TileCell | undefined, ref: StallRef): ParkingRow | undefined {
  const row = rowsOf(cell).find(r => r.from === ref.from && rowSide(r) === ref.side);
  if (!row) return undefined;
  return ref.index >= 0 && ref.index < row.count ? row : undefined;
}

// The tile EDGE a row's bays hug — the physical bank of the street. Two rows can
// name the same bank through different approaches: on an east-west street,
// `{from: Left, side: "left"}` (northward of eastbound traffic) and
// `{from: Right, side: "right"}` (kerbward of westbound traffic) are both the
// NORTH kerb. Authoring both paints two sets of bays into the same pixels and
// counts every space twice, so `validateParking` rejects it — and this is the
// function that makes the clash visible.
export function bankOf(row: ParkingRow): Port {
  const side = rowSide(row);
  // Right-of-travel in screen space (y down) is the port one quarter-turn
  // CLOCKWISE from the direction of travel, i.e. from `from` itself: travelling
  // east (from = Left) the right hand points south (Bottom = Left + 1 turn... in
  // port order Top,Right,Bottom,Left the quarter-turn from Left is Top). Derive
  // it from the travel heading rather than by table, so it cannot drift.
  const travel = oppositePort(row.from);
  return rotatePort(travel, side === "right" ? 1 : -1);
}

// --- Geometry ----------------------------------------------------------------
// Tile-local pixel space, the same the road layer paints in (`0 0 size size`).

// The painted half-width of the road at this tile, in px — where the kerb is, and
// therefore where the bays start. Mirrors the renderer's own surface rule
// (`Tile.vue roadPaths` → `roadSeamPaintTotal`) so a bay never floats off the
// tarmac or overlaps it. `neighbourCrossing` is the neighbouring tile's
// `laneCountAt` at the shared seam (0 when there is no road neighbour).
export function kerbOffsetPx(
  cell: TileCell | undefined,
  from: Port,
  neighbourCrossing: number,
  neighbourIsJunction: boolean,
  tileSize: number,
  oneWayRun?: number,
): number {
  // A ONE-WAY road is painted differently — kerb-anchored to the widest lane
  // count along its RUN, half-width `(runMax/2)·W` (Tile.vue's one-way straight
  // branch), with no min-2 floor and no seam taper. A car-park aisle is exactly
  // that: a 1-lane one-way street, painted 14px from the centreline. Measuring it
  // with the two-way `max(laneCountAt, 2)` rule would put the kerb at 28px and
  // leave a car's width of grass between the tarmac and its own bays.
  if (oneWayRun !== undefined && oneWayRun > 0) {
    return (oneWayRun / 2) * LANE_WIDTH_FRAC * tileSize;
  }
  const selfTotal = Math.max(laneCountAt(cell?.road, from), 2);
  const total = roadSeamPaintTotal(selfTotal, neighbourCrossing, neighbourIsJunction);
  return (total / 2) * LANE_WIDTH_FRAC * tileSize;
}

// The same, resolved against a live level (the usual caller).
// The painted kerb at EACH END of the tile, [entry seam, exit seam]. A tapering
// road moves its kerb across its own length, and a row of bays sized against one
// end then has its inner half under the running lane at the other — so the
// validator needs both numbers, not their combination.
export function kerbOffsetEnds(
  level: Level,
  coord: Coordinates,
  from: Port,
  tileSize: number,
): [number, number] {
  const cell = level[getCoordinatesId(coord)];
  if (isOneWayStraight(cell?.road, from)) {
    const run = oneWayRunMax(c => level[getCoordinatesId(c)]?.road, coord, from);
    const off = kerbOffsetPx(cell, from, 0, false, tileSize, run);
    return [off, off]; // one-way is run-constant: it never seam-tapers
  }
  const ends: number[] = [];
  for (const port of [from, oppositePort(from)] as Port[]) {
    const nb = neighborCoord(coord, port);
    const nbCell = nb ? level[getCoordinatesId(nb)] : undefined;
    const crossing = nbCell ? laneCountAt(nbCell.road, oppositePort(port)) : 0;
    ends.push(kerbOffsetPx(cell, from, crossing, isRoadJunction(nbCell?.road), tileSize));
  }
  return [ends[0], ends[1]];
}

export function kerbOffsetAt(
  level: Level,
  coord: Coordinates,
  from: Port,
  tileSize: number,
): number {
  const cell = level[getCoordinatesId(coord)];
  if (isOneWayStraight(cell?.road, from)) {
    const run = oneWayRunMax(c => level[getCoordinatesId(c)]?.road, coord, from);
    return kerbOffsetPx(cell, from, 0, false, tileSize, run);
  }
  // A row runs along the travel axis, so both seams matter; take the WIDER of the
  // two painted ends. A tapering tile moves the kerb across its own length, and a
  // bay placed at the narrow end would have its inner half UNDER the running lane
  // at the wide end. Erring outward leaves a sliver of grass instead, which reads
  // as a verge — `validateParking` rejects the taper outright anyway, so this is
  // only the safe behaviour for the case that slips through.
  const exit = oppositePort(from);
  let widest = 0;
  for (const port of [from, exit] as Port[]) {
    const nb = neighborCoord(coord, port);
    const nbCell = nb ? level[getCoordinatesId(nb)] : undefined;
    const crossing = nbCell ? laneCountAt(nbCell.road, oppositePort(port)) : 0;
    widest = Math.max(
      widest,
      kerbOffsetPx(cell, from, crossing, isRoadJunction(nbCell?.road), tileSize),
    );
  }
  return widest > 0 ? widest : kerbOffsetPx(cell, from, 0, false, tileSize);
}

// The pose of one stall in tile-local px: the centre of the parked car's body and
// the angle it rests at (degrees, 0 = pointing +x / east).
//
// The row is CENTRED on the tile along the direction of travel, so an author who
// writes `count: 3` gets three evenly-spread bays without doing arithmetic, and a
// row that is too long for its tile spills symmetrically (and is flagged by
// `validateParking`) rather than piling up at one end.
export interface StallPose {
  x: number;
  y: number;
  angleDeg: number;
  // The stall's own longitudinal position along the approach, 0..1 — where on the
  // tile a car draws level with it. The sim stops the car here before it turns in.
  t: number;
  depthPx: number;
  pitchPx: number;
}

// Where along a garage tile its two ramp mouths sit, as a fraction of the tile.
// Far enough apart to read as two driveways, close enough that both stay clear of
// the tile's seams (and of a junction beyond one).
export const GARAGE_IN_T = 0.34;
export const GARAGE_OUT_T = 0.68;

export function stallPose(
  row: ParkingRow,
  index: number,
  size: number,
  kerbPx: number,
  // Which mouth of a GARAGE this is. Ignored for a rank of bays, which has one
  // position per stall index and no notion of a direction.
  mouth: "in" | "out" = "in",
): StallPose {
  const from = row.from;
  const exit = oppositePort(from);
  const a = portPoint(from, size);
  const b = portPoint(exit, size);
  // Direction of travel across the tile, and the unit right-of-travel normal.
  // Screen space has y DOWN, so the right hand of a heading (dx,dy) is (-dy,dx)
  // — the same rule `laneOffsetPointAt` uses. Never re-derive this from the sign
  // of an offset (KNOWHOW: geometry that reads its own side out of a magnitude
  // breaks at zero).
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const dx = (b.x - a.x) / len;
  const dy = (b.y - a.y) / len;
  const rx = -dy;
  const ry = dx;
  const sideSign = rowSide(row) === "right" ? 1 : -1;

  const long = row.reserved === "long";
  const pitch = stallPitchPx(row.kind, size, long);
  const depth = stallDepthPx(row.kind, size, long);
  // Where the row starts along the tile. "pack" (the default) begins at the
  // leading edge so consecutive tiles form one continuous run of bays; "centre"
  // centres the row for a lone lay-by. A garage's mouth is always mid-tile.
  const span = row.kind === "garage" ? 0 : pitch * row.count;
  const start = row.align === "centre" ? (size - span) / 2 : 0;
  // A GARAGE has no rank of bays: it has a RAMP MOUTH, and one for each direction
  // of travel it serves. The in-ramp sits upstream and the out-ramp downstream, so
  // a car drives in at the first driveway and comes out of the second FACING THE
  // WAY IT IS GOING — never nose-first backwards out of the entrance.
  const along =
    row.kind === "garage"
      ? size * (mouth === "out" ? GARAGE_OUT_T : GARAGE_IN_T)
      : start + pitch * (index + 0.5);
  const t = along / size;

  // Lateral: out past the kerb, plus any authored verge, to the middle of the bay.
  const lateral = sideSign * (kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size + depth / 2);

  const travelDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Nose INTO the bay: the rest angle turns from the travel heading toward the
  // side the bay is on, so a "left" row's cars point the other way — which is
  // what makes both banks of an aisle read correctly.
  const angleDeg = travelDeg + sideSign * REST_ANGLE[row.kind];

  return {
    x: a.x + dx * along + rx * lateral,
    y: a.y + dy * along + ry * lateral,
    angleDeg,
    t,
    depthPx: depth,
    pitchPx: pitch,
  };
}

// The four corners of a stall's painted box, tile-local px. Drawn by the renderer
// as the bay markings; also the honest answer to "does this bay fit on the tile".
export function stallBoxPoints(
  row: ParkingRow,
  index: number,
  size: number,
  kerbPx: number,
): Pt[] {
  const pose = stallPose(row, index, size, kerbPx);
  // An ECHELON bay is a PARALLELOGRAM, not a rotated rectangle: its kerb-side
  // edge runs ALONG the road (that is what a painted 45° bay looks like), and
  // only the side lines are raked. Rotating a pitch x depth rectangle by 45°
  // instead swells its extent along the kerb to (pitch+depth)/√2, so consecutive
  // bays overlap each other by ~18px and the leading corner of each one lands on
  // the tarmac. Shear it.
  if (row.kind === "angled") return shearedBoxPoints(row, index, size, kerbPx, pose);
  const rad = (pose.angleDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const vx = -uy;
  const vy = ux;
  // A bay is as long as the car it holds and as wide as its pitch, expressed in
  // the BAY's own frame: "along the car" is the depth for a 90° bay and the pitch
  // for a parallel one, which falls out of the rest angle automatically.
  const alongCar = row.kind === "parallel" ? pose.pitchPx : pose.depthPx;
  const acrossCar = row.kind === "parallel" ? pose.depthPx : pose.pitchPx;
  const hl = alongCar / 2;
  const hw = acrossCar / 2;
  return [
    { x: pose.x + ux * hl + vx * hw, y: pose.y + uy * hl + vy * hw },
    { x: pose.x + ux * hl - vx * hw, y: pose.y + uy * hl - vy * hw },
    { x: pose.x - ux * hl - vx * hw, y: pose.y - uy * hl - vy * hw },
    { x: pose.x - ux * hl + vx * hw, y: pose.y - uy * hl + vy * hw },
  ];
}

// The parallelogram of a 45° echelon bay: kerb edge along the road, side lines
// raked back by the bay's own depth so the ranks nest. Shares `stallPose`'s frame
// so the painted bay and the car standing in it can never disagree.
function shearedBoxPoints(
  row: ParkingRow,
  index: number,
  size: number,
  kerbPx: number,
  pose: StallPose,
): Pt[] {
  const from = row.from;
  const a = portPoint(from, size);
  const b = portPoint(oppositePort(from), size);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const dx = (b.x - a.x) / len;
  const dy = (b.y - a.y) / len;
  const sideSign = rowSide(row) === "right" ? 1 : -1;
  const rx = -dy * sideSign;
  const ry = dx * sideSign;
  const near = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size;
  const far = near + pose.depthPx;
  // The bay leans FORWARD, along the direction of travel: you reach a 45° bay by
  // turning TOWARD its side, so the car ends up nose-deep and further down the
  // road than its tail. The rake must follow the car, not oppose it — `REST_ANGLE`
  // turns the same way (travelDeg + sideSign·45), and paint that leant the other
  // way would put every car across its own bay lines.
  const skew = pose.depthPx;
  // Centre the parallelogram on the pose, so the bay's centroid and the car
  // standing in it are the same point (shift the kerb edge back by half the rake
  // and the far edge forward by half).
  const along0 = pose.t * size - pose.pitchPx / 2;
  const P = (u: number, v: number): Pt => ({
    x: a.x + dx * u + rx * v,
    y: a.y + dy * u + ry * v,
  });
  return [
    P(along0 - skew / 2, near),
    P(along0 + pose.pitchPx - skew / 2, near),
    P(along0 + pose.pitchPx + skew / 2, far),
    P(along0 + skew / 2, far),
  ];
}

// --- The parking manoeuvre ---------------------------------------------------
// A quadratic Bézier from the car's lane to the stall. The control point is the
// point on the LANE abeam the stall, so the car noses forward and swings in
// instead of sliding sideways — a real pull-in, and a real pull-out when driven
// the other way. One curve serves both directions and both the sim (arc length)
// and the renderer (position + angle), exactly as `laneSegmentPointAt` does for
// the road itself.

// WHY A BÉZIER AND NOT `turnLaneFrame`'s CORNER FILLET: the fillet is the canon
// for a road turn and is arc-length uniform by construction — but its algebra is
// a 90°-ONLY special case (tangent length == rf because the two lane lines are
// perpendicular). Of the four stall kinds only "perpendicular" turns 90°;
// "parallel" turns 0° (the fillet degenerates — `tE × tX == 0`) and "angled"
// turns 45°. One curve that serves all four beats three code paths, so the
// Bézier stays and the arc-length property is restored explicitly by the sample
// table below. Never drive `m` as a raw Bézier parameter: it is NOT proportional
// to distance, and a car would visibly surge through the middle of the swing.
export interface ManoeuvrePath {
  p0: Pt; // on the lane, BEHIND the stall (where the car halts)
  p1: Pt; // on the lane, abeam the stall (the control point)
  p2: Pt; // the stall pose
  restAngleDeg: number;
  // Cumulative arc length at each of MANOEUVRE_SAMPLES+1 evenly-spaced Bézier
  // parameters, so `manoeuvreAtDistance` can invert distance → parameter. Built
  // once per stall and cached by the sim; the last entry is the total length.
  arc: number[];
}

// How far back along the lane the manoeuvre starts, as a fraction of a tile. Long
// enough that the swing reads as a turn rather than a jump, short enough that a
// car does not block the road half a tile early. Exported because the sim needs
// the SAME number to know where along the tile a car peels off.
export const MANOEUVRE_APPROACH_FRAC = 0.16;

// Where along the approach a car aiming for stall `index` starts to peel off.
export function manoeuvreStartT(row: ParkingRow, index: number, size: number): number {
  return Math.max(0, stallPose(row, index, size, 0).t - MANOEUVRE_APPROACH_FRAC);
}

// Build the pull-in curve for `stall` from the lane a class-`cls` car drives.
// `laneOff` is the car's lateral lane offset (right-of-travel), in the same units
// as `size` — the same number `createLaneGeometry.couplerOffsets` gives the
// renderer, so the curve starts exactly where the car really is rather than on
// the centreline. `tStartOverride` lets the sim anchor `p0` at the car's ACTUAL
// position when it triggers, so the sprite never jumps as the manoeuvre begins.
export function manoeuvrePath(
  row: ParkingRow,
  index: number,
  size: number,
  kerbPx: number,
  laneOff: number,
  tStartOverride?: number,
): ManoeuvrePath {
  const from = row.from;
  const exit = oppositePort(from);
  const pose = stallPose(row, index, size, kerbPx);
  const tStart = tStartOverride ?? Math.max(0, pose.t - MANOEUVRE_APPROACH_FRAC);
  const onLane = (t: number): Pt => {
    const p = laneSegmentPointAt(from, exit, size, laneOff, laneOff, t);
    return { x: p.x, y: p.y };
  };
  const path: ManoeuvrePath = {
    p0: onLane(tStart),
    p1: onLane(pose.t),
    p2: { x: pose.x, y: pose.y },
    restAngleDeg: pose.angleDeg,
    arc: [],
  };
  path.arc = buildArcTable(path);
  return path;
}

// The approach a car rejoins the road on when it leaves a GARAGE, and therefore
// which bank its out-ramp sits on. Same as it went in unless the author says
// otherwise.
export function garageExitFrom(row: ParkingRow): Port {
  return row.exitTo ?? row.from;
}

// The row as seen from the OUT ramp: same geometry, but framed on the approach the
// car will be travelling when it re-emerges. With `exitTo === from` that is the
// same bank a little further downstream; with the opposite port it is the far
// kerb, facing the other way.
function exitRowOf(row: ParkingRow): ParkingRow {
  return row.exitTo && row.exitTo !== row.from ? { ...row, from: row.exitTo } : row;
}

// The curve a car drives OUT of a garage: from the ramp mouth, through the point
// on the lane abeam it, to a point further along the road. Driven FORWARD (m 0→1),
// so the car noses out of the building the way it is going.
//
// A rank of BAYS does not use this: reversing out of a bay and then pulling away
// is what a driver actually does, and the entry curve replayed backwards is
// exactly that motion. A garage is the case where it looks wrong — nobody backs
// out of a multi-storey — so the garage gets its own forward path and its own
// second mouth to come out of.
export function garageExitPath(
  row: ParkingRow,
  size: number,
  kerbPx: number,
  laneOff: number,
): ManoeuvrePath {
  const exitRow = exitRowOf(row);
  const from = exitRow.from;
  const ahead = oppositePort(from);
  const pose = stallPose(exitRow, 0, size, kerbPx, "out");
  const tEnd = Math.min(0.999, pose.t + MANOEUVRE_APPROACH_FRAC);
  const onLane = (t: number): Pt => {
    const p = laneSegmentPointAt(from, ahead, size, laneOff, laneOff, t);
    return { x: p.x, y: p.y };
  };
  // Ends ALIGNED WITH THE ROAD, not with the ramp: the car is rejoining traffic,
  // so its final heading is the lane's, whatever angle it left the building at.
  const lane = laneSegmentPointAt(from, ahead, size, laneOff, laneOff, tEnd);
  const path: ManoeuvrePath = {
    p0: { x: pose.x, y: pose.y },
    p1: onLane(pose.t),
    p2: onLane(tEnd),
    restAngleDeg: lane.tangentDeg,
    arc: [],
  };
  path.arc = buildArcTable(path);
  return path;
}

// Where along its exit approach a car rejoins the road after a garage — the
// progress its path is re-seeded at, so it carries on from where it really is.
export function garageExitEndT(row: ParkingRow, size: number): number {
  return Math.min(0.999, stallPose(exitRowOf(row), 0, size, 0, "out").t + MANOEUVRE_APPROACH_FRAC);
}

// How finely the manoeuvre curve is measured. 16 chords over a ~50px swing puts
// the arc-length error well under a pixel — far below anything visible, and the
// table is built once per stall, not per tick.
const MANOEUVRE_SAMPLES = 16;

function bezierAt(path: ManoeuvrePath, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * path.p0.x + 2 * u * t * path.p1.x + t * t * path.p2.x,
    y: u * u * path.p0.y + 2 * u * t * path.p1.y + t * t * path.p2.y,
  };
}

function buildArcTable(path: ManoeuvrePath): number[] {
  const arc = [0];
  let prev = bezierAt(path, 0);
  for (let i = 1; i <= MANOEUVRE_SAMPLES; i++) {
    const p = bezierAt(path, i / MANOEUVRE_SAMPLES);
    arc.push(arc[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  return arc;
}

// Total driven length of the manoeuvre, in the units the path was built in.
export function manoeuvreLength(path: ManoeuvrePath): number {
  return path.arc[path.arc.length - 1] ?? 0;
}

// The Bézier parameter at a fraction `m` (0..1) of the manoeuvre's ARC LENGTH.
// This is what makes `m` mean distance, so a car crawls into its bay at a
// constant speed instead of surging through the middle of the swing.
function paramAtArcFraction(path: ManoeuvrePath, m: number): number {
  const total = manoeuvreLength(path);
  if (total <= 0) return Math.max(0, Math.min(1, m));
  const want = Math.max(0, Math.min(1, m)) * total;
  const arc = path.arc;
  for (let i = 1; i < arc.length; i++) {
    if (arc[i] >= want) {
      const span = arc[i] - arc[i - 1];
      const frac = span > 0 ? (want - arc[i - 1]) / span : 0;
      return (i - 1 + frac) / MANOEUVRE_SAMPLES;
    }
  }
  return 1;
}

// Point + heading at `m` (0..1) along the manoeuvre. `m = 0` is on the lane,
// `m = 1` is at rest in the stall. The heading eases from the curve's own tangent
// to the stall's rest angle over the last part of the move, so a car finishes
// square in its bay instead of at whatever angle the Bézier happened to end on
// (the tangent of a quadratic at t=1 is the p1→p2 chord, which for a shallow
// parallel bay is nearly along the road — right — but for a 90° bay is a few
// degrees short of square).
export function manoeuvreAt(
  path: ManoeuvrePath,
  m: number,
): { x: number; y: number; angleDeg: number } {
  // `m` is a fraction of ARC LENGTH; convert it to the curve's own parameter
  // first, or the car speeds up and slows down for no reason (see the note on
  // ManoeuvrePath).
  const t = paramAtArcFraction(path, m);
  const u = 1 - t;
  const { x, y } = bezierAt(path, t);
  // Derivative of the quadratic — the direction the car is actually moving.
  let dx = 2 * u * (path.p1.x - path.p0.x) + 2 * t * (path.p2.x - path.p1.x);
  let dy = 2 * u * (path.p1.y - path.p0.y) + 2 * t * (path.p2.y - path.p1.y);
  if (dx === 0 && dy === 0) {
    dx = path.p2.x - path.p0.x;
    dy = path.p2.y - path.p0.y;
  }
  const tangentDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Blend to the rest angle over the second half. Shortest-way blend, so a bay
  // whose rest angle is 179° from the tangent doesn't spin the car the long way.
  const blend = Math.max(0, (t - 0.5) * 2);
  const delta = ((path.restAngleDeg - tangentDeg + 540) % 360) - 180;
  return { x, y, angleDeg: tangentDeg + delta * blend };
}

// --- Level-wide derivations --------------------------------------------------

// One car park: every stall that belongs to it, and where a car can get in.
export interface ParkingFacility {
  id: string;
  label: string;
  stalls: StallRef[];
  // The (tile, approach) states a car must be driving in to reach a stall of this
  // facility. These are the BFS goals the router aims at.
  access: { coord: Coordinates; entryPort: Port }[];
  // Every tile the facility touches, so a car can tell when it has driven past
  // the whole thing without finding a space.
  tileIds: Set<string>;
}

// Group a level's parking into facilities. Deterministic: facilities come out
// sorted by id and their stalls in tile/row/index order, so a seeded run replays.
export function facilitiesOf(level: Level): ParkingFacility[] {
  const byId = new Map<string, ParkingFacility>();
  for (const tileId of Object.keys(level).sort()) {
    const cell = level[tileId];
    const fid = facilityOf(cell, tileId);
    if (!fid) continue;
    let f = byId.get(fid);
    if (!f) {
      f = {
        id: fid,
        label: cell.parking?.label ?? fid,
        stalls: [],
        access: [],
        tileIds: new Set(),
      };
      byId.set(fid, f);
    }
    if (cell.parking?.label && f.label === fid) f.label = cell.parking.label;
    f.tileIds.add(tileId);
    const [x, y] = tileId.split(",").map(Number);
    for (const row of rowsOf(cell)) {
      const side = rowSide(row);
      for (let i = 0; i < row.count; i++) {
        f.stalls.push({ tileId, from: row.from, side, index: i });
      }
      f.access.push({ coord: { x, y }, entryPort: row.from });
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// --- Validation --------------------------------------------------------------

export interface ParkingIssue {
  tileId: string;
  message: string;
}

// Author-facing checks. Parking is authored by hand in scenarios, so these catch
// the mistakes that would otherwise show up as bays floating in a field, cars
// that can never reach a stall, or a car park that swallows traffic whole.
//
// `tileSize` matters: every dimension here is a fraction of a tile, so "does this
// bay fit" is only answerable against the size the board actually renders at.
export function validateParking(level: Level, tileSize = 200): ParkingIssue[] {
  const issues: ParkingIssue[] = [];
  const add = (tileId: string, message: string) => issues.push({ tileId, message });

  for (const [tileId, cell] of Object.entries(level)) {
    const rows = rowsOf(cell);
    if (rows.length === 0) continue;
    const [x, y] = tileId.split(",").map(Number);
    const coord = { x, y };
    if (!cell.road?.length) {
      add(tileId, "parking row on a tile with no road to reach it");
      continue;
    }
    if (isRoadJunction(cell.road)) {
      add(tileId, "parking row on a road junction (only straights may carry bays)");
      continue;
    }
    // A TAPER moves the kerb across the tile's own length, so bays sized against
    // one end sit under the running lane at the other. "Straights only" is not
    // enough of a guard here — a taper IS a straight. Compare the two PAINTED
    // ends rather than the tile's own lane counts: `laneCountAt` totals the lanes
    // crossing a port in BOTH directions, so it is symmetric on any straight and
    // would never see the taper at all. What moves is the seam width, which is set
    // by the neighbours.
    const [kerbA, kerbB] = kerbOffsetEnds(level, coord, rows[0].from, tileSize);
    if (Math.abs(kerbA - kerbB) > 0.5) {
      add(tileId, "parking row on a tapering tile (the kerb moves across it)");
    }

    const seenSide = new Set<string>();
    const seenBank = new Map<Port, string>();
    for (const row of rows) {
      const side = rowSide(row);
      const key = `${row.from}|${side}`;
      if (seenSide.has(key)) {
        add(tileId, `two parking rows share approach ${row.from} side ${side}`);
      }
      seenSide.add(key);
      // Two rows can name the SAME physical kerb through different approaches
      // (see `bankOf`). Authoring both paints two sets of bays into one strip of
      // tarmac and counts every space twice — the aliasing bug that keying rows
      // by (approach, side) makes possible and only this check can catch.
      const bank = bankOf(row);
      const prev = seenBank.get(bank);
      if (prev !== undefined) {
        add(tileId, `two parking rows hug the same kerb (${prev} and ${key} are the same bank)`);
      }
      seenBank.set(bank, key);

      // The approach must exist and run straight through the tile.
      const straightThrough = cell.road.some(
        l => l.from === row.from && l.to.includes(oppositePort(row.from)),
      );
      if (!straightThrough) {
        add(tileId, `parking row's approach ${row.from} is not a straight-through road lane`);
      }
      // A "left" row means crossing to the far bank, which is only legal where
      // there is no oncoming stream to cross. `isOneWayStraight` is the project's
      // existing predicate for that — deriving it by comparing a seam count with a
      // lane-object count happens to agree today and inverts the moment turn lanes
      // appear on the tile.
      if (side === "left" && !isOneWayStraight(cell.road, row.from)) {
        add(
          tileId,
          "left-side parking row on a two-way road (a driver cannot cross oncoming traffic to reach it)",
        );
      }
      const max = maxStallsPerTile(row.kind, tileSize);
      if (row.count > max) {
        add(tileId, `${row.count} ${row.kind} stalls do not fit on one tile (max ${max})`);
      }
      // The bays must land on the tile, not in the neighbour's garden. This is the
      // check that decides how wide a street can carry kerbside parking at all: at
      // the native 200px tile a 2+2 arterial (kerb at 56px) still takes a parallel
      // bay, and a 3+3 boulevard (kerb at 84px) has less room left than a car is
      // wide. That is the correct answer — an American arterial with kerb parking
      // IS 2+2 — but it has to be said out loud rather than discovered.
      const kerb = kerbOffsetAt(level, coord, row.from, tileSize);
      const long = row.reserved === "long";
      const outer =
        kerb + (row.gap ?? 0) * LANE_WIDTH_FRAC * tileSize + stallDepthPx(row.kind, tileSize, long);
      if (outer > tileSize / 2 + 0.5) {
        add(
          tileId,
          `${row.kind} bays overhang the tile beside a ${laneCountAt(cell.road, row.from)}-lane road (use "parallel", or a narrower road)`,
        );
      }
      // A bay shallower than this would leave a parked car close enough to the
      // running lane to count as a physical clip (CLIP_LANES in sim/road.ts), and
      // it would sit there for its whole dwell. That is not a bay, it is a lane
      // blocker.
      if (row.kind !== "garage" && stallDepthPx(row.kind, tileSize, long) < 0.5 * LANE_WIDTH_FRAC * tileSize) {
        add(tileId, `${row.kind} bays are too shallow to keep a parked car clear of the lane`);
      }
    }
  }

  // Every car park must lead BACK to the road network. A one-way aisle that stops
  // is a car trap: there is no U-turn in the lane model (`roadExitPort` never
  // returns the entry port), so a car that drives into one either reaches a dead
  // end and despawns between the rows of stalls, or circles a pocket it cannot
  // leave. The sim already refuses to spawn or route to openings inside a car
  // park; this is the other half — proving the way out exists.
  for (const f of facilitiesOf(level)) {
    if (!facilityHasWayOut(level, f)) {
      add([...f.tileIds].sort()[0], `car park "${f.label}" has no way back to the road network`);
    }
  }
  return issues;
}

// Can a car driving anywhere in `f` reach a tile outside the facility, or the map
// edge? A flood fill over the road port-graph from every access state.
function facilityHasWayOut(level: Level, f: ParkingFacility): boolean {
  const seen = new Set<string>();
  const queue: { coord: Coordinates; entry: Port }[] = f.access.map(a => ({
    coord: a.coord,
    entry: a.entryPort,
  }));
  for (let guard = 0; queue.length > 0 && guard < 4096; guard++) {
    const { coord, entry } = queue.shift()!;
    const id = getCoordinatesId(coord);
    const key = `${id}:${entry}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cell = level[id];
    if (!cell?.road?.length) continue;
    for (const exit of exitsFrom(cell.road, entry)) {
      const n = neighborCoord(coord, exit);
      if (!n) continue;
      const nId = getCoordinatesId(n);
      const nCell = level[nId];
      // Running off into nothing is NOT a way out — it is the dead end itself.
      // The sim refuses to route a car to an opening inside a car park precisely
      // so that nobody drives into one and evaporates between the rows of stalls;
      // the validator has to agree, or it would bless the map that does it.
      if (!nCell?.road?.length) continue;
      if (!f.tileIds.has(nId)) return true; // reached ordinary street
      queue.push({ coord: n, entry: oppositePort(exit) });
    }
  }
  return false;
}
