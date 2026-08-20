import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes, turns } from "@/tiles/lanes";

// The router's ARTERIAL AVOIDANCE for bikes: a 3-lane street without a cycle
// lane is one a bike routes AROUND when it can (a soft penalty — with no
// alternative it holds the kerb lane). Here the direct west↔east run is a
// 3-lane arterial; a quiet 1-lane back street loops below it. Cars ride the
// arterial straight through; every bike dips down the side street and rejoins
// at the far junction. Paint a cycle lane on the arterial (🚲 in the editor)
// and bikes would use it instead.

const { Left: L, Right: R, Top: T, Bottom: B } = Position;

const arterial = (): Level[string] => ({
  connections: [],
  road: nWayLanes(L, R, 3),
});
const back = (a: Position, b: Position): Level[string] => ({
  connections: [],
  road: nWayLanes(a, b, 1),
});
// T-junction joining the 3-lane arterial (L↔R) to the 1-lane side street (B).
// Kerb lane turns right into it (eastbound), the inner lane left (westbound),
// the side street may join either way.
const tee = (): Level[string] => ({
  connections: [],
  road: [
    turns(L, [R, B], 0),
    turns(L, [R], 1),
    turns(L, [R], 2),
    turns(R, [L], 0),
    turns(R, [L], 1),
    turns(R, [L, B], 2),
    turns(B, [L, R], 0),
  ],
});

export const bikedetour: TestScenario = {
  id: "bikedetour",
  name: "Bikes avoid the arterial",
  description:
    "The direct route is a 3-lane arterial with no cycle lane; a 1-lane back " +
    "street loops below it. Cars go straight through — bikes route round via " +
    "the quiet street (a soft penalty: were it the only way, they'd hold the kerb).",
  level: {
    "0,1": arterial(),
    "1,1": tee(),
    "2,1": arterial(),
    "3,1": arterial(),
    "4,1": tee(),
    "5,1": arterial(),
    "1,2": back(T, B),
    "4,2": back(T, B),
    "1,3": back(T, R),
    "2,3": back(L, R),
    "3,3": back(L, R),
    "4,3": back(T, L),
  },
  trains: {},
  size: { cols: 6, rows: 4 },
  traffic: { spawnInterval: 1.1, maxCars: 8, mix: { car: 1, bike: 0.7 } },
};
