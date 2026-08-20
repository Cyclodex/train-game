import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Cars overtake bikes the moment a second lane exists. The overtake trigger is
// purely speed-differential (considerOvertake in sim/road.ts), and a bike's
// 0.45× cruise trips it immediately — no bike-specific passing code exists.
// The bike itself never overtakes (the bus rule) and keeps to the kerb lane,
// so on this 2-lane road the inner lane is a steady stream of cars pulling
// past bikes and returning to the kerb.

const lane2 = (): Level[string] => ({
  connections: [],
  road: nWayLanes(Position.Left, Position.Right, 2),
});

export const bikeovertake: TestScenario = {
  id: "bikeovertake",
  name: "Overtaking bikes (2 lanes)",
  description:
    "A 2-lane-each-way road with bikes in the mix. The existing speed-" +
    "differential overtaking passes them with no bike-specific code: cars pull " +
    "inner, pass, return to the kerb; the bikes hold their lane and never pass anyone.",
  level: {
    "0,1": lane2(),
    "1,1": lane2(),
    "2,1": lane2(),
    "3,1": lane2(),
    "4,1": lane2(),
    "5,1": lane2(),
  },
  trains: {},
  size: { cols: 6, rows: 3 },
  traffic: { spawnInterval: 0.9, maxCars: 10, overtakeFraction: 0.8, mix: { car: 1, bike: 0.5 } },
};
