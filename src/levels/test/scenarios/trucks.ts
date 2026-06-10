import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// Cargo trucks: the three road-vehicle kinds — a car, a longer rigid truck, and
// an articulated cab + trailer semi — driving curves and crossing a junction.
//
// Two one-way streams enter from the left edge and exit off the top:
//  • Stream A (row y=2) runs east through a 4-way junction at (2,2), then curves
//    north at (4,2) and leaves the top.
//  • Stream B (row y=4) runs east, curves north at (2,4), climbs into the same
//    junction from the south, and leaves the top.
// The two curves let you watch a semi's trailer swing through the bend behind its
// cab (articulated, like a train consist). Where the streams cross at (2,2) they
// take turns: a long trailer straddling the junction keeps the other stream out
// until the whole rig is clear (full-body occupancy, not just the cab/tail). The
// mix is weighted toward trucks and semis so all three lengths are on show. No
// rail, so the scenario has no trains.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });

export const trucks: TestScenario = {
  id: "trucks",
  name: "Cargo trucks",
  description:
    "Cars, longer rigid trucks, and articulated cab + trailer semis drive through curves and take turns across a junction; a trailer blocks the crossing until it clears.",
  level: {
    // Stream A — horizontal eastbound, curving north after the junction.
    "0,2": road([Position.Left, Position.Right]), // left entry (eastbound)
    "1,2": road([Position.Left, Position.Right]),
    "2,2": road([Position.Left, Position.Right], [Position.Top, Position.Bottom]), // junction
    "3,2": road([Position.Left, Position.Right]),
    "4,2": road([Position.Left, Position.Top]), // curve: turn north
    "4,1": road([Position.Top, Position.Bottom]),
    "4,0": road([Position.Top, Position.Bottom]), // exit north (top edge)
    // Stream B — enters lower-left, curves north into the junction from the south.
    "0,4": road([Position.Left, Position.Right]), // left entry
    "1,4": road([Position.Left, Position.Right]),
    "2,4": road([Position.Left, Position.Top]), // curve: turn north
    "2,3": road([Position.Top, Position.Bottom]),
    "2,1": road([Position.Top, Position.Bottom]),
    "2,0": road([Position.Top, Position.Bottom]), // exit north (top edge)
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  // Heavy on the big rigs so the longer kinds are the stars of this scenario, and
  // a brisk spawn so the approaches stay queued.
  traffic: {
    mix: { car: 1, truck: 2, semi: 2 },
    spawnInterval: 1.2,
    maxCars: 10,
  },
};
