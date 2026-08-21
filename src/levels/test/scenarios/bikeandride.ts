import { Position } from "@/types";
import { TestScenario, mkLineTrain, railRing } from "@/levels/test/scenario";
import { expandKind } from "@/tiles/kinds";
import { nWayLanes } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";

// BIKE & RIDE — the rack at the station turns cyclists into rail passengers.
//
// The park-and-ride scenario's sibling, with the car bays swapped for a rank of
// hoops. Every bike racked within the station's walking reach puts its rider on
// the platform (the crowd ticks up by one the moment a bike is wheeled in); the
// train calls, boards them, and carries them up the line. Cars are in the mix
// too and drive straight through — there is nowhere for a CAR to park here, and
// the class gate is exactly why: a rack qualifies a station for bike-and-ride
// without making it a car P+R.
const racks = (from: Position): ParkingRow => ({
  from,
  kind: "bikerack",
  count: 12,
});

const street = () => ({
  connections: [],
  road: nWayLanes(Position.Left, Position.Right, 2),
});

export const bikeandride: TestScenario = {
  id: "bikeandride",
  name: "Bike & ride",
  description:
    "Bikes rack up beside the station, their riders walk to the platform, the " +
    "train picks them up. Cars pass straight through — the rack is not theirs.",
  level: {
    // The rail: the same compact ring as park & ride, platform on the SOUTH
    // side — a short walk from the rack, which is the whole point.
    ...railRing(1, 0, 4, 1),
    "2,1": { connections: [[Position.Left, Position.Right]], role: "station" },
    // The other end of the journey, so the platform crowd has somewhere to go.
    "3,0": { connections: [[Position.Left, Position.Right]], role: "station" },
    "0,1": expandKind("depot", 1),
    "1,1": {
      connections: [
        [Position.Top, Position.Right], // the ring's corner
        [Position.Left, Position.Top], // out of the shed, onto the ring
        [Position.Left, Position.Right],
      ],
    },
    // The street, one block south, with the rack inside the station's reach.
    "0,2": street(),
    "1,2": street(),
    "2,2": {
      ...street(),
      parking: {
        facility: "br",
        label: "B+R Bahnhof",
        // Rack churn: riders come and go, each arrival a passenger.
        dwellSec: [10, 22],
        rows: [racks(Position.Left), racks(Position.Right)],
      },
    },
    "3,2": street(),
    "4,2": street(),
  },
  trains: {
    train1: mkLineTrain("train1", 0, 1, "people", 2, ["2,1", "3,0"]),
  },
  colors: {
    depotColors: { "0,1": "blue" },
    trainColors: {
      train1: "green",
    },
  },
  size: { cols: 5, rows: 3 },
  traffic: { spawnInterval: 1.0, maxCars: 10, mix: { car: 1, bike: 1 } },
};
