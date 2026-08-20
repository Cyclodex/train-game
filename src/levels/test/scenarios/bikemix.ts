import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { twoWay } from "@/tiles/lanes";

// Bikes in MIXED TRAFFIC on a single-lane street — phase A of the bicycle plan.
// A bike cruises at under half car pace (KIND_SPEED in sim/road.ts), and with
// one lane per direction there is nowhere to pass: every car that catches one
// queues behind it at bike pace. That friction is deliberate — it is the
// player's incentive to paint a cycle lane (see the `cyclelane` scenario, the
// same street with the remedy applied).

const street = (): Level[string] => ({
  connections: [],
  road: twoWay(Position.Left, Position.Right),
});

export const bikemix: TestScenario = {
  id: "bikemix",
  name: "Bikes in mixed traffic (1 lane)",
  description:
    "A single-lane-each-way street with bikes in the traffic mix. A bike rides " +
    "at under half car speed and the lane offers no way past, so cars bunch into " +
    "a queue behind each one — the pressure a cycle lane exists to relieve.",
  level: {
    "0,1": street(),
    "1,1": street(),
    "2,1": street(),
    "3,1": street(),
    "4,1": street(),
    "5,1": street(),
  },
  trains: {},
  size: { cols: 6, rows: 3 },
  traffic: { spawnInterval: 0.9, maxCars: 10, mix: { car: 1, bike: 0.6 } },
};
