// Lane-offset geometry shared by the renderer (game.ts) and the road simulation
// (road.ts).
//
// A road vehicle drives the tile centreline pushed sideways (right-of-travel) by
// a lateral offset that follows the painted lane markings: a seam taper on a
// straight, the highway left-align on a one-way road, the corner-fillet glide on
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
  isRoadJunction,
  isOneWayStraight,
  oneWayRunMax,
  junctionExitOffsetPx,
  turnSeamBand,
  VehicleClass,
} from "@/tiles/lanes";
import {
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
    // One-way STRAIGHT: highway lane drop. Left-align to the run's widest count so
    // the through lanes are dead straight and the right lane ends.
    if (exit !== null && exit === oppositePort(entry) && isOneWayStraightAt(s.coord, entry)) {
      const off = oneWayLaneOffsetPx(lanePos, oneWayRunMaxAt(s.coord, entry), tileSize);
      return { offEntry: off, offExit: off };
    }
    const selfBand = centeredBandAt(s.coord, entry);
    // Bidirectional straight tile: taper the band from the entry seam to the exit
    // seam so a continuing lane glides as the kerb shifts.
    if (exit !== null && exit === oppositePort(entry)) {
      return {
        offEntry: laneSeamOffsetPx(lanePos, selfBand, positioningBandAt(s.coord, entry), tileSize),
        offExit: laneSeamOffsetPx(lanePos, selfBand, positioningBandAt(s.coord, exit), tileSize),
      };
    }
    // Curve / junction: a uniform straight-through curve keeps a constant offset
    // (offEntry === offExit), but a TURN onto a different arm eases to the lane it
    // lands in on the exit arm. Dead-end / map edge → hold the approach offset.
    const offEntry = laneOffsetConstPx(lanePos, positioningBandAt(s.coord, entry), tileSize);
    if (exit === null) return { offEntry, offExit: offEntry };
    const offExit = turnExitOffsetPx(s.coord, entry, exit, lanePos, cls);
    return { offEntry, offExit: offExit ?? offEntry };
  }

  return { couplerOffsets, turnExitOffsetPx, oneWayRunMaxAt };
}

export type LaneGeometry = ReturnType<typeof createLaneGeometry>;
