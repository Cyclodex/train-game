import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// The objective loop in isolation: a winnable lane. One train leaves its depot,
// crosses a straight, and parks at its matching depot — delivering it satisfies
// the puzzle win condition (deliveriesRequired === trainCount). Depot rotations:
// 1 opens Right, 3 opens Left (see straight.ts).
export const objectives: TestScenario = {
  id: "objectives",
  name: "Objectives",
  description:
    "A winnable lane under the Puzzle mode: deliver the train to its matching " +
    "depot — timer, star pips and the win, live on the stage strip.",
  modeId: "puzzle",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("depot", 3),
  },
  trains: {
    t1: mkTrain("t1", 0, 0, "people", 1, "2,0"),
  },
};
