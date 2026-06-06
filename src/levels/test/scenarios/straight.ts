import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// The simplest case: a train leaves a depot, runs along a straight, and parks in
// the depot at the far end. Depot rotations — 1 opens Right, 3 opens Left.
export const straight: TestScenario = {
  id: "straight",
  name: "Straight track",
  description: "A train leaves its depot, crosses two straights, and parks.",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("straight", 1),
    "3,0": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 0, "people", 2, "3,0"),
  },
};
