import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { twoWay } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";

// THE BIKE RACK — phase C of the bicycle plan: where a bike stops being traffic.
//
// One street, two kinds of parking side by side. Mid-block a rank of hoops (the
// rack) and further on a rank of kerbside car bays — and the classes never mix:
// a bike is walked into a stand (no pull-in manoeuvre, the lane is free the
// moment the rider dismounts) and never takes a car bay, however easily it
// would fit; a car queues for its kerb bay and never touches the rack. Watch
// the two signs count their own kinds: 🚲 at the rack, P at the bays.

const street = (): Level[string] => ({
  connections: [],
  road: twoWay(Position.Left, Position.Right),
});

const rack = (from: Position): ParkingRow => ({
  from,
  kind: "bikerack",
  count: 6,
});

const bays = (from: Position): ParkingRow => ({
  from,
  kind: "parallel",
  count: 3,
});

export const bikerack: TestScenario = {
  id: "bikerack",
  name: "Bike rack",
  description:
    "A rank of hoops beside the kerb. Bikes are walked in — no manoeuvre, the " +
    "lane frees instantly — and only bikes: the car bays further on take the " +
    "cars, and neither kind ever takes the other's space.",
  level: {
    "0,1": street(),
    "1,1": street(),
    "2,1": {
      ...street(),
      parking: {
        facility: "rack",
        label: "Velo",
        // Rack churn: riders come and go, so the walk-in/walk-out cycle shows.
        dwellSec: [8, 18],
        rows: [rack(Position.Left), rack(Position.Right)],
      },
    },
    "3,1": street(),
    "4,1": {
      ...street(),
      parking: {
        facility: "kerb",
        label: "Kerb",
        dwellSec: [10, 22],
        rows: [bays(Position.Left), bays(Position.Right)],
      },
    },
    "5,1": street(),
  },
  trains: {},
  size: { cols: 6, rows: 3 },
  traffic: { spawnInterval: 1.0, maxCars: 10, mix: { car: 1, bike: 1 } },
};
