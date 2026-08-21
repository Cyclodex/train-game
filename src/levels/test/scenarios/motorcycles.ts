import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Bike vs MOTORCYCLE on a 2-lane street. The two kinds split what the old
// "bike" was: the velo is the slow sliver that never overtakes and never
// touches an inner lane; the motorcycle is a fast, narrow car (class "car") —
// it rides any lane, closes on queues at 1.15× car pace and uses the
// overtaking lane the bike must never enter. Watch the kerb lane: bikes hold
// it while motorcycles (and cars) pull inner to pass.

const { Left: L, Right: R } = Position;

const lane2 = (): Level[string] => ({
  connections: [],
  road: nWayLanes(L, R, 2),
});

export const motorcycles: TestScenario = {
  id: "motorcycles",
  name: "Motorcycles vs bikes (2 lanes)",
  description:
    "A 2-lane street with bikes AND motorcycles in the mix. The bike holds the " +
    "kerb lane and never passes anyone; the motorcycle is a fast, narrow car — " +
    "it overtakes via the inner lane the bike must never touch.",
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
  traffic: {
    spawnInterval: 0.9,
    maxCars: 10,
    overtakeFraction: 0.9,
    mix: { car: 0.6, bike: 0.5, motorcycle: 1 },
  },
};
