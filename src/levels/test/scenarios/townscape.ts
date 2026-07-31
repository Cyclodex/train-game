import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// A town at STREET SCALE — the buildings measured against the cars driving past
// them, which is the only way to check the thing that was wrong.
//
// A tile is 100 ground units and a car is 23 of them long. The first town
// shipped with houses 14-20 units wide: narrower than a car, so the board read
// as a model village with full-size traffic in it. The archetypes are now sized
// against that ruler — a house ~1.5 car lengths, a terrace 3, a hall 3.5.
//
// Three things to read off this board:
//  1. **Scale.** Park a car beside a house on the main street. The house is
//     bigger. It was not.
//  2. **The frontage is modest, the depth is not.** `building()` picks an
//     archetype that fits the room measured at its spot, so the tiles the
//     streets run through carry sheds and small houses while the block interiors
//     (row 2, rows 5-6) carry terraces, blocks, halls — and, occasionally, the
//     church that gives the town a centre.
//  3. **The railway still clears its own way.** The line along row 4 runs
//     through the town: no roof stands on the ballast.
const town = { connections: [], terrain: "urban" as const };

// A two-way street carrying the town's ground.
const street = (from: Position, to: Position): TileCell => ({
  connections: [],
  road: twoWay(from, to),
  terrain: "urban",
});

// The crossroads in the middle of the town: every arm reaches every OTHER arm,
// so a car may turn as well as go straight (see demoworld's fourWayCross — the
// two opposite-port pairs alone make a crossroads nobody can turn at).
const crossroads = (): TileCell => {
  const arms = [Top, Right, Bottom, Left];
  return {
    connections: [],
    road: arms.map(from => ({ from, to: arms.filter(p => p !== from), index: 0 })),
    terrain: "urban",
  };
};

const level: Record<string, TileCell> = {};
// The town: eight columns by seven rows of urban ground.
for (let y = 0; y <= 6; y++) for (let x = 0; x <= 7; x++) level[`${x},${y}`] = { ...town };

// The main street, edge to edge along row 3, so ambient cars spawn and drive
// the whole width of the town past its frontages.
for (let x = 0; x <= 7; x++) level[`${x},3`] = street(Left, Right);
// A cross street down column 3, edge to edge for the same reason.
for (let y = 0; y <= 6; y++) level[`3,${y}`] = street(Top, Bottom);
level["3,3"] = crossroads();

// The railway through the town along row 5, depot to depot.
for (let x = 0; x <= 7; x++) {
  level[`${x},5`] = { ...expandKind("straight", 1), terrain: "urban" };
}
level["0,5"] = { ...expandKind("depot", 1), terrain: "urban" };
level["7,5"] = { ...expandKind("depot", 3), terrain: "urban" };
// Where the cross street meets the line, a level crossing — the street has to
// get across somehow, and it puts a car and a train on the same tile as the
// roofs for the scale comparison.
level["3,5"] = {
  ...expandKind("straight", 1),
  road: twoWay(Top, Bottom),
  terrain: "urban",
};

export const townscape: TestScenario = {
  id: "townscape",
  name: "Townscape",
  description:
    "A town at street scale: houses, terraces, blocks and a church measured against the cars driving past them, with the frontages stepping back from the street and the railway.",
  size: { cols: 8, rows: 7 },
  level,
  trains: {
    train1: mkTrain("train1", 0, 5, "people", 2, "7,5"),
  },
  traffic: { spawnInterval: 1.4, maxCars: 14 },
};
