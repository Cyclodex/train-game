import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// A line CLEARED through terrain — the right-of-way rules in isolation:
//  1. **Scatter keeps off the line.** The straights at 1,1..4,1 carry forest and
//     town, but no trunk, house, paving or garden stands on the corridor: the
//     wood thins and the town steps back where the railway runs.
//  2. **Canopies overhang, traffic passes under.** A forest tree may stand just
//     OFF the ballast with its crown reaching over the track — those trees
//     render on the canopy layer (above trains AND cars), so the train visibly
//     slips beneath the foliage at 1,1/2,1, and the cars on the street through
//     the wood (row 2) duck under crowns the same way.
//  3. **Neighbours count.** The forest tiles ABOVE and BELOW the line (x=1..2,
//     y=0/2) also keep their trees' canopies clear of the corridor next door —
//     except the deliberate overhangers.
const forest = { connections: [], terrain: "forest" as const };
const urban = { connections: [], terrain: "urban" as const };
// A two-way east-west street, carrying whatever ground the cell already has.
const street = (terrain?: TileCell["terrain"]): TileCell => ({
  connections: [],
  road: twoWay(Position.Left, Position.Right),
  ...(terrain ? { terrain } : {}),
});

export const clearing: TestScenario = {
  id: "clearing",
  name: "Clearing",
  description:
    "A line through a wood and a town: scatter clears the right-of-way, big canopies overhang it and the train passes beneath.",
  // Explicit size: the road sweep spec drives this board's traffic headlessly
  // and needs the grid without deriving it.
  size: { cols: 6, rows: 3 },
  level: {
    // A deep wood around the western half of the line.
    "1,0": forest,
    "2,0": forest,
    // The town around the eastern half.
    "3,0": urban,
    "4,0": urban,
    // Row 2: a street through the wood and the town, edge to edge so ambient
    // cars spawn. Road corridors clear the scatter exactly like rail ones, and
    // crowns overhang the street — cars pass under them like trains do.
    "0,2": street(),
    "1,2": street("forest"),
    "2,2": street("forest"),
    "3,2": street("urban"),
    "4,2": street("urban"),
    "5,2": street(),
    // The line itself: two forest tiles, then two town tiles, depot to depot.
    "0,1": expandKind("depot", 1),
    "1,1": { ...expandKind("straight", 1), terrain: "forest" },
    "2,1": { ...expandKind("straight", 1), terrain: "forest" },
    "3,1": { ...expandKind("straight", 1), terrain: "urban" },
    "4,1": { ...expandKind("straight", 1), terrain: "urban" },
    "5,1": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 1, "people", 2, "5,1"),
  },
};
