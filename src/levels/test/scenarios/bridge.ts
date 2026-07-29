import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// A river, and the two bridges over it — the exception to `canBuildOn`, in
// isolation.
//
// A river is NOT a new terrain kind: it is a one-wide line of `water` cells,
// which `patchPath` fuses into a ribbon exactly as it fuses a lake into a body.
// What makes it different from a lake is what you have to DO about it. A lake
// you route around; a river runs the height of the map, so it has to be
// crossed, and crossing means building a structure.
//
// Three things to read off this board:
//  1. **The bridge is an exception INSIDE `canBuildOn`, not a rule beside it.**
//     `4,2` and `4,5` carry `bridge: true` over water and are perfectly legal —
//     `validateLevel` raises no `blocked-terrain` for them, because it asks the
//     same one predicate it always did.
//  2. **Rail and road both cross.** The line spans at 4,2 and the street spans
//     at 4,5. Nothing about the structure is rail-specific.
//  3. **The deck sits ABOVE the water.** It draws between the ground and the
//     rails, with its shadow offset toward the same sun everything else is lit
//     by, so the river visibly runs underneath.
//
// Build it yourself: in the editor or in a Tycoon board, drawing a route across
// water lays the span automatically (`addConnection`) and charges
// `BRIDGE_BUILD_FACTOR` — six tiles' worth of routing cost keeps the planner
// preferring dry land whenever going round is remotely comparable.
const water = (): TileCell => ({ connections: [], terrain: "water" });

const level: Record<string, TileCell> = {};

// The river: a one-wide channel down column 4, bank to bank.
for (let y = 0; y <= 6; y++) level[`4,${y}`] = water();
// A wider pool halfway down, so the ribbon reads as a river rather than a canal.
level["3,3"] = water();
level["5,3"] = water();

// Meadow and a wood on the banks, so the water has something to run between.
for (const id of ["1,0", "2,0", "1,1", "6,5", "7,5", "7,6"]) {
  level[id] = { connections: [], terrain: "forest" };
}

// The line: depot to depot across the river, spanning it at 4,2.
const railRow = 2;
for (let x = 0; x <= 8; x++) {
  level[`${x},${railRow}`] = expandKind("straight", 1);
}
level[`4,${railRow}`] = {
  ...expandKind("straight", 1),
  terrain: "water",
  bridge: true,
};
level[`0,${railRow}`] = expandKind("depot", 1);
level[`8,${railRow}`] = expandKind("depot", 3);

// The street: edge to edge across the river, spanning it at 4,5.
const roadRow = 5;
for (let x = 0; x <= 8; x++) {
  level[`${x},${roadRow}`] = {
    connections: [],
    road: twoWay(Position.Left, Position.Right),
  };
}
level[`4,${roadRow}`] = {
  connections: [],
  road: twoWay(Position.Left, Position.Right),
  terrain: "water",
  bridge: true,
};

export const bridge: TestScenario = {
  id: "bridge",
  name: "River & bridges",
  description:
    "A river is a one-wide line of water, so it has to be crossed rather than routed around — and a bridge is the one exception inside canBuildOn, for rail and road alike.",
  size: { cols: 9, rows: 7 },
  level,
  trains: {
    train1: mkTrain("train1", 0, railRow, "people", 2, `8,${railRow}`),
  },
  traffic: { spawnInterval: 2, maxCars: 8 },
};
