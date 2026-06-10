import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Multi-lane 4-way crossings at 1, 2 and 3 lanes per direction. A horizontal and
// a vertical two-way road cross at the centre; cars spawn from all four map edges
// and drive straight through. The point is to prove the junction arbiter keeps
// the perpendicular streams flowing through the centre at every lane count
// (parallel same-direction lanes cross together; conflicting perpendicular
// movements take turns) without ever locking into a four-way standstill.
//
// Straight-through only (no turns): turn-lane assignment is sub-project F, so
// these isolate the multi-lane crossing itself. Run the matching sim test in
// tests/unit/sim/road.spec.ts to confirm sustained throughput.

const H: [Position, Position] = [Position.Left, Position.Right];
const V: [Position, Position] = [Position.Top, Position.Bottom];

// A 5×5 cross whose every road carries `count` lanes per direction.
function crossLevel(count: number): Level {
  const arm = (a: Position, b: Position): Level[string] => ({
    connections: [],
    road: nWayLanes(a, b, count),
  });
  return {
    // Horizontal road (row y=2).
    "0,2": arm(...H),
    "1,2": arm(...H),
    "3,2": arm(...H),
    "4,2": arm(...H),
    // Vertical road (column x=2).
    "2,0": arm(...V),
    "2,1": arm(...V),
    "2,3": arm(...V),
    "2,4": arm(...V),
    // Centre: both roads pass straight through at full lane count.
    "2,2": {
      connections: [],
      road: [
        ...nWayLanes(Position.Left, Position.Right, count),
        ...nWayLanes(Position.Top, Position.Bottom, count),
      ],
    },
  };
}

function crossScenario(count: number): TestScenario {
  return {
    id: `roadcross${count}lane`,
    name: `Cross: ${count} lane${count > 1 ? "s" : ""} per direction`,
    description:
      `A 4-way crossing with ${count} lane(s) each way. Cars enter from all four ` +
      `edges and drive straight through; the arbiter serialises the conflicting ` +
      `perpendicular streams so the centre keeps clearing without gridlock.`,
    level: crossLevel(count),
    trains: {},
    size: { cols: 5, rows: 5 },
    // Busy enough to contend for the centre. (In the test stage the live "Cars"
    // slider overrides this; the figure here is the sim test's working density.)
    traffic: { spawnInterval: 0.5, maxCars: count * 6 + 4 },
  };
}

export const roadcross1lane = crossScenario(1);
export const roadcross2lane = crossScenario(2);
export const roadcross3lane = crossScenario(3);
