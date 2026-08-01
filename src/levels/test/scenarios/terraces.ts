import { TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// How a hill is DRAWN when the ground falls more than one step at once.
//
// Two hills of the same summit height stand side by side, and the point of the
// board is that they read the same way:
//
//  - WEST, the stepped hill: authored the long way, one cell per level, so the
//    ground climbs 0 -> 1 -> 2 -> 3 over three cells and every contour lands on
//    a tile boundary. This is what a hill has always looked like.
//  - EAST, the mesa: an h3 block with NOTHING around it — the ground drops
//    three steps in one boundary. Its cells owe the level-1 and level-2
//    contours nobody authored, so they draw them INSIDE their own tile (see
//    `bandInsets` in tiles/terrain.ts). Closer contours, steeper slope; the same
//    hill, not a sheer wall with one line round it.
//
// Before that, an elevated cell drew ONE body — its own level — so the mesa
// came out as a single flat-topped slab and, worse, an ordinary ramped hill
// went terraced along the axis it was authored on and sheer at its ends (the
// north and south faces of /test/grades). Heights are authored per cell and
// nothing forces a hill to be padded with rings, so the renderer has to answer
// for the jump.
const level: Record<string, TileCell> = {};

const at = (v: number, lo: number, hi: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);

// The stepped hill: Chebyshev distance from the 2x2 summit, one level per ring.
for (let y = 0; y <= 5; y++) {
  for (let x = 0; x <= 5; x++) {
    const d = Math.max(at(x, 2, 3), at(y, 2, 3));
    const h = 3 - d;
    if (h > 0) level[`${x},${y}`] = { connections: [], height: h };
  }
}

// The mesa: the same 2x2 summit, and no rings at all.
for (let y = 2; y <= 3; y++) {
  for (let x = 8; x <= 9; x++) level[`${x},${y}`] = { connections: [], height: 3 };
}

// A line along the foot of both, so the hills are seen from the board the way a
// player meets them — and so the terraces are measured against something known
// to be at ground level.
for (let x = 0; x <= 11; x++) level[`${x},6`] = expandKind("straight", 1);
level["0,6"] = expandKind("depot", 1);
level["11,6"] = expandKind("depot", 3);

export const terraces: TestScenario = {
  id: "terraces",
  name: "Terraces & cliffs",
  description:
    "The same hill authored two ways: west, one cell per level (0-1-2-3); east, an h3 mesa dropping three steps at one boundary. The mesa draws the missing contours inside its own tiles — closer lines for a steeper slope — instead of standing as a slab with a single edge.",
  size: { cols: 12, rows: 7 },
  level,
  trains: {
    train1: mkTrain("train1", 0, 6, "people", 2, "11,6"),
  },
};
