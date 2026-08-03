import { TileCell, TerrainKind } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// EVERY GROUND CAN BE A HILL.
//
// One slope, climbing west to east — 0, 1, 2, 3 and a summit shelf — with a
// different ground laid along each row. The point of the board is that all of
// them terrace: a wood on a hillside is a LIGHTER wood per step, a rock field a
// paler rock, a massif a paler slate, and the contour lines and slope faces read
// the same way on each. Before this, the terrace was always the meadow's green
// and it was painted UNDER the terrain patch — so raising a wood or a mountain
// changed the data and nothing else, and only bare grass ever looked higher.
//
// The two styles are deliberately next to each other (see `edgeStyleOf`):
//  - ORGANIC ground (forest, rock, mountain, water) contours like a hill,
//    bowed and rounded, the way a lake shores.
//  - SURVEYED ground (farmland, town, works) steps on STRAIGHT banks — a
//    terraced field, a town on cut platforms, a works on a levelled bench.
//    People cut their own ground level; weather does not.
//
// The middle row is grass with the line on it, so the terraces of every other
// row are measured against the one that has always worked, and the climb is the
// ordinary one-step-per-boundary ramp (chevrons on the ballast).
const COLUMNS = [0, 1, 2, 3, 3];

const ROWS: (TerrainKind | null)[] = [
  "forest",
  "rock",
  "mountain",
  null, // the grass reference row, and the line
  "farmland",
  "urban",
  "industry",
  "water",
];

const level: Record<string, TileCell> = {};
ROWS.forEach((kind, y) => {
  COLUMNS.forEach((height, x) => {
    if (kind === null) return; // the rail row is laid below
    const cell: TileCell = { connections: [] };
    cell.terrain = kind;
    if (height > 0) cell.height = height;
    level[`${x},${y}`] = cell;
  });
});

// The line: depot to depot up the grass row, one step per tile boundary.
const RAIL_ROW = ROWS.indexOf(null);
const LAST = COLUMNS.length - 1;
COLUMNS.forEach((height, x) => {
  const base =
    x === 0
      ? expandKind("depot", 1)
      : x === LAST
        ? expandKind("depot", 3)
        : expandKind("straight", 1);
  level[`${x},${RAIL_ROW}`] = height > 0 ? { ...base, height } : base;
});

export const hillsides: TestScenario = {
  id: "hillsides",
  name: "Hillsides",
  description:
    "The same slope (0-1-2-3) under every ground: a wood, a rock field and a massif terrace in their OWN colour, lighter per step, while farmland, town and works step on straight surveyed banks. The grass row in the middle carries the line, so each hillside is read against the terrace that always worked.",
  size: { cols: COLUMNS.length, rows: ROWS.length },
  level,
  trains: {
    train1: mkTrain("train1", 0, RAIL_ROW, "people", 2, `${COLUMNS.length - 1},${RAIL_ROW}`),
  },
};
