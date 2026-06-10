import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Straight multi-lane roads at every per-direction width, stacked for
// comparison. Each row is a straight road open at both ends; the rows differ
// only in lane count, so you can eyeball lane spacing, the centre divider and
// the dashed inner dividers side by side. Cars spawn from both open edges and
// ride their own lane — same-direction cars in different lanes flow
// independently and never stack behind each other.
//
// Replaces the separate roadtwolane / roadmultilane demos (one row each).

// A horizontal straight road of `cols` tiles at row `y`, `count` lanes per
// direction, spanning x = 0..cols-1.
function row(count: number, y: number, cols: number): Level {
  const out: Level = {};
  for (let x = 0; x < cols; x++) {
    out[`${x},${y}`] = { connections: [], road: nWayLanes(Position.Left, Position.Right, count) };
  }
  return out;
}

const COLS = 5;

export const roadstraightlanes: TestScenario = {
  id: "roadstraightlanes",
  name: "Straight road: 2 & 3 lanes per direction",
  description:
    "Straight roads at 2 and 3 lanes per direction, stacked for comparison. Cars spawn from both ends and ride their own lane; same-direction cars in different lanes flow independently without stacking.",
  level: {
    ...row(2, 0, COLS), // 2 lanes per direction (4 total)
    ...row(3, 2, COLS), // 3 lanes per direction (6 total)
  },
  trains: {},
  size: { cols: COLS, rows: 3 },
  traffic: {
    spawnInterval: 0.4,
    maxCars: 16,
  },
};
