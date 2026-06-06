import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// A road level-crossing (Bahnübergang): a horizontal rail with a vertical road
// crossing the middle tile. The road layer is the shared `road?` seam — the same
// one DEFAULT_LEVEL uses — which TestView overlays with the crossing furniture and
// cars. The gate closes while the train reserves or sits on the tile.
export const crossing: TestScenario = {
  id: "crossing",
  name: "Level crossing",
  description: "A road crosses the track; the gate closes as the train passes.",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": {
      ...expandKind("straight", 1),
      road: [[Position.Top, Position.Bottom]],
    },
    "2,0": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 0, "people", 2, "2,0"),
  },
};
