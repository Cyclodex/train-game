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
//  • "busstop"       — a halt ON the carriageway. The bus does not leave the lane
//                      at all, so the traffic behind it QUEUES, which is the whole
//                      difference between a stop and a lay-by. Bus-only by its own
//                      kind; no `reserved` needed (see sim/parking.ts bayClassOf).
export type StallKind =
  | "parallel"
  | "perpendicular"
  | "angled"
  | "garage"
  | "busstop";

// Does a vehicle using this stall stay ON the carriageway? The one property that
// separates a bus STOP from a bus BAY, and it decides three things at once: no
// pull-in manoeuvre, no gap to wait for, and — the point — the halted bus keeps
// its road body, so everything behind it has to wait.
export function stallOnLane(kind: StallKind): boolean {
  return kind === "busstop";
}

// Does a vehicle drive OUT of this kind of stall nose-first?
//
// An ECHELON or 90° bay does not: a driver reverses out of one, and replaying the
// entry curve backwards is exactly that motion, for free. A KERBSIDE bay is the
// opposite case — nobody backs out of a parallel space into the traffic behind
// them; they nose out and pull away, which is also the only thing a coach in a
// lay-by can physically do. A garage is the same story, and is why it has a
// second mouth to come out of.
export function exitsForward(kind: StallKind, enteredReverse = false): boolean {
  // HOW YOU GOT IN DECIDES HOW YOU GET OUT, and that is the whole rule. Back into
  // a space and you drive out of it — which is exactly why drivers reverse into a
  // bay in the first place: you leave facing the traffic you are joining.
  if (enteredReverse) return true;
  return kind === "garage" || kind === "parallel";
}

// Who may use a row. Absent = anything that physically fits.
//  • "disabled" / "delivery" — reserved bays. v1 paints them and keeps ordinary
//    traffic out; nothing yet issues a permit, so they simply stay empty and read
//    as the real thing (a car park is never 100% usable).
//  • "long" — the lorry/coach lay-by. RESERVED for them: a car may not take one,
//    however much room is left over.
//  • "bus" — a BUS STOP. Coaches only, and authored with a short `dwellSec`: a
//    halt is a pause with passengers boarding, not parking.
// A bay serves ONE class of vehicle, never anything that merely fits inside it.
// Who may use what lives in `sim/parking.ts` (`bayClassOf` / `bayAdmits`).
export type StallReservation = "disabled" | "delivery" | "long" | "bus";

// Does this reservation need a BIG bay? A car is 38px, a coach 55 and a lorry 65,
// and a delivery lorry has to get its tail in too — one extra size tier covers all
// three. This is the SINGLE place that decides, because the inline
// `reserved === "long"` it replaces was repeated at nine call sites and every one
// of them would have quietly ignored the two new kinds.
export function needsBigBay(reserved?: StallReservation): boolean {
  return reserved === "long" || reserved === "delivery" || reserved === "bus";
}

// How far a LAY-BY's kerb opens out and closes back in again, per end, in px.
//
// A lay-by is not a rectangle cut out of the verge — the kerb swings away from the
// road, runs parallel for the length of the bay, and swings back. That shape is
// what a driver actually follows in, which is why the pull-in curve is measured
// from the taper mouth (`manoeuvreApproachPx`) rather than from a fixed distance:
// the bay opening and the vehicle entering it are the same movement.
//
// 1.5x the depth is as much as fits. At the native tile a big bay is 110px and the
// tile is 200, so two tapers have 90px between them; 2x would need 214 and spill
// onto the neighbour, where the tile's own viewBox would clip it off.
//
// ZERO for an ordinary rank. A run of kerbside car spaces is a continuous parking
// LANE, and tapering each tile's end would turn one street into a row of pockets.
export function layByTaperPx(row: ParkingRow, size: number): number {
  if (!needsBigBay(row.reserved) || row.kind === "garage" || stallOnLane(row.kind)) {
    return 0;
  }
  return stallDepthPx(row.kind, size, true) * 1.5;
}

// A CAR'S LENGTH, as a fraction of a tile — the aisle a 90° bay needs.
//
// Turning a car through a right angle takes room, and the room it takes is its own
// length. Measured on a rank of 90° bays with a parked neighbour either side: from
// the 14px aisle these maps had, the pull-in drove 5.6px THROUGH the car next
// door. At a car's length of clearance it grazes it (0.6px clear) and stays there
// however much more you give it — so this is a threshold, not a dial.
//
// And it is CLEARANCE that fixes it, not a longer approach: lengthening the swing
// makes it worse, fast (−5.6 → −23.7px at 0.6 of a tile), because the car spends
// the extra distance travelling diagonally across the bays it is passing. Turn
// LATE, in a WIDE aisle — which is exactly how a real car park is laid out.
const TURN_IN_CLEARANCE_FRAC = 0.19;

// Does this kind turn ACROSS the kerb to get in, rather than sliding along it?
export function turnsInAcrossKerb(kind: StallKind): boolean {
  return kind === "perpendicular" || kind === "angled";
}

// Can this kind of bay be BACKED into at all? Two can, for different reasons, and
// the third cannot for a reason that is geometry and not tuning.
//
//  • PARALLEL — must be, when its neighbours are taken. Reversing pivots about the
//    rear and the swept area stays in the bay's own column.
//  • PERPENDICULAR — may be, and a driver who does drives out forwards. The turn
//    is a quarter circle, which is exactly what one pivot arc expresses.
//  • ANGLED — no, and not for want of a better curve. An echelon bay is raked
//    FORWARD (`shearedBoxPoints`: you reach it by turning toward its side), so a
//    car backed into one comes to rest at `angle + 180` — facing back up the
//    aisle it arrived down. On a one-way aisle, which is the only place a far-bank
//    rank is legal at all, there is nowhere for it to go. Real car parks that want
//    reverse-in echelon parking rake the bays the OTHER way; ours do not, and the
//    measured "reverse is worse here" (−8.6/−15.0px against −2.3/+0.3 nosing in)
//    was that fact showing up as a swept overlap rather than as a heading.
export function canReverseIn(kind: StallKind): boolean {
  return kind === "parallel" || kind === "perpendicular";
}

// WHICH WAY THE CAR IS FACING as it stands in the bay. One answer, because two
// were measured to disagree: the entry curve left a kerbside car pointing down the
// road (right) while the exit curve set off assuming it pointed back up the road
// (wrong), so every car leaving a reverse-parked kerbside bay spun 180° on the
// spot and then unwound another 102° over the next few ticks. Measured on
// /test/parkingkerb: 47 per-tick heading jumps over 25°, worst 180.0°.
export function parkedHeadingDeg(
  kind: StallKind,
  poseAngleDeg: number,
  enteredReverse: boolean,
): number {
  // A garage pose points INTO the building — a stall pose is where a car RESTS,
  // not the way it leaves — so the ramp is the one case that always turns round.
  if (kind === "garage") return poseAngleDeg + 180;
  // Backing into a bay that turns ACROSS the kerb leaves the car nose-out, which
  // is the entire reason a driver does it. Backing into a KERBSIDE space does
  // not: the bay lies ALONG the road, so the car ends up pointing the same way
  // whichever way it got in.
  if (enteredReverse && turnsInAcrossKerb(kind)) return poseAngleDeg + 180;
  return poseAngleDeg;
}

// Where a row's bays START, measured out from the lane's centreline. The one place
// that answers it: the expression was repeated at nine call sites, and the
// clearance rule below would have been missed by every one of them.
//
// A row that turns in across the kerb is held at least a car's length off the
// driving line whatever the author asked for. That is not a preference — under it
// the manoeuvre cannot be driven without going through the neighbours.
export function bayNearPx(row: ParkingRow, size: number, kerbPx: number): number {
  const authored = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size;
  if (!turnsInAcrossKerb(row.kind)) return authored;
  return Math.max(authored, TURN_IN_CLEARANCE_FRAC * size);
}

// Where the row's TARMAC starts, which is not always where its bays do. An
// AUTHORED `gap` is a verge — a pavement, a service strip — and stays green. The
// clearance a turning rank is held out by is the opposite: it is the aisle the car
// swings through, so it is paved right up to the kerb.
export function apronNearPx(row: ParkingRow, size: number, kerbPx: number): number {
  const authored = kerbPx + (row.gap ?? 0) * LANE_WIDTH_FRAC * size;
  return turnsInAcrossKerb(row.kind) ? Math.min(authored, kerbPx) : authored;
}

// How much room along the road a manoeuvre into or out of this row takes, in px.
// ONE number for both directions, because the pull-in and the pull-out are mirror
// images of each other; two would make a bay you enter along a gentle curve and
// leave along a sharp one.
//
//  • A tapered LAY-BY is driven ALONG ITS OWN OPENING — from the taper mouth, half
//    a bay further on. The bay opening and the vehicle using it are one movement.
//  • A KERBSIDE space is the awkward case, and the reason this is not a constant.
//    The vehicle points down the road at BOTH ends of the move and has only to
//    shift its own offset sideways, so the room it needs is set by that offset,
//    not by a fixed distance. Too little and it travels at 65° to the road at the
//    far end — measured as 0.89 of its motion sideways, which is a car sliding
//    into its space broadside. Two lateral widths halves that.
//  • Everything else NOSES in. A 90° or echelon bay is MEANT to turn across the
//    kerb, and its own depth is the room that takes.
export function manoeuvreRunPx(row: ParkingRow, size: number, kerbPx: number): number {
  const taper = layByTaperPx(row, size);
  if (taper > 0) return taper + stallPitchPx(row.kind, size, true) / 2;
  if (row.kind === "parallel") {
    // MEASURED FROM THE CAR'S OWN LANE, not from the tile's centreline. The bay
    // sits `bayNearPx + depth/2` out from the centreline, but the car is already
    // most of the way there — it is riding the KERB LANE, half a lane inside the
    // kerb. The shift it actually has to make is the difference, and it is small:
    // 27px on both a 1+1 street and a 2+2 arterial, against the 69px the
    // centreline suggests on the wide one.
    //
    // Getting this wrong scaled the run to 138px — over five times the real shift
    // — and that is what wrecked the kerbside manoeuvre. Longitudinally a parallel
    // bay has almost nothing to spare (60px of pitch for a 40px car leaves 20px),
    // so a run that long drifts the body sideways while it is still abeam the
    // neighbours, which is exactly the "cuts across the next bay" that was
    // reported. It also clamped two of every three stop lines to the tile's
    // leading edge, which is what left cars nothing to change lanes in.
    const lane = kerbPx - (LANE_WIDTH_FRAC * size) / 2;
    const shift =
      bayNearPx(row, size, kerbPx) +
      stallDepthPx(row.kind, size, needsBigBay(row.reserved)) / 2 -
      lane;
    return Math.max(MANOEUVRE_APPROACH_FRAC * size, 2 * shift);
  }
  return MANOEUVRE_APPROACH_FRAC * size;
}

// How much faster than the base crawl a curve is driven — see `ManoeuvrePath.pace`.
// Straight from the DISTANCE it covers: a manoeuvre with twice the swing is half
// as sharp, so it is driven about twice as fast and takes about the same TIME.
//
// Measured on the curve rather than on its longitudinal run, because the two come
// apart: widening a car-park aisle to a car's length (`bayNearPx`) leaves the run
// untouched and half again as much curve, and on the run alone that read as "no
// change" while every 90° pull-in silently took 60% longer — `parkinglot` fell
// from three completed park-and-leave cycles in a run to two.
//
// Never below 1: a degenerate stub of a curve is not a reason to crawl.
function paceOf(path: ManoeuvrePath, size: number): number {
  return Math.max(1, manoeuvreLength(path) / (MANOEUVRE_APPROACH_FRAC * size));
}

// Assemble the legs into a path: measure it, then price it. The one place a
// ManoeuvrePath is ever built, so a new manoeuvre shape cannot forget either.
function finishPath(legs: ManoeuvreLeg[], restAngleDeg: number, size: number): ManoeuvrePath {
  const path: ManoeuvrePath = { legs, arc: buildArcTable(legs), restAngleDeg, pace: 1 };
  path.pace = paceOf(path, size);
  return path;
}

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
  // Is the parking edge PAINTED into individual bays, or is it just kerb you
  // stop against? Default "bays".
  //
  // "none" is the American wide street: the carriageway keeps all of its own
  // markings and the parking edge has no white boxes at all — you pull in
  // wherever you fit. Everything else about the row is unchanged (depth, pitch,
  // manoeuvre, exit style), which is exactly why this is a property of PAINT and
  // not a new `StallKind`: an unmarked kerb and a marked one are the same
  // parking, drawn differently. The apron and the outer kerb line stay, so the
  // street reads as WIDER along the run rather than as a slab beside it — which
  // is what a wide street with kerb parking is.
  //
  // Only meaningful on a kerbside (`parallel`) row, or on a PRIVATE drive: a
  // public 90° or echelon rank without its bay lines is not an unmarked street,
  // it is a car park nobody finished painting. A drive is the other case — see
  // `resident`.
  marking?: "bays" | "none";
  // WHOSE DRIVE THIS IS. Set to a home plot's coordinate id, this row stops
  // being public parking and becomes that address's own off-street spaces: the
  // driveway, the hardstanding, the garage in front of the house.
  //
  // It is not a `StallReservation`. A reservation is a painted class of bay in a
  // PUBLIC facility — disabled, delivery, loading — and the question it answers
  // is "what sort of vehicle may stop here". This one answers "who owns this
  // tarmac", which no amount of paint decides: a stranger may not use your drive
  // because it is yours, not because a sign says so. Keeping them apart is also
  // what lets two neighbouring houses put two rows on ONE road tile and each
  // keep their own — a facility-level permit could not tell them apart.
  //
  // Who may take one: `sim/parking.ts` (`bayClassOf` → "resident", and the
  // `permit` argument that carries the driver's address).
  resident?: string;
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
  // A stop on the carriageway has no depth: the bus never leaves its lane.
  busstop: 0,
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
  // One coach's worth of kerb (a bus is 55px), plus room for the markings.
  busstop: 0.4,
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
export function stallDepthPx(kind: StallKind, tileSize: number, big = false): number {
  if (big && kind !== "parallel") return LONG_FRAC * tileSize;
  return DEPTH_FRAC[kind] * tileSize;
}

export function stallPitchPx(kind: StallKind, tileSize: number, big = false): number {
  if (big && kind === "parallel") return LONG_FRAC * tileSize;
  // A big 90° bay is DEEPER, not wider — it needs a touch more width too, but
  // nothing like its extra depth.
  if (big && kind !== "garage") return PITCH_FRAC[kind] * 1.35 * tileSize;
  return PITCH_FRAC[kind] * tileSize;
}

// The length of body a stall can hold, in px. A garage slot is inside a building
// — no geometry constrains it, so it takes anything that is allowed to park.
export function stallLengthPx(row: ParkingRow, tileSize: number): number {
  const big = needsBigBay(row.reserved);
  if (row.kind === "garage") return Number.POSITIVE_INFINITY;
  // A stop is a length of kerb, never a box the vehicle noses into.
  if (row.kind === "busstop") return stallPitchPx(row.kind, tileSize, big);
  return row.kind === "parallel"
    ? stallPitchPx(row.kind, tileSize, big)
    : stallDepthPx(row.kind, tileSize, big);
}

// The resting angle of a parked car RELATIVE to the direction of travel, in
// degrees. 0 = nose along the road (parallel), 90 = nose into the bay.
const REST_ANGLE: Record<StallKind, number> = {
  // Still pointing down the road — it is halted in the lane, not parked.
  busstop: 0,
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

// What a garage holds when nobody says. A car park's capacity is the number the
// whole feature turns on — a facility that cannot fill never shows a driver being
// turned away — so the default is a building you could plausibly fill, not the
// ceiling. `maxStallsPerTile` answers "how many COULD fit", which is the wrong
// question to answer with for a garage, whose slots are not on the map at all.
export const DEFAULT_GARAGE_CAPACITY = 16;

export function maxStallsPerTile(kind: StallKind, tileSize = 200, big = false): number {
  if (kind === "garage") return MAX_GARAGE_CAPACITY;
  return Math.floor(tileSize / stallPitchPx(kind, tileSize, big) + 1e-9);
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
export function bankFor(from: Port, side: "right" | "left"): Port {
  // Right-of-travel in screen space (y down) is the port one quarter-turn
  // CLOCKWISE from the direction of travel. Derived from the heading rather than
  // by table, so it cannot drift.
  return rotatePort(oppositePort(from), side === "right" ? 1 : -1);
}

export function bankOf(row: ParkingRow): Port {
  return bankFor(row.from, rowSide(row));
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

  const big = needsBigBay(row.reserved);
  const pitch = stallPitchPx(row.kind, size, big);
  const depth = stallDepthPx(row.kind, size, big);
  // Where the row starts along the tile. "pack" (the default) begins at the
  // leading edge so consecutive tiles form one continuous run of bays; "centre"
  // centres the row for a lone lay-by. A garage's mouth is always mid-tile.
  const span = row.kind === "garage" ? 0 : pitch * row.count;
  // A tapered LAY-BY centres itself: its entry taper needs room BEFORE the bay,
  // and a packed row starts at the tile's leading edge with none to give. A rank
  // of ordinary spaces still packs, so consecutive tiles form one continuous run.
  const centred = row.align === "centre" || layByTaperPx(row, size) > 0;
  const start = centred ? (size - span) / 2 : 0;
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
  const lateral = sideSign * (bayNearPx(row, size, kerbPx) + depth / 2);

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
  const near = bayNearPx(row, size, kerbPx);
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
// ONE STRETCH of a manoeuvre, driven in ONE direction. A cubic, because a curve
// has to leave along the heading the car is already at and arrive along the one it
// has to end at, and a quadratic's two tangents share a leg (see `manoeuvreAt`).
export interface ManoeuvreLeg {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
  // The car drives this leg BACKWARDS: it moves p0 → p3 while pointing the other
  // way. Reversing is not a special case of the phase machine — it is one flag on
  // one leg, and everything downstream (arc length, speed, the sampled heading)
  // falls out unchanged.
  reverse: boolean;
}

export interface ManoeuvrePath {
  // A SEQUENCE, because a real parking manoeuvre changes direction. Nosing into a
  // space is one forward leg; backing into one is "drive past, then reverse in",
  // which is two. `m` still runs 0 → 1 over the whole thing by ARC LENGTH, so the
  // phase machine never learns that there is more than one.
  legs: ManoeuvreLeg[];
  // Cumulative arc length, MANOEUVRE_SAMPLES entries per leg, so `m` means
  // DISTANCE. Never drive a Bézier by its raw parameter: it is not proportional
  // to distance and the car visibly surges through the middle of a swing.
  arc: number[];
  // The angle at rest — the fallback for a degenerate curve whose derivative
  // vanishes. NOT blended in: the last leg already arrives pointing the right way.
  restAngleDeg: number;
  // How much faster than the base crawl this is driven, because it is that much
  // gentler. See `paceOf`.
  pace: number;
}

// How far back along the lane the manoeuvre starts, as a fraction of a tile. Long
// enough that the swing reads as a turn rather than a jump, short enough that a
// car does not block the road half a tile early. Exported because the sim needs
// the SAME number to know where along the tile a car peels off.
export const MANOEUVRE_APPROACH_FRAC = 0.16;

// Where along the approach a car aiming for stall `index` starts to peel off.
export function manoeuvreStartT(
  row: ParkingRow,
  index: number,
  size: number,
  kerbPx: number,
): number {
  return Math.max(0, stallPose(row, index, size, 0).t - manoeuvreRunPx(row, size, kerbPx) / size);
}

// The direction of travel along a straight approach, in degrees. Taken from the
// lane's own two ends rather than from `laneSegmentPointAt`'s tangent, which is a
// finite difference CLAMPED to [0,1]: ask it at t < 0 — which a car peeling off
// toward the first bay of a packed rank legitimately is (its middle is still on
// the tile behind) — and both samples land on the same side of 0, so the
// difference points BACKWARDS and the heading comes out 180° wrong. That fed the
// cubic a reversed handle, and the curve looped out and back: a 0.29-tile lurch,
// caught by the no-teleport test.
//
// A row is only legal on a straight approach, so one direction serves the whole
// segment and there is nothing to sample.
function approachDeg(
  from: Port,
  to: Port,
  size: number,
  laneOff: number,
): number {
  const a = laneSegmentPointAt(from, to, size, laneOff, laneOff, 0);
  const b = laneSegmentPointAt(from, to, size, laneOff, laneOff, 1);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// HOW a vehicle gets into a space. Not a cosmetic choice — see `manoeuvrePath`.
export type EntryStyle = "forward" | "reverse";

// How far PAST the bay a car pulls before backing in, as a fraction of the bay's
// own pitch. Three quarters puts its rear axle roughly level with the back of the
// car in front, which is where a driver actually stops before reversing.
const REVERSE_PULL_PAST = 0.75;

// A cubic's handle length for a quarter-circle arc of radius 1: 4/3·tan(θ/4).
// The radial error is 2.7 parts in ten thousand — a hundredth of a pixel at the
// radii here — which is why the pivot arc did NOT need a new leg SHAPE. A union
// (`{kind:"bezier"} | {kind:"arc"}`) would have touched `bezierAt`,
// `bezierTangent`, `buildArcTable` and `locate` to buy a hundredth of a pixel.
const ARC_K = (4 / 3) * Math.tan(Math.PI / 8);

// THE PIVOT ARC: what backing into a 90° bay actually is.
//
// The old reverse leg was a cubic laid between the two known tangents, and it
// measured WORSE than nosing in (90°: −3.3/−5.6px against +3.3/+0.1). Widening
// the aisle barely moved it (−5.6 → −1.8 at 42px more), so it was never a
// clearance problem — it was the shape. A real reverse PIVOTS: the rear goes into
// the space while the front swings out through the aisle, about a centre abeam
// the bay. A Bézier between two tangents cannot express that; it bulges across
// the bays either side instead.
//
// The construction, in the row's own frame (`f` along travel, `s` toward the
// row's side, `R` the lateral distance from the car's lane to the bay centre):
//
//   • the car pulls forward to `A`, exactly `r` PAST the bay, still on its lane;
//   • it reverses through a quarter circle of radius `r` about `C = A + r·s`,
//     which puts it square to the bay and `r` back down the aisle;
//   • it reverses straight the remaining `R − r` into the space.
//
// The straight finish is not a detail — it is what a driver does, and it is what
// keeps the pull-past at one car's length (`r`) instead of the whole lateral
// shift. A pure quarter circle would need `R` of pull-past (48–62px here), which
// on a packed rank runs off the end of the tile.
//
// `r` is TURN_IN_CLEARANCE_FRAC — the car's own length, and the same number
// `bayNearPx` already guarantees as aisle. So the room this manoeuvre needs is
// room the layout is already required to have.
function pivotReverseLegs(
  A: Pt,
  target: Pt,
  f: Pt,
  s: Pt,
  r: number,
  straight: number,
): ManoeuvreLeg[] {
  const mid = { x: target.x - s.x * straight, y: target.y - s.y * straight };
  const h = ARC_K * r;
  const legs: ManoeuvreLeg[] = [
    {
      p0: A,
      // The car MOVES backwards down the lane as the swing starts (it is pointing
      // forwards; `reverse` turns the rendered heading round), and it moves
      // straight INTO the bay as it ends.
      c1: { x: A.x - f.x * h, y: A.y - f.y * h },
      c2: { x: mid.x - s.x * h, y: mid.y - s.y * h },
      p3: mid,
      reverse: true,
    },
  ];
  if (straight > 1e-6) {
    const hs = straight / 3;
    legs.push({
      p0: mid,
      c1: { x: mid.x + s.x * hs, y: mid.y + s.y * hs },
      c2: { x: target.x - s.x * hs, y: target.y - s.y * hs },
      p3: target,
      reverse: true,
    });
  }
  return legs;
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
  style: EntryStyle = "forward",
): ManoeuvrePath {
  const from = row.from;
  const exit = oppositePort(from);
  const pose = stallPose(row, index, size, kerbPx);
  const tStart =
    tStartOverride ?? Math.max(0, pose.t - manoeuvreRunPx(row, size, kerbPx) / size);
  const onLane = (t: number): Pt => {
    const p = laneSegmentPointAt(from, exit, size, laneOff, laneOff, t);
    return { x: p.x, y: p.y };
  };
  // BOTH TANGENTS ARE NAMED, which is the whole point of the cubic:
  //  • it LEAVES along the lane, because that is the way the car is already
  //    travelling;
  //  • it ARRIVES along the bay's own axis, because that is the way the car has to
  //    be pointing to be in the bay.
  // Neither is a guess and neither is corrected afterwards. A 90° bay therefore
  // gets approached SQUARE instead of diagonally, which is both what a driver does
  // and what keeps the swing out of the bays either side.
  const p0 = onLane(tStart);
  const p3 = { x: pose.x, y: pose.y };
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y) || 1;
  // A third of the chord each: the standard handle length for a cubic through two
  // known tangents, and the one that neither flattens the middle nor loops it.
  const h = chord / 3;
  const laneRad = (approachDeg(from, exit, size, laneOff) * Math.PI) / 180;
  const rad = (pose.angleDeg * Math.PI) / 180;
  const big = needsBigBay(row.reserved);
  if (style === "reverse" && turnsInAcrossKerb(row.kind)) {
    // A 90° BAY IS PIVOTED INTO — see `pivotReverseLegs`. `canReverseIn` keeps the
    // echelon rank out of here: it is raked forward, so a car backed into one ends
    // up facing the wrong way down a one-way aisle, whatever shape the curve is.
    if (!canReverseIn(row.kind)) return manoeuvrePath(row, index, size, kerbPx, laneOff, tStartOverride);
    // The row's own frame: along travel, and out toward the side the bays are on.
    const f = { x: Math.cos(laneRad), y: Math.sin(laneRad) };
    // Right-of-travel in screen space (y down) is (-fy, fx); the row's side flips
    // it for a far-bank rank. Never read a side out of the sign of an offset.
    const sign = rowSide(row) === "right" ? 1 : -1;
    const s = { x: -f.y * sign, y: f.x * sign };
    const abeam = onLane(pose.t);
    // How far the car has to move SIDEWAYS to get from its lane into the bay.
    const R = (p3.x - abeam.x) * s.x + (p3.y - abeam.y) * s.y;
    const r = Math.min(R, TURN_IN_CLEARANCE_FRAC * size);
    if (r > 1e-6) {
      // `A` is the point it reverses FROM: on its own lane, exactly `r` past the
      // bay. Not clamped to the tile — at one car's length it stays on it, and a
      // clamp would break the tangency the whole construction rests on.
      const A = { x: abeam.x + f.x * r, y: abeam.y + f.y * r };
      return finishPath(
        [
          {
            p0,
            c1: { x: p0.x + f.x * (h / 2), y: p0.y + f.y * (h / 2) },
            c2: { x: A.x - f.x * (h / 2), y: A.y - f.y * (h / 2) },
            p3: A,
            reverse: false,
          },
          ...pivotReverseLegs(A, p3, f, s, r, R - r),
        ],
        // NOSE-OUT. That is what backing in buys, and it is why `exitsForward`
        // hands this car a forward exit afterwards.
        pose.angleDeg + 180,
        size,
      );
    }
  }
  if (style === "reverse") {
    // BACKING IN: drive PAST the space, stop, then reverse into it.
    //
    // This is the only motion that fits a parallel bay whose neighbours are
    // taken, and the reason is which way the car pivots. Nosing in swings the
    // FRONT into the space while the tail is still out in the lane, so the swept
    // area runs diagonally across the bay in front; reversing pivots about the
    // REAR, and the swept area stays in the bay's own column. That is why a 1.5x
    // space (60px of pitch for a 40px car — ours exactly) is a reverse-in space
    // in life, and why nose-first cut the neighbours by 7.6px however the curve
    // was shaped.
    // HOW FAR PAST before backing in, and it is not the same distance for the two
    // shapes. A KERBSIDE space is entered along the kerb, so three quarters of the
    // bay's own pitch puts the rear axle level with the car in front. A 90° or
    // echelon bay is entered ACROSS the aisle: the pitch there is 28px against a
    // 40px car, so a proportion of it is meaningless — what the car needs is room
    // to swing its front out, which is its own length.
    const pastPx = turnsInAcrossKerb(row.kind)
      ? TURN_IN_CLEARANCE_FRAC * size
      : REVERSE_PULL_PAST * stallPitchPx(row.kind, size, big);
    const pastT = pose.t + pastPx / size;
    const past = onLane(Math.min(0.999, pastT));
    const back = Math.hypot(p3.x - past.x, p3.y - past.y) || 1;
    const hb = back / 3;
    return finishPath(
      [
        // 1. Forward along the lane, past the space. Straight: both handles run
        //    down the lane, so this leg does not wander.
        {
          p0,
          c1: { x: p0.x + Math.cos(laneRad) * (h / 2), y: p0.y + Math.sin(laneRad) * (h / 2) },
          c2: { x: past.x - Math.cos(laneRad) * (h / 2), y: past.y - Math.sin(laneRad) * (h / 2) },
          p3: past,
          reverse: false,
        },
        // 2. Backwards into the space. The car is pointing DOWN THE LANE as this
        //    leg starts and at its RESTING angle as it ends, and it is moving the
        //    other way both times — so the curve's own tangents are the reverse of
        //    both, and `reverse: true` turns the rendered heading back round.
        {
          p0: past,
          c1: { x: past.x - Math.cos(laneRad) * hb, y: past.y - Math.sin(laneRad) * hb },
          c2: { x: p3.x + Math.cos(rad) * hb, y: p3.y + Math.sin(rad) * hb },
          p3,
          reverse: true,
        },
      ],
      pose.angleDeg,
      size,
    );
  }
  const legs: ManoeuvreLeg[] = [
    {
      p0,
      c1: { x: p0.x + Math.cos(laneRad) * h, y: p0.y + Math.sin(laneRad) * h },
      // BACK along the resting heading: the curve comes into the bay nose-first.
      c2: { x: p3.x - Math.cos(rad) * h, y: p3.y - Math.sin(rad) * h },
      p3,
      reverse: false,
    },
  ];
  return finishPath(legs, pose.angleDeg, size);
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

// The stall the forward exit LEAVES FROM. A garage comes out of its second mouth,
// which may be on the far bank; every other kind comes out of the space it is
// sitting in.
function exitStall(
  row: ParkingRow,
  index: number,
  size: number,
  kerbPx: number,
): { row: ParkingRow; pose: StallPose } {
  const garage = row.kind === "garage";
  const framed = garage ? exitRowOf(row) : row;
  return { row: framed, pose: stallPose(framed, garage ? 0 : index, size, kerbPx, "out") };
}

function forwardExitEnd(
  row: ParkingRow,
  pose: StallPose,
  size: number,
  kerbPx: number,
  maxT: number,
): number {
  return Math.min(maxT, pose.t + manoeuvreRunPx(row, size, kerbPx) / size);
}

// The curve a vehicle drives OUT of a stall nose-first: from the space, through a
// control point on the heading it is PARKED at, to a point further along the road.
// Driven FORWARD (m 0→1), mirroring `manoeuvrePath` — the pull-out is the pull-in
// seen the other way, not the pull-in played backwards. See `exitsForward` for
// which kinds get one.
export function forwardExitPath(
  row: ParkingRow,
  index: number,
  size: number,
  kerbPx: number,
  laneOff: number,
  // Which way the vehicle is FACING as it stands there — see `exitsForward`. A car
  // that backed in is pointing out and drives away; one that nosed in is pointing
  // into the bay, which only a garage and a kerbside space ever do forwards.
  enteredReverse = false,
  // The furthest along the tile the curve may END, as `forwardExitEndT` takes it.
  // The caller owns this because it depends on the VEHICLE: the curve carries the
  // body's centre, so its nose needs half a length of tile left in front of it to
  // be re-seated on the lane (see `seatAtExitSlot`).
  maxT = 0.999,
): ManoeuvrePath {
  const { row: exitRow, pose } = exitStall(row, index, size, kerbPx);
  const from = exitRow.from;
  const ahead = oppositePort(from);
  const tEnd = forwardExitEnd(row, pose, size, kerbPx, maxT);
  const onLane = (t: number): Pt => {
    const p = laneSegmentPointAt(from, ahead, size, laneOff, laneOff, t);
    return { x: p.x, y: p.y };
  };
  // The MIRROR of the entry, and for the same reason: it LEAVES along the heading
  // the vehicle is parked at, and ARRIVES along the lane. Both named, neither
  // corrected afterwards — so a car noses out of a kerbside space and a car comes
  // square out of a garage ramp, from one construction.
  const p0 = { x: pose.x, y: pose.y };
  const far = onLane(tEnd);
  const chord = Math.hypot(far.x - p0.x, far.y - p0.y) || 1;
  const h = chord / 3;
  const aheadDeg = approachDeg(from, ahead, size, laneOff);
  // OUT of the stall along the heading the car is REALLY standing at — one
  // answer, `parkedHeadingDeg`, shared with the entry curve. Asking the question
  // twice is what put a 180° spin on every kerbside car that had backed in.
  const outDeg = parkedHeadingDeg(row.kind, pose.angleDeg, enteredReverse);
  const outRad = (outDeg * Math.PI) / 180;
  const laneRad = (aheadDeg * Math.PI) / 180;
  const legs: ManoeuvreLeg[] = [
    {
      p0,
      c1: { x: p0.x + Math.cos(outRad) * h, y: p0.y + Math.sin(outRad) * h },
      c2: { x: far.x - Math.cos(laneRad) * h, y: far.y - Math.sin(laneRad) * h },
      p3: far,
      reverse: false,
    },
  ];
  return finishPath(legs, aheadDeg, size);
}

// Where along its exit approach a vehicle rejoins the road — the progress its
// path is re-seeded at, so it carries on from where it really is. Takes the same
// `kerbPx` as the path: the run depends on how far out the bay sits, and a second
// answer here would re-seat the car somewhere its curve never reached.
export function forwardExitEndT(
  row: ParkingRow,
  index: number,
  size: number,
  kerbPx: number,
  maxT = 0.999,
): number {
  const { pose } = exitStall(row, index, size, kerbPx);
  return forwardExitEnd(row, pose, size, kerbPx, maxT);
}

// How finely the manoeuvre curve is measured. 16 chords over a ~50px swing puts
// the arc-length error well under a pixel — far below anything visible, and the
// table is built once per stall, not per tick.
const MANOEUVRE_SAMPLES = 16;

function bezierAt(leg: ManoeuvreLeg, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * leg.p0.x + b * leg.c1.x + c * leg.c2.x + d * leg.p3.x,
    y: a * leg.p0.y + b * leg.c1.y + c * leg.c2.y + d * leg.p3.y,
  };
}

function bezierTangent(leg: ManoeuvreLeg, t: number): { dx: number; dy: number } {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  let dx = a * (leg.c1.x - leg.p0.x) + b * (leg.c2.x - leg.c1.x) + c * (leg.p3.x - leg.c2.x);
  let dy = a * (leg.c1.y - leg.p0.y) + b * (leg.c2.y - leg.c1.y) + c * (leg.p3.y - leg.c2.y);
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    dx = leg.p3.x - leg.p0.x;
    dy = leg.p3.y - leg.p0.y;
  }
  return { dx, dy };
}

// Cumulative arc length across every leg, end to end. One table for the whole
// manoeuvre is what lets `m` be a single 0..1 the phase machine can advance
// without knowing where the direction changes.
function buildArcTable(legs: ManoeuvreLeg[]): number[] {
  const arc = [0];
  for (const leg of legs) {
    let prev = bezierAt(leg, 0);
    for (let i = 1; i <= MANOEUVRE_SAMPLES; i++) {
      const p = bezierAt(leg, i / MANOEUVRE_SAMPLES);
      arc.push(arc[arc.length - 1] + Math.hypot(p.x - prev.x, p.y - prev.y));
      prev = p;
    }
  }
  return arc;
}

// Total driven length of the manoeuvre, in the units the path was built in.
export function manoeuvreLength(path: ManoeuvrePath): number {
  return path.arc[path.arc.length - 1] ?? 0;
}

// Is the stretch of the manoeuvre at `m` driven BACKWARDS? Per leg, because a
// manoeuvre changes direction halfway through and the two halves are not driven
// at the same speed — see `REVERSE_PACE`.
export function reverseAt(path: ManoeuvrePath, m: number): boolean {
  return locate(path, m).leg.reverse;
}

// Clamp a step `mFrom → mTo` at the first leg boundary where the driving
// DIRECTION flips. Without this, the one tick that straddles the join is driven
// at the speed of the leg it started in — which for a pull-past-then-reverse
// manoeuvre means one tick of BACKING at the forward pace, 1.5× the base crawl
// on a kerbside bay. Rare (one tick per manoeuvre) but exactly what a p95 over
// the rendered backing speeds catches. Landing exactly ON the boundary also
// means the caller's flag probe (taken a hair past the current `m`) always
// reads the leg actually being traversed.
export function clampToDirectionChange(
  path: ManoeuvrePath,
  mFrom: number,
  mTo: number,
): number {
  const total = manoeuvreLength(path);
  if (total <= 0 || path.legs.length < 2) return mTo;
  const lo = Math.min(mFrom, mTo);
  const hi = Math.max(mFrom, mTo);
  for (let i = 0; i < path.legs.length - 1; i++) {
    if (path.legs[i]!.reverse === path.legs[i + 1]!.reverse) continue;
    const b = path.arc[(i + 1) * MANOEUVRE_SAMPLES]! / total;
    if (b > lo + 1e-9 && b < hi - 1e-9) return b;
  }
  return mTo;
}

// The speed a car drives BACKWARDS at, as a fraction of the base parking crawl —
// ABSOLUTE, never scaled by `pace`. That distinction is the whole lesson here:
// `pace` speeds a manoeuvre up in proportion to its length so gentler curves take
// the same TIME, and a reverse is the one motion that must not inherit that — a
// longer reverse is harder, not gentler. The first ship of this constant was a
// multiplier on the pace-scaled speed, and the two cancelled: the pivot-reverse
// path is long (pace ≈ 3–4), so cars backed into 90° bays at up to TWICE the
// crawl they nose in at, and the echelon back-out overtook its own pull-in.
//
// The trade is with THROUGHPUT — a slower reverse holds the aisle longer — so
// the value was measured, not picked: see KNOWHOW → PARKING for the sweep.
export const REVERSE_PACE = 0.75;

// Which leg, and how far along it, a fraction `m` of the TOTAL arc length lands
// on. This is what makes `m` mean distance rather than curve parameter.
function locate(path: ManoeuvrePath, m: number): { leg: ManoeuvreLeg; t: number } {
  const legs = path.legs;
  const total = manoeuvreLength(path);
  const last = legs[legs.length - 1]!;
  if (total <= 0) return { leg: last, t: Math.max(0, Math.min(1, m)) };
  const want = Math.max(0, Math.min(1, m)) * total;
  const arc = path.arc;
  for (let i = 1; i < arc.length; i++) {
    if (arc[i]! >= want) {
      const span = arc[i]! - arc[i - 1]!;
      const frac = span > 0 ? (want - arc[i - 1]!) / span : 0;
      // `i-1` counts sample steps across the whole table; MANOEUVRE_SAMPLES of
      // them belong to each leg in order.
      const step = i - 1;
      const legIndex = Math.min(legs.length - 1, Math.floor(step / MANOEUVRE_SAMPLES));
      const within = step - legIndex * MANOEUVRE_SAMPLES;
      return { leg: legs[legIndex]!, t: (within + frac) / MANOEUVRE_SAMPLES };
    }
  }
  return { leg: last, t: 1 };
}

// Point + heading at `m` (0..1) of the manoeuvre's arc length. `m = 0` is where
// the car set off, `m = 1` is where it comes to rest.
export function manoeuvreAt(
  path: ManoeuvrePath,
  m: number,
): { x: number; y: number; angleDeg: number } {
  const { leg, t } = locate(path, m);
  const { x, y } = bezierAt(leg, t);
  const { dx, dy } = bezierTangent(leg, t);
  // THE TANGENT IS THE HEADING — and on a REVERSING leg it is the tangent turned
  // round, because the car moves along the curve while pointing the other way.
  // Nothing is blended and nothing is imposed: the curve already arrives pointing
  // where the car has to end up. That blend was the single thing that made this
  // read as an animation next to the rest of the traffic model, where a lane
  // change sets no angle at all and lets the body lag produce it.
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { x, y, angleDeg: leg.reverse ? deg + 180 : deg };
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
export function validateParking(
  level: Level,
  tileSize = 200,
  // The map's extents. Needed only by the "a car park must have a way out" check,
  // which cannot otherwise tell a dead-end aisle from a street that simply runs
  // off the edge of the world — and a kerbside bay on the last tile of a border
  // street is perfectly fine. Omitted, that one check is skipped rather than
  // guessed at.
  grid?: { cols: number; rows: number },
): ParkingIssue[] {
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
      const max = maxStallsPerTile(row.kind, tileSize, needsBigBay(row.reserved));
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
      const big = needsBigBay(row.reserved);
      const outer =
        bayNearPx(row, tileSize, kerb) + stallDepthPx(row.kind, tileSize, big);
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
      //
      // A HALT is exempt, and not as a loophole: standing in the running lane is
      // what it is FOR, and the sim knows it (`stallOnLane` keeps the halted bus's
      // road body so the queue behind it is real). The rule this check enforces is
      // "a vehicle that has left the carriageway must actually have left it" — a
      // halt never claims to.
      if (
        row.kind !== "garage" &&
        !stallOnLane(row.kind) &&
        stallDepthPx(row.kind, tileSize, big) < 0.5 * LANE_WIDTH_FRAC * tileSize
      ) {
        add(tileId, `${row.kind} bays are too shallow to keep a parked car clear of the lane`);
      }
      // An UNMARKED rank only means something on a kerbside row: a street you
      // park along. Strip the bay lines off an echelon or 90° rank and it does
      // not read as an unmarked street, it reads as a car park nobody finished
      // painting — the cars sit in a herringbone with no lines to explain why.
      //
      // A PRIVATE DRIVE is the exception, and it is not a loophole: what makes
      // an unmarked public rank unreadable is that nothing explains why the
      // spaces are where they are, and a drive has the house standing behind it
      // saying exactly that. Nobody paints bay lines on their own hardstanding.
      if (row.marking === "none" && row.kind !== "parallel" && !row.resident) {
        add(tileId, `an unmarked parking row only reads as a street on "parallel" bays, not "${row.kind}"`);
      }
      // A HALT CANNOT BE PRIVATE. A `busstop` is a length of the carriageway
      // itself — the vehicle never leaves the lane — so "this stretch of road is
      // that house's" is not a thing the model can mean, and the queue that
      // forms behind a halted vehicle would be forming for a parked car.
      if (row.resident && stallOnLane(row.kind)) {
        add(tileId, `a private drive cannot be a "${row.kind}" — that is a halt on the carriageway`);
      }
    }
  }

  // Every car park must lead BACK to the road network. A one-way aisle that stops
  // is a car trap: there is no U-turn in the lane model (`roadExitPort` never
  // returns the entry port), so a car that drives into one either reaches a dead
  // end and despawns between the rows of stalls, or circles a pocket it cannot
  // leave. The sim already refuses to spawn or route to openings inside a car
  // park; this is the other half — proving the way out exists.
  if (grid) {
    for (const f of facilitiesOf(level)) {
      if (!facilityHasWayOut(level, f, grid)) {
        add([...f.tileIds].sort()[0], `car park "${f.label}" has no way back to the road network`);
      }
    }
  }
  return issues;
}

// Can a car driving anywhere in `f` reach a tile outside the facility, or the map
// edge? A flood fill over the road port-graph from every access state.
function facilityHasWayOut(
  level: Level,
  f: ParkingFacility,
  grid: { cols: number; rows: number },
): boolean {
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
      // Driving off the EDGE OF THE MAP is a real way out — that is how every
      // car leaves. Running into a hole in the middle of the map is not: it is
      // the dead end itself, and the sim refuses to route a car to an opening
      // inside a car park precisely so nobody drives into one and evaporates
      // between the rows of stalls. Only the grid can tell the two apart.
      const offGrid = n.x < 0 || n.y < 0 || n.x >= grid.cols || n.y >= grid.rows;
      if (offGrid) return true;
      if (!nCell?.road?.length) continue;
      if (!f.tileIds.has(nId)) return true; // reached ordinary street
      queue.push({ coord: n, entry: oppositePort(exit) });
    }
  }
  return false;
}
