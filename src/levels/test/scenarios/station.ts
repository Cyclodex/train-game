import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// One line, one station, one train: the smallest map that shows the dwell.
// The train leaves its depot, brakes to a stand at the platform in the middle
// tile, waits its dwell, pulls away and parks at the far depot. Colours are
// pinned so the far depot always matches (a bounce would hide the mechanic).
export const station: TestScenario = {
  id: "station",
  name: "Station dwell",
  description:
    "Every train calls at the platform: brake to a stand, wait, pull away.",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("station", 1),
    "3,0": expandKind("straight", 1),
    "4,0": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 0, "people", 2, "4,0"),
  },
  colors: {
    depotColors: {
      "0,0": "blue", // start — distinct so the train doesn't park at home
      "4,0": "green", // destination — matches → parks after its stop
    },
    trainColors: {
      train1: "green",
    },
  },
};
