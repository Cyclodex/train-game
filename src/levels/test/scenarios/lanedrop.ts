import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// LANE-DROP DISCIPLINE: which lane a driver picks when the road changes width,
// and how they get there. Two roads, one per row, with the SAME 1 → 3 → 1 shape
// and only their length different — because the length is the whole question.
//
//   row 1 (y=1):  1 · 3 3 3 3 · 1                   short: nothing to gain
//   row 2 (y=3):  1 · 3 × 13 · 1                    long: worth moving over
//
// A bidirectional road is anchored at the centreline, so a widening is felt at
// the KERB: the lane that continues through the narrow section is the one next to
// the centre line, and the extra lanes appear outboard of it. That is what the
// painted lane-drop arrows say — they point INWARD, away from the kerb — and it
// is what the two rows show:
//
//  • ROW 1 — the car comes out of the single lane and STAYS in it. The kerb lanes
//    beside it end four tiles later, so crossing to them would buy a few car
//    lengths of nothing at the price of two lane changes and two more to get
//    back. It drives dead straight through the whole widening (this row used to
//    sweep the car clear across to the far kerb the moment it crossed the seam —
//    two lanes of movement it never chose, straight through the arrows).
//  • ROW 2 — the same road, long enough to be worth using. Here keep-right does
//    send the car out to the kerb, and both journeys are made ONE LANE AT A TIME:
//    change, settle, look, change again. Four tiles before the drop it merges
//    back inward the same way, which is what the arrows are for.
//
// Watch a single car with the debug overlay on: its lateral line should be a
// sequence of separate steps, never one long diagonal across two lanes.

const COLS = 15;

// One straight road of `counts.length` tiles along row `y`, starting at `startX`.
// Each tile is a Left↔Right bidirectional road with `count` lanes per direction.
function laneRow(y: number, counts: number[], startX = 0): Level {
  const row: Level = {};
  counts.forEach((count, i) => {
    row[`${startX + i},${y}`] = {
      connections: [],
      road: nWayLanes(Position.Left, Position.Right, count),
    };
  });
  return row;
}

export const lanedrop: TestScenario = {
  id: "lanedrop",
  name: "Lane drop: merge discipline",
  description:
    "Two 1→3→1 roads that differ only in length. On the short one (top) a car " +
    "holds the lane that continues and drives straight through — the kerb lanes " +
    "beside it end too soon to be worth crossing to, exactly as the inward " +
    "lane-drop arrows say. On the long one it does use them, moving out and back " +
    "ONE LANE AT A TIME with a settle in between, and merging inward four tiles " +
    "before the drop rather than at the taper.",
  level: {
    ...laneRow(1, [1, 3, 3, 3, 3, 1], 4),
    ...laneRow(3, [1, ...Array(13).fill(3), 1]),
  },
  trains: {},
  size: { cols: COLS, rows: 5 },
  traffic: {
    // Sparse, so each car sorts itself out on an empty road: this scenario is
    // about the DECISION, not about gap acceptance under load (that is
    // `lanechangegap`). Eastbound only, so every car makes the same journey and
    // the two rows can be read side by side.
    spawnInterval: 3,
    maxCars: 6,
    spawnEntries: [
      { coord: { x: 4, y: 1 }, entryPort: Position.Left },
      { coord: { x: 0, y: 3 }, entryPort: Position.Left },
    ],
  },
};
