import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// A T-junction switch: the train enters from the left and the switch sends it
// either straight on (Right depot) or down the branch (Bottom depot). Click the
// switch to flip the route. Both destination depots are coloured to match, so the
// train parks whichever way it is sent. tjunction rot2 joins Left↔Right and
// Left↔Bottom.
export const junction: TestScenario = {
  id: "junction",
  name: "Junction switch",
  description: "Flip the switch to route the train straight on or down the branch.",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("tjunction", 2),
    "2,0": expandKind("depot", 3),
    "1,1": expandKind("depot", 0),
  },
  trains: {
    train1: mkTrain("train1", 0, 0, "people", 2, "2,0"),
  },
  colors: {
    depotColors: {
      "0,0": "blue", // start — distinct so the train leaves
      "2,0": "green", // straight-on destination
      "1,1": "green", // branch destination (also a match)
    },
    trainColors: { train1: "green" },
  },
};
