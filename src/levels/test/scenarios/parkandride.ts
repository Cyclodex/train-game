import { Position } from "@/types";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { expandKind } from "@/tiles/kinds";
import { nWayLanes } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";

// PARK & RIDE — the first intermodal edge: road traffic feeds rail.
//
// A street with kerbside bays runs two tiles from a station. Every car that
// takes a bay within the station's walking reach puts its occupant on the
// platform (watch the crowd tick up the moment a car swings into the kerb);
// the train calls, boards them, and carries them up the line. The station has
// no town around it, so almost every waiting passenger arrived BY CAR — the
// crowd is the traffic, made visible.
const bays = (from: Position): ParkingRow => ({
  from,
  kind: "parallel",
  count: 3,
});

const street = () => ({
  connections: [],
  road: nWayLanes(Position.Left, Position.Right, 2),
});

export const parkandride: TestScenario = {
  id: "parkandride",
  name: "Park & ride",
  description:
    "Cars park by the kerb, their drivers walk to the platform, the train picks them up.",
  level: {
    // The rail line, station in the middle.
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("station", 1),
    "3,0": expandKind("straight", 1),
    "4,0": expandKind("depot", 3),
    // The street, one block south, with bays inside the station's reach.
    "0,2": street(),
    "1,2": {
      ...street(),
      parking: {
        facility: "pr",
        label: "P+R Bahnhof",
        // Kerbside churn: cars come and go, each arrival a passenger.
        dwellSec: [10, 22],
        rows: [bays(Position.Left), bays(Position.Right)],
      },
    },
    "2,2": {
      ...street(),
      parking: {
        facility: "pr",
        rows: [bays(Position.Left), bays(Position.Right)],
      },
    },
    "3,2": street(),
    "4,2": street(),
  },
  trains: {
    train1: mkTrain("train1", 0, 0, "people", 2, "4,0"),
  },
  colors: {
    depotColors: {
      "0,0": "blue",
      "4,0": "green",
    },
    trainColors: {
      train1: "green",
    },
  },
  size: { cols: 5, rows: 3 },
  traffic: { spawnInterval: 1.1, maxCars: 10 },
};
