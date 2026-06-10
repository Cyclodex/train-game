import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// A single 90° curve: the train enters from the left and leaves downward, proving
// the curve geometry and that a train follows it. curve rot2 joins Left↔Bottom.
export const curve: TestScenario = {
  id: "curve",
  name: "Curve",
  description: "A train rounds a 90° curve from a left depot into one below.",
  level: {
    "0,0": expandKind("depot", 1), // opens Right
    "1,0": expandKind("curve", 2), // Left ↔ Bottom
    "1,1": expandKind("depot", 0), // opens Top
  },
  trains: {
    train1: mkTrain("train1", 0, 0, "people", 2, "1,1"),
  },
};
