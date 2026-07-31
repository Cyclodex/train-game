import { Position } from "@/types";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { expandKind } from "@/tiles/kinds";
import { twoWay } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";

// BUS FEEDS RAIL — the second intermodal edge. A bus halt sits a short walk
// from the platform; every bus that stops there turns out a whole load of
// passengers (watch the crowd jump by a busload, against the single ticks the
// P+R cars make in /test/parkandride), and the train carries them away. The
// street mixes buses and cars, so the halt also shows its usual side effect:
// the cars queue behind a standing bus.
const street = () => ({
  connections: [],
  road: twoWay(Position.Left, Position.Right),
});

const halt = (from: Position): ParkingRow => ({
  from,
  kind: "busstop",
  count: 1,
});

export const busfeeder: TestScenario = {
  id: "busfeeder",
  name: "Bus feeds rail",
  description:
    "Every bus at the halt turns out a busload for the platform; the train carries them on.",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("station", 1),
    "3,0": expandKind("straight", 1),
    "4,0": expandKind("depot", 3),
    "0,2": street(),
    "1,2": street(),
    "2,2": {
      ...street(),
      parking: {
        facility: "halt",
        label: "Bus → Bahn",
        // A stop is a pause, not parking: doors, a moment, gone.
        dwellSec: [7, 14],
        rows: [halt(Position.Left)],
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
  traffic: {
    mix: { car: 1, bus: 1.1 },
    spawnInterval: 0.8,
    maxCars: 10,
  },
};
