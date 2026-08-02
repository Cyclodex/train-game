import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Lane changes on straight roads — every transition shape between 1, 2 and 3
// lanes per direction, laid out one road per row:
//
//   row 1 (y=1):  1 · 2 2 2 2 · 1                       (step up, hold, step down)
//   row 2 (y=3):  2 · 3 3 3 3 · 2
//   row 3 (y=5):  1 · 3 3 3 3 · 1                       (skip-a-lane, both ways)
//   row 4 (y=7):  1 · 2 2 2 2 · 3 3 3 3 · 2 2 2 2 · 1   (full sweep)
//
// Every count is held for a stretch before changing again (like a real road —
// a lane is added/dropped, then the road runs at that width for a while), and
// the sweep steps one lane at a time (no jumping 2→3→2 in a single tile).
//
// This is a *geometry gallery*: it shows the rendered shape of each lane
// increase/decrease. The traffic on it is incidental, and where it drives is a
// consequence of the shapes: a bidirectional road anchors its lanes at the
// centreline, so every one of these widenings adds its lanes at the KERB and
// every narrowing takes them back there. The lane that runs the length of a row
// is therefore the centre-adjacent one, and since no stretch here is wide for
// more than four tiles, that is the lane the cars stay in — the outer lanes
// render but stay empty, which is exactly what the inward lane-drop arrows ask
// for. See `/test/lanedrop` for the same shape long enough that the extra lanes
// are worth using, and for the one-lane-at-a-time merge in and out of them.

const COLS = 14;

// One straight road of `counts.length` tiles along row `y`, horizontally centred
// in the COLS-wide grid. Each tile is a Left↔Right bidirectional road with
// `count` lanes per direction.
function laneRow(y: number, counts: number[]): Level {
  const row: Level = {};
  const startX = Math.floor((COLS - counts.length) / 2);
  counts.forEach((count, i) => {
    row[`${startX + i},${y}`] = {
      connections: [],
      road: nWayLanes(Position.Left, Position.Right, count),
    };
  });
  return row;
}

export const roadlanemerge: TestScenario = {
  id: "roadlanemerge",
  name: "Lane changes: all straight transitions",
  description:
    "Four straight roads, one per row, showing every lane-count transition between 1, 2 and 3 lanes (step up, step down, skip-a-lane, and a full sweep). Each narrowing paints Swiss-style lane-drop arrows (2 advance + 1 at the seam) in the ending lane. A geometry gallery — the traffic holds the centre-adjacent lane that runs the whole length, because no stretch here stays wide for long enough to be worth crossing to the kerb lanes that end (see /test/lanedrop for one that is).",
  level: {
    ...laneRow(1, [1, 2, 2, 2, 2, 1]),
    ...laneRow(3, [2, 3, 3, 3, 3, 2]),
    ...laneRow(5, [1, 3, 3, 3, 3, 1]),
    ...laneRow(7, [1, 2, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2, 2, 1]),
  },
  trains: {},
  size: { cols: COLS, rows: 9 },
};
