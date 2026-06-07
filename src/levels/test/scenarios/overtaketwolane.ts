import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Same-direction overtaking on a 2-lane-per-direction straight road. Cars spawn
// with a spread of cruise speeds; a faster, impatient "overtaker" stuck behind a
// slow leader pulls into the inner (left) lane to pass, then returns to the kerb
// lane — while disciplined drivers just follow. There are no junctions or lane
// drops, so any time a car rides the inner lane it is overtaking. `overtakeFraction`
// is turned up so the behaviour is easy to watch.

const lane2 = (): Level[string] => ({
  connections: [],
  road: nWayLanes(Position.Left, Position.Right, 2),
});

export const overtaketwolane: TestScenario = {
  id: "overtaketwolane",
  name: "Overtaking (2-lane, same direction)",
  description:
    "A 2-lane-each-way straight road. Faster, impatient drivers pull into the " +
    "inner lane to pass a slow leader, then return; disciplined drivers stay in lane.",
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
  traffic: { spawnInterval: 0.9, maxCars: 10, overtakeFraction: 0.8 },
};
