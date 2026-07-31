import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// The works — the freight half of the world, beside the town it is not.
//
// Urban says "people live here". Industry says "things are made here", and it
// exists so that one day a depot beside it can mean FREIGHT the way a depot
// beside a town means passengers. That coupling is deliberately not built yet
// (see docs/superpowers/specs/2026-07-28-industry-and-demand-design.md); this
// is the ground it will read.
//
// Two things to read off this board:
//  1. **A works is a different vocabulary from a town, not a darker one.**
//     Circles and grids — silos, tanks, container stacks, long vented sheds —
//     in cool steel and concrete, laid out SQUARE to the yard. The town's roofs
//     are pitched, warm and jittered a few degrees, because a village grew and a
//     plant was planned. Put the two side by side (rows 0-2 against rows 4-6)
//     and neither reads as the other.
//  2. **It is ordinary buildable ground.** No blocking, priced at 2x — dearer
//     than a field, cheaper than town land. The line runs straight through it.
const town = (): TileCell => ({ connections: [], terrain: "urban" });
const works = (): TileCell => ({ connections: [], terrain: "industry" });

const level: Record<string, TileCell> = {};
// The town, north.
for (let y = 0; y <= 1; y++) for (let x = 0; x <= 8; x++) level[`${x},${y}`] = town();
// The works, south.
for (let y = 4; y <= 6; y++) for (let x = 0; x <= 8; x++) level[`${x},${y}`] = works();

// The line between them, serving both, depot to depot.
for (let x = 0; x <= 8; x++) level[`${x},3`] = expandKind("straight", 1);
level["0,3"] = expandKind("depot", 1);
level["8,3"] = expandKind("depot", 3);

// The works road, edge to edge along row 5 — lorries reach a yard by road.
for (let x = 0; x <= 8; x++) {
  level[`${x},5`] = {
    connections: [],
    road: twoWay(Position.Left, Position.Right),
    terrain: "industry",
  };
}

export const industry: TestScenario = {
  id: "industry",
  name: "Works",
  description:
    "The freight half of the world: silos, container stacks and vented sheds laid out square to the yard, against the town's pitched roofs on the other side of the line.",
  size: { cols: 9, rows: 7 },
  level,
  trains: {
    train1: mkTrain("train1", 0, 3, "fraight", 3, "8,3"),
  },
  traffic: { spawnInterval: 2.4, maxCars: 6, mix: { car: 1, truck: 2, semi: 1 } },
};
