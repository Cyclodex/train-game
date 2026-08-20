import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes, type Lane } from "@/tiles/lanes";

// The cycle lane's PAINT around a corner. `cyclelane` shows the mechanic on a
// dead-straight street; this one turns it 90°, where the three things that must
// agree are easiest to get wrong: the green tint, the solid white edge line half
// a lane in from the kerb, and the line the bike actually rides. All three are
// offset arcs on a bend, and the tint used to be skipped there entirely (edge
// line without tint — a bike lane that looked like it stopped at the corner).
//
// Both directions carry the lane, which is the only shape the road paint can
// express: the yellow centreline is painted at the ribbon MIDDLE, so it is the
// divider between the two streams only while they are equally wide (see
// tiles/editOps.ts addCycleLane — the 🚲 tool equips both ways in one click).

const { Left: L, Right: R, Top: T, Bottom: B } = Position;

// One car lane inboard of one kerb-side cycle lane, each way — exactly what the
// 🚲 tool lays on a 1-lane street.
const withCycle = (a: Position, b: Position): Lane[] => [
  ...nWayLanes(a, b, 1, "cycle"),
  { from: a, to: [b], index: 1 },
  { from: b, to: [a], index: 1 },
];

const street = (a: Position, b: Position): Level[string] => ({
  connections: [],
  road: withCycle(a, b),
});

export const cyclebend: TestScenario = {
  id: "cyclebend",
  name: "Cycle lane round a bend",
  description:
    "The cyclelane street, turned through 90°. Watch the corner: the green " +
    "tint, the solid white edge line and the riders all follow the same arc, " +
    "and the yellow centreline stays between the two directions because both " +
    "of them carry the lane.",
  level: {
    "0,0": street(L, R),
    "1,0": street(L, R),
    "2,0": street(L, B), // the bend: west arm ↔ south arm
    "2,1": street(T, B),
    "2,2": street(T, B),
  },
  trains: {},
  size: { cols: 3, rows: 3 },
  traffic: { spawnInterval: 0.9, maxCars: 8, mix: { car: 1, bike: 0.8 } },
};
