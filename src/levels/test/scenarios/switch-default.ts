import { Position, ActiveIntersection } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Left } = Position;

// A 4-way cross whose starting switch direction is authored in the level data.
// The train enters from the west; the cross's Left entry is authored to start
// switched *straight through* (east), so the train drives on to its matching
// green depot at (2,1) from the very first tick. Without the authored arm the
// computed default would be the Left arm (north, to (1,0)) — a colour mismatch
// it would bounce off. The north/south depots complete the 4-way cross (so every
// edge joins a neighbour) and show the arms the switch could have started on.
export const switchDefault: TestScenario = {
  id: "switch-default",
  name: "Switch default",
  description:
    "A cross authored to start switched straight-through, sending the train east instead of the default north.",
  level: {
    "0,1": expandKind("depot", 1), // start, opens Right (west of the cross)
    "2,1": expandKind("depot", 3), // destination, opens Left (east)
    "1,0": expandKind("depot", 2), // opens Bottom (north arm)
    "1,2": expandKind("depot", 0), // opens Top (south arm)
    "1,1": expandKind("cross", 0, {
      defaultArms: { [Left]: ActiveIntersection.Straight },
    }),
  },
  trains: {
    train1: mkTrain("train1", 0, 1, "people", 2, "2,1"),
  },
  colors: {
    depotColors: {
      "0,1": "blue", // start — distinct so the train leaves
      "2,1": "green", // straight-through destination (matches the train)
      "1,0": "yellow", // north arm (the default would send it here)
      "1,2": "red", // south arm
    },
    trainColors: { train1: "green" },
  },
};
