import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// Two road level-crossings (Bahnübergang) in BOTH orientations, joined into one
// continuous street so cars actually drive through both gates.
//
//   (2,1) horizontal rail + vertical road  — the crossing furniture is upright
//   (1,2) vertical rail + horizontal road  — the furniture overlay is rotated
//
// The rail makes an L from depot (3,1) west across crossing#1, around the rail
// curve (1,1), down through crossing#2 to depot (1,3) — so the train's loco and
// wagons physically pass over both sets of rails. This verifies the layering:
// road < rails < wagons < locomotive < crossing furniture (gates, triangle signs
// and lamps stay on top in either orientation, the train is never hidden behind
// the track, and the rails cross over the road surface).
//
// The ROAD now mirrors that L instead of being two disconnected stubs: a straight
// approach block feeds each crossing, a road curve (2,2) joins the two crossing
// segments, and the whole street sits one tile in from the edges so the crossings
// are interior tiles with room to breathe. Cars spawn one-way from the left edge
// (0,2), cross the vertical rail at crossing#2, curve north at (2,2), cross the
// horizontal rail at crossing#1, and leave at the top edge — passing both gates
// and braking/launching smoothly at each closed crossing.
export const crossing: TestScenario = {
  id: "crossing",
  name: "Level crossing",
  description:
    "A continuous street crosses the track in both orientations (with a road curve joining the two crossings); rails sit over the road, the train over the rails, gate furniture on top.",
  level: {
    // --- Rail: an L from depot to depot, crossing the road twice ---
    "3,1": expandKind("depot", 3), // opens west onto crossing#1
    "2,1": {
      ...expandKind("straight", 1), // horizontal rail (Left-Right) …
      road: [[Top, Bottom]], // … crossing#1: vertical road over it
    },
    "1,1": expandKind("curve", 1), // Right <-> Bottom: turn the track downward
    "1,2": {
      ...expandKind("straight", 0), // vertical rail (Top-Bottom) …
      road: [[Left, Right]], // … crossing#2: horizontal road over it
    },
    "1,3": expandKind("depot", 0), // opens north onto crossing#2

    // --- Road: one continuous street, approach → crossing → curve → crossing ---
    "2,0": { connections: [], road: [[Top, Bottom]] }, // straight approach (top edge)
    "0,2": { connections: [], road: [[Left, Right]] }, // straight approach (left edge → spawn)
    "2,2": { connections: [], road: [[Top, Left]] }, // road curve joining the crossings
  },
  trains: {
    train1: mkTrain("train1", 3, 1, "people", 3, "1,3"),
  },
  size: { cols: 4, rows: 4 },
};
