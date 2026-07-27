import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// A HUGE wood with a curvy line snaking through it — the forest-depth rules at
// scale:
//  1. **Deep wood is dense wood.** Almost every tile here has 8 forest
//     neighbours, so the interior packs ~2x the trees of a lone copse and grows
//     them up to a third bigger (see `depth` in tiles/terrain.ts). Compare the
//     middle of this map with the small wood in the `terrain` scenario.
//  2. **The line is a cleared corridor.** The snake of straights and curves
//     keeps a right-of-way free of trunks the whole way — including around the
//     CURVES, whose corridor follows the same quadratic the train drives.
//  3. **Canopies close over the line.** With this much depth, overhanging
//     crowns are everywhere; the train spends half the trip slipping under
//     foliage drawn above it.
const wood = (): TileCell => ({ connections: [], terrain: "forest" });

const level: Record<string, TileCell> = {};
for (let y = 0; y <= 4; y++) {
  for (let x = 0; x <= 9; x++) level[`${x},${y}`] = wood();
}

// The snake: east out of the west depot, dipping south, back north, south
// again, and into the east depot — every tile of it still forest underneath.
const track: Record<string, TileCell> = {
  "0,1": expandKind("depot", 1),
  "1,1": expandKind("straight", 1),
  "2,1": expandKind("curve", 2), // west -> south
  "2,2": expandKind("straight", 0),
  "2,3": expandKind("curve", 0), // north -> east
  "3,3": expandKind("straight", 1),
  "4,3": expandKind("straight", 1),
  "5,3": expandKind("curve", 3), // west -> north
  "5,2": expandKind("straight", 0),
  "5,1": expandKind("curve", 1), // south -> east
  "6,1": expandKind("straight", 1),
  "7,1": expandKind("curve", 2), // west -> south
  "7,2": expandKind("straight", 0),
  "7,3": expandKind("curve", 0), // north -> east
  "8,3": expandKind("straight", 1),
  "9,3": expandKind("depot", 3),
};
for (const [coord, cell] of Object.entries(track)) {
  level[coord] = { ...cell, terrain: "forest" };
}

export const forestworld: TestScenario = {
  id: "forestworld",
  name: "Forest world",
  description:
    "A curvy line through a deep wood: dense oversized interior canopy, a cleared right-of-way along every straight and curve, and crowns closing over the train.",
  level,
  trains: {
    train1: mkTrain("train1", 0, 1, "people", 2, "9,3"),
  },
};
