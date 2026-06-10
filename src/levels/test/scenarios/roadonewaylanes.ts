import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { oneWayLanes } from "@/tiles/lanes";

// One-way roads that change lane count along their length. Unlike the two-way
// `roadlanemerge` geometry gallery (where inner lanes render but stay empty
// because traffic rides the kerb lane), these are ONE-WAY, so the sim actually
// fills every lane at the wide end and must merge across as the road narrows —
// which is what exercises the lane connections at each width seam.
//
// Two rows, the transition run both ways, each width held for >=2 tiles so a
// run of equal-width tiles sits next to each other (the case the user wants
// inspected):
//
//   row 1 (y=1):  1 1 · 2 2 · 3 3   widen   (1l -> 2l -> 3l, eastbound)
//   row 2 (y=3):  3 3 · 2 2 · 1 1   narrow  (3l -> 2l -> 1l, eastbound)
//
// Cars spawn only at each road's open west edge (the east edge has no inbound
// lane, since every lane is Left->Right), so traffic flows strictly east and the
// narrowing row forces a genuine multi-lane merge.

// A horizontal one-way (Left->Right) road along row `y`, one tile per entry in
// `counts`, with that many lanes. x = 0..counts.length-1.
function row(y: number, counts: number[]): Level {
  const out: Level = {};
  counts.forEach((count, x) => {
    out[`${x},${y}`] = {
      connections: [],
      road: oneWayLanes(Position.Left, Position.Right, count),
    };
  });
  return out;
}

const COLS = 6;

export const roadonewaylanes: TestScenario = {
  id: "roadonewaylanes",
  name: "One-way road: lane-count changes",
  description:
    "Two one-way (eastbound) roads that change width along their length: 1→2→3 lanes (widening) and 3→2→1 lanes (narrowing), each width held for two tiles. Cars spawn only at the open west edge, so every lane fills at the wide end and must merge across as the road narrows — exercising the lane connections at each seam.",
  level: {
    ...row(1, [1, 1, 2, 2, 3, 3]), // widen:  1l -> 2l -> 3l
    ...row(3, [3, 3, 2, 2, 1, 1]), // narrow: 3l -> 2l -> 1l
  },
  trains: {},
  size: { cols: COLS, rows: 5 },
  traffic: {
    spawnInterval: 0.5,
    maxCars: 20,
  },
};
