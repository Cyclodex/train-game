import { Position } from "@/types";
import { TestScenario, mkLineTrain, railRing } from "@/levels/test/scenario";
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
    // The rail: a compact ring the train works for ever, with its platform on
    // the SOUTH side — a short walk from the kerb, which is the whole point.
    // One depot, on a spur: where the train came from, never where it is going.
    ...railRing(1, 0, 4, 1),
    "2,1": { connections: [[Position.Left, Position.Right]], role: "station" },
    // The OTHER end of the journey. Passengers ask for a destination now, so a
    // one-station board is one nobody travels from — there is nowhere to go.
    "3,0": { connections: [[Position.Left, Position.Right]], role: "station" },
    "0,1": expandKind("depot", 1),
    "1,1": {
      connections: [
        [Position.Top, Position.Right], // the ring's corner
        [Position.Left, Position.Top], // out of the shed, onto the ring
        [Position.Left, Position.Right],
      ],
    },
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
    train1: mkLineTrain("train1", 0, 1, "people", 2, ["2,1", "3,0"]),
  },
  colors: {
    depotColors: { "0,1": "blue" },
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
