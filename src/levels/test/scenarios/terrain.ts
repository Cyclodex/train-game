import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Terrain as tile data: the six ground kinds, side by side, with a line running
// through them.
//
// Two things this is here to show, both of which are easy to get wrong and
// impossible to check in prose:
//  1. **Patches fuse.** The 2x2 lake and the 3-cell wood are authored as plain
//     areas — no corner sprites. Each tile rounds off only the edges where the
//     terrain STOPS, so neighbours of the same kind meet seamlessly while a lone
//     patch reads as an island. (tiles/terrain.ts → patchPath)
//  2. **Terrain is a property of a cell, not a substitute for one.** Most cells
//     here carry terrain and nothing else, but 1,2 is a straight through the
//     wood and 4,2 a straight through the town — track and ground on the same
//     tile, with the rails always drawn on top.
//
// Grass is deliberately absent from the middle row's plain tiles: grass draws no
// ground of its own, so the themed board shows through exactly as it always did.
export const terrain: TestScenario = {
  id: "terrain",
  name: "Terrain",
  description:
    "The six ground kinds: forest, water, rock, mountain and town around a line of track.",
  level: {
    // A wood in the top-left corner, wrapping the start of the line.
    "0,0": { connections: [], terrain: "forest" },
    "1,0": { connections: [], terrain: "forest" },
    "0,1": { connections: [], terrain: "forest" },
    // A 2x2 lake: four tiles that should read as one body of water.
    "3,0": { connections: [], terrain: "water" },
    "4,0": { connections: [], terrain: "water" },
    "3,1": { connections: [], terrain: "water" },
    "4,1": { connections: [], terrain: "water" },
    // Rock along the right edge.
    "5,0": { connections: [], terrain: "rock" },
    "5,1": { connections: [], terrain: "rock" },
    // A town along the bottom.
    "1,3": { connections: [], terrain: "urban" },
    "2,3": { connections: [], terrain: "urban" },
    "3,3": { connections: [], terrain: "urban" },
    // A mountain range in the bottom-right corner, so rock and mountain can be
    // read against each other: both block building, and they have to be tellable
    // apart at a glance or the board lies about where a line can go.
    "4,3": { connections: [], terrain: "mountain" },
    "5,3": { connections: [], terrain: "mountain" },
    // The line: depot to depot, straight across the middle. Two of its tiles
    // carry terrain as well as track.
    "0,2": expandKind("depot", 1),
    "1,2": { ...expandKind("straight", 1), terrain: "forest" },
    "2,2": expandKind("straight", 1),
    "3,2": expandKind("straight", 1),
    "4,2": { ...expandKind("straight", 1), terrain: "urban" },
    "5,2": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 2, "people", 2, "5,2"),
  },
};
