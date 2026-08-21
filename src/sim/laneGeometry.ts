// Lane-offset geometry shared by the renderer (game.ts) and the road simulation
// (road.ts).
//
// A road vehicle drives the tile centreline pushed sideways (right-of-travel) by
// a lateral offset that follows the painted lane markings: a seam taper on a
// straight, the highway kerb-anchor on a one-way road, the corner-fillet glide on
// a turn. The renderer positions each car body on that offset path; the sim must
// know the SAME offset to measure the real driven length of a segment (so a car
// holds a constant world speed across straights and turns, and a semi's cab and
// trailer keep a constant gap through a bend — see issues #36 / #37). Extracting
// the offset math here — Vue-free, `level`-parameterised — lets both layers share
// one source of truth instead of the sim re-deriving (and drifting from) it.

import { Coordinates } from "@/types";
import { Level } from "@/tiles/model";
import {
  laneCount,
  laneCountAt,
  bikeLaneIndices,
  isRoadJunction,
  isOneWayStraight,
  oneWayRunMax,
  junctionExitOffsetPx,
  turnSeamBand,
  VehicleClass,
} from "@/tiles/lanes";
import {
  LANE_WIDTH_FRAC,
  laneSeamOffsetPx,
  laneOffsetConstPx,
  oneWayLaneOffsetPx,
  seamPositioningBand,
} from "./laneOffset";
import { neighborCoord, oppositePort, Port } from "./topology";
import { getCoordinatesId } from "@/utils/tileHelpers";

// The minimal sample shape couplerOffsets reads: the tile the coupler sits on,
// the ports it entered/leaves through, and its continuous lateral lane position.
// A structural subset of road.ts's CarSample, declared here so this module has no
// import cycle with road.ts.
export interface LaneSample {
  coord: Coordinates;
  entryPort: Port;
  exitPort: Port | null;
  lanePos?: number;
}

export interface LaneOffsets {
  offEntry: number; // lateral offset (right-of-travel) at the entry seam
  offExit: number; // lateral offset at the exit seam
}

// A bundle of `level`-aware lane-offset helpers. The renderer builds one with the
// pixel `tileSize`; the sim builds one with `tileSize = 1` so the offsets come out
// in tile units (the same units its segment lengths use).
export function createLaneGeometry(level: Level, tileSize: number) {
  // The same-direction lane band of the road tile at `coord` entered via `port`
  // (0 if there is no road / no lanes from that port).
  function bandAt(coord: Coordinates, port: Port): number {
    return laneCount(level[getCoordinatesId(coord)]?.road, port);
  }

  // The lane-positioning band a car drives in: half the lanes physically crossing
  // this port's boundary (both directions), so a car sits inside its own half of
  // the ribbon.
  function centeredBandAt(coord: Coordinates, port: Port): number {
    const road = level[getCoordinatesId(coord)]?.road;
    return laneCountAt(road, port) / 2;
  }

  function isOneWayStraightAt(coord: Coordinates, entry: Port): boolean {
    return isOneWayStraight(level[getCoordinatesId(coord)]?.road, entry);
  }

  function oneWayRunMaxAt(coord: Coordinates, entry: Port): number {
    return oneWayRunMax(c => level[getCoordinatesId(c)]?.road, coord, entry);
  }

  // How many lanes of a ONE-WAY run actually cross the `port` seam of the tile at
  // `coord`, whose own count is `local`: the narrower of the two sides, since the
  // dropping lane ends at the seam. A JUNCTION neighbour never pinches the run (it
  // adopts the road, matching roadSeamPaintTotal), and with no road neighbour at
  // all the run keeps its own width. Mirrors Tile.vue's one-way arrow taper.
  function oneWaySeamCount(coord: Coordinates, port: Port, local: number): number {
    const nb = neighborCoord(coord, port);
    if (!nb) return local;
    const nbRoad = level[getCoordinatesId(nb)]?.road;
    if (!nbRoad?.length || isRoadJunction(nbRoad)) return local;
    const crossing = laneCountAt(nbRoad, oppositePort(port));
    return crossing > 0 ? Math.min(local, crossing) : local;
  }

  // The junction-aware positioning band of the tile at `coord` where its `port`
  // seam meets the neighbour there (see sim/laneOffset.ts seamPositioningBand).
  function positioningBandAt(coord: Coordinates, port: Port): number {
    const selfBand = centeredBandAt(coord, port);
    const nb = neighborCoord(coord, port);
    if (!nb) return selfBand;
    return seamPositioningBand(
      selfBand,
      isRoadJunction(level[getCoordinatesId(coord)]?.road),
      centeredBandAt(nb, oppositePort(port)),
      isRoadJunction(level[getCoordinatesId(nb)]?.road),
    );
  }

  // The lateral offset a vehicle of class `cls` in approach lane `entryLane` should
  // arrive at on the EXIT arm of a TURN through `coord` (the lane it lands in on the
  // exit arm), so a turn onto a narrower/wider arm glides to a REAL lane instead of
  // holding the approach offset and snapping at the boundary. Null when the move has
  // no road exit arm (dead-end / map edge): the caller then holds the approach offset.
  function turnExitOffsetPx(
    coord: Coordinates,
    entry: Port,
    exit: Port,
    entryLane: number,
    cls: VehicleClass,
  ): number | null {
    const here = level[getCoordinatesId(coord)]?.road;
    const next = neighborCoord(coord, exit);
    if (!next) return null;
    const exitRoad = level[getCoordinatesId(next)]?.road;
    if (!exitRoad) return null;
    const exitApproach = oppositePort(exit);
    const exitBand = turnSeamBand(here, exit, exitRoad, exitApproach);
    if (exitBand <= 0) return null;
    return junctionExitOffsetPx(
      here,
      entry,
      entryLane,
      exit,
      exitRoad,
      exitApproach,
      exitBand,
      tileSize,
      cls,
    );
  }

  // A bike on a CYCLE lane rides the green strip, not the slot centre: the strip
  // is painted at HALF the lane width against the kerb (Tile.vue
  // restrictedLaneBands + roadGeometry's solid cycle edge), so the ride line
  // shifts a quarter-lane kerbward. A wide street's SHOULDER is the same
  // machinery minus the paint — the bike rides the edge zone's kerb half, cars
  // pass in their own lane. Scaled by the continuous lane position's proximity
  // to the bike's lane, so a merge onto / off the strip glides instead of
  // stepping sideways. Zero for every other vehicle class (nothing else may
  // enter a cycle lane or shoulder).
  function cycleStripShiftPx(
    coord: Coordinates,
    entry: Port,
    lanePos: number,
    cls: VehicleClass,
  ): number {
    if (cls !== "bike") return 0;
    const cycles = bikeLaneIndices(level[getCoordinatesId(coord)]?.road, entry);
    if (!cycles.length) return 0;
    const near = Math.max(...cycles.map(c => 1 - Math.min(1, Math.abs(lanePos - c))));
    return near * 0.25 * LANE_WIDTH_FRAC * tileSize;
  }

  // Seam-aware lateral offsets (right-of-travel) for one coupler: the offset at the
  // tile's entry seam and at its exit seam. The PATH between them is the shared lane
  // geometry (sim/pathGeometry.ts laneSegmentPointAt): a straight interpolates
  // linearly; a TURN follows the corner fillet of the two lane lines, easing from
  // the approach lane to the lane it lands in on the exit arm (turnExitOffsetPx).
  function couplerOffsets(
    s: LaneSample,
    fallbackLane: number,
    cls: VehicleClass,
  ): LaneOffsets {
    const lanePos = s.lanePos ?? fallbackLane;
    const entry = s.entryPort;
    const exit = s.exitPort;
    if (bandAt(s.coord, entry) <= 0) return { offEntry: 0, offExit: 0 };
    // One-way STRAIGHT: highway lane drop. Kerb-anchor (index 0) to the run's widest
    // count so the through lanes are dead straight and the centre lane ends.
    //
    // A SURVIVING lane is therefore run-constant — same offset on every tile of the
    // run, no seam taper. The DROPPING (centre-side) lane is the exception: it does
    // not exist past the seam, so a vehicle still in it has to be somewhere. Clamp
    // the lane at each seam to the lanes that actually cross it and the offsets at
    // the two ends differ, so the vehicle GLIDES into the last surviving lane over
    // the closing tile — which is what the painted gore and the debug arrow already
    // draw (Tile.vue's one-way branch clamps the arrow the same way). Without it a
    // car that hasn't finished its merge is carried to the seam in a lane that then
    // vanishes, and the index clamp on the far side teleports it a full lane
    // sideways in one tick.
    if (exit !== null && exit === oppositePort(entry) && isOneWayStraightAt(s.coord, entry)) {
      const runMax = oneWayRunMaxAt(s.coord, entry);
      const local = laneCount(level[getCoordinatesId(s.coord)]?.road, entry);
      const strip = cycleStripShiftPx(s.coord, entry, lanePos, cls);
      const at = (port: Port) =>
        oneWayLaneOffsetPx(
          Math.min(lanePos, Math.max(1, oneWaySeamCount(s.coord, port, local)) - 1),
          runMax,
          tileSize,
        ) + strip;
      return { offEntry: at(entry), offExit: at(exit) };
    }
    const selfBand = centeredBandAt(s.coord, entry);
    // Bidirectional straight tile: taper the band from the entry seam to the exit
    // seam so a continuing lane glides as the kerb shifts.
    //
    // A JUNCTION is excluded even when the movement runs straight through it
    // (exit === opposite(entry)). The taper branch anchors the lane index on the
    // tile's OWN band, and a junction's `laneCountAt` is not its arm's real width
    // — it tallies the movements that fan through the arm — so anchoring on it put
    // every inner through-lane half a lane off the road it came from, and the
    // clamp alone could not repair it. A junction's straight-through is just the
    // zero-degree case of a turn: sit on the entry ARM's road band, then glide to
    // the lane `junctionExitLane` lands the vehicle in on the exit arm (which is
    // also what the sim assigns on crossing the seam). That is the branch below.
    const hereIsJunction = isRoadJunction(level[getCoordinatesId(s.coord)]?.road);
    if (exit !== null && exit === oppositePort(entry) && !hereIsJunction) {
      const strip = cycleStripShiftPx(s.coord, entry, lanePos, cls);
      return {
        offEntry:
          laneSeamOffsetPx(lanePos, selfBand, positioningBandAt(s.coord, entry), tileSize) + strip,
        offExit:
          laneSeamOffsetPx(lanePos, selfBand, positioningBandAt(s.coord, exit), tileSize) + strip,
      };
    }
    // Curve / junction: sit on the entry arm's band, then ease to the lane the
    // vehicle lands in on the exit arm (turnExitOffsetPx). A uniform curve keeps a
    // constant offset (offEntry === offExit); a turn — or a straight-through a
    // junction whose arms differ in width — glides to its real exit lane instead
    // of holding the approach offset and snapping at the boundary.
    // Dead-end / map edge → hold the approach offset.
    const offEntry =
      laneOffsetConstPx(lanePos, positioningBandAt(s.coord, entry), tileSize) +
      cycleStripShiftPx(s.coord, entry, lanePos, cls);
    if (exit === null) return { offEntry, offExit: offEntry };
    const offExit = turnExitOffsetPx(s.coord, entry, exit, lanePos, cls);
    if (offExit === null) return { offEntry, offExit: offEntry };
    // A bike leaving a turn onto an arm that carries a cycle lane or shoulder
    // lands kerb-most — ON the half-width strip — so the exit offset carries the
    // same quarter-lane kerbward shift, keeping the glide continuous across the
    // seam (the next tile's entry offset includes it via cycleStripShiftPx).
    const next = neighborCoord(s.coord, exit);
    const exitStrip =
      cls === "bike" &&
      next &&
      bikeLaneIndices(level[getCoordinatesId(next)]?.road, oppositePort(exit)).length > 0
        ? 0.25 * LANE_WIDTH_FRAC * tileSize
        : 0;
    return { offEntry, offExit: offExit + exitStrip };
  }

  return { couplerOffsets, turnExitOffsetPx, oneWayRunMaxAt };
}

export type LaneGeometry = ReturnType<typeof createLaneGeometry>;
