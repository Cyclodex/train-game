import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Two road level-crossings (Bahnübergang) in BOTH orientations, so the stacking
// order is exercised either way:
//   (1,0) horizontal rail + vertical road  — the crossing furniture is upright
//   (2,1) vertical rail + horizontal road  — the furniture overlay is rotated
// The train runs depot -> crossing#1 -> curve -> crossing#2 -> depot, so its
// loco and wagons physically pass over both sets of rails. This verifies the
// layering: road < rails < wagons < locomotive < crossing furniture (gates,
// triangle signs and lamps stay on top in either orientation, the train is
// never hidden behind the track, and the rails cross over the road surface).
export const crossing: TestScenario = {
  id: "crossing",
  name: "Level crossing",
  description:
    "Road crosses the track in both orientations; rails sit over the road, the train over the rails, gate furniture on top.",
  level: {
    "0,0": expandKind("depot", 1), // opens east
    "1,0": {
      ...expandKind("straight", 1), // horizontal rail (Left-Right)
      road: [[Position.Top, Position.Bottom]], // vertical road
    },
    "2,0": expandKind("curve", 2), // Left <-> Bottom: turn the track downward
    "2,1": {
      ...expandKind("straight", 0), // vertical rail (Top-Bottom)
      road: [[Position.Left, Position.Right]], // horizontal road
    },
    "2,2": expandKind("depot", 0), // opens north
  },
  trains: {
    train1: mkTrain("train1", 0, 0, "people", 3, "2,2"),
  },
};
