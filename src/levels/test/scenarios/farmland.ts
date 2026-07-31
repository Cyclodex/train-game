import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Farmland — the patchwork of worked strips that open country actually looks
// like from above, and the answer to a board whose every unbuilt quarter was
// the same flat green.
//
// Three things to read off this board:
//  1. **Furrows run ON across the tile seam.** The stripe bearing, width and
//     crop come from a coarse WORLD lattice (`fieldPlanAt`, ~3 tiles a cell),
//     never from the tile — so a field is several tiles big and its furrows
//     line up across the boundaries. Seeded per tile instead, every tile edge
//     would become a field edge and the ground would redraw the grid the
//     jittered patch outlines exist to hide.
//  2. **The patchwork comes from the lattice.** This block is 10x7, so it spans
//     several lattice cells: the crops, bearings and stripe widths change a few
//     tiles apart, which is the patchwork, and it lands nowhere near the tiles.
//  3. **A field is buildable, and cheap.** Water and rock refuse track; a field
//     takes it at 1.2x (`TERRAIN_BUILD_FACTOR`) — you buy it off the farmer.
//     The line and the lane across the middle simply draw over the furrows,
//     which is what a railway cut through a field looks like.
const field = (): TileCell => ({ connections: [], terrain: "farmland" });

const level: Record<string, TileCell> = {};
for (let y = 0; y <= 6; y++) for (let x = 0; x <= 9; x++) level[`${x},${y}`] = field();

// A lane along row 1, edge to edge so ambient traffic runs the length of it.
for (let x = 0; x <= 9; x++) {
  level[`${x},1`] = {
    connections: [],
    road: twoWay(Position.Left, Position.Right),
    terrain: "farmland",
  };
}

// The branch line across the middle, depot to depot, on the fields throughout.
for (let x = 0; x <= 9; x++) {
  level[`${x},4`] = { ...expandKind("straight", 1), terrain: "farmland" };
}
level["0,4"] = { ...expandKind("depot", 1), terrain: "farmland" };
level["9,4"] = { ...expandKind("depot", 3), terrain: "farmland" };

// A copse and a farmstead in the middle of the fields, so the field tones can
// be read against the two grounds they sit between.
for (const id of ["3,6", "4,6", "4,5"]) level[id] = { connections: [], terrain: "forest" };
for (const id of ["7,2", "8,2"]) level[id] = { connections: [], terrain: "urban" };

export const farmland: TestScenario = {
  id: "farmland",
  name: "Farmland",
  description:
    "A patchwork of ploughed fields: furrow bearing, width and crop come from a world lattice, so a field spans several tiles and its stripes run on across every seam.",
  size: { cols: 10, rows: 7 },
  level,
  trains: {
    train1: mkTrain("train1", 0, 4, "people", 2, "9,4"),
  },
  traffic: { spawnInterval: 2.2, maxCars: 8 },
};
