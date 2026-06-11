import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Overtake gap-acceptance / graceful abort on a SHORT 2-lane-each-way straight.
// The road is deliberately stubby and packed busy with a wide speed spread and
// every driver an overtaker, so a car that pulls into the inner lane to pass a
// slow leader frequently finds the gap close on it — another slow car already in
// the inner lane ahead. A correct sim then ABORTS the pass: before it has drawn
// level with the leader it eases back to the kerb lane instead of completing a
// marginal manoeuvre, and it never snaps its lateral position or overlaps a body.
//
// One direction only (eastbound from the Left edge) so the demo reads as a single
// stream jockeying for the inner lane rather than two streams passing.

const lane2 = (): Level[string] => ({
  connections: [],
  road: nWayLanes(Position.Left, Position.Right, 2),
});

export const overtakeabort: TestScenario = {
  id: "overtakeabort",
  name: "Overtake abort (gap closes)",
  description:
    "A short, busy 2-lane-each-way straight. Impatient drivers pull into the inner " +
    "lane to pass a slow leader, but the inner lane is often blocked ahead — so the " +
    "pass aborts: the car eases back to the kerb lane before drawing level, without " +
    "snapping or overlapping.",
  level: {
    "0,1": lane2(),
    "1,1": lane2(),
    "2,1": lane2(),
    "3,1": lane2(),
  },
  trains: {},
  size: { cols: 4, rows: 3 },
  traffic: {
    spawnInterval: 0.5,
    maxCars: 8,
    overtakeFraction: 1,
    // Eastbound only, so the demo is a single jostling stream.
    spawnEntries: [{ coord: { x: 0, y: 1 }, entryPort: Position.Left }],
  },
};
