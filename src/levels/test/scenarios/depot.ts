import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Two lanes proving the depot's colour rule. Colours are pinned so the outcome is
// deterministic:
//   Lane A (row 0): a green train reaches a green depot → parks (match).
//   Lane B (row 1): a blue train reaches a red depot → bounces (mismatch), runs
//     back and parks in its own blue start depot.
export const depot: TestScenario = {
  id: "depot",
  name: "Depot match & bounce",
  description:
    "Top lane parks on a colour match; bottom lane bounces off a mismatch.",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("depot", 3),
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    "2,1": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 0, "people", 2, "2,0"),
    train2: mkTrain("train2", 0, 1, "fraight", 2, "2,1"),
  },
  colors: {
    depotColors: {
      "0,0": "blue", // start (A) — distinct so the train doesn't park at home
      "2,0": "green", // destination (A) — matches train1 → parks
      "0,1": "blue", // start (B) — matches train2 → parks on the way back
      "2,1": "red", // destination (B) — mismatch → bounce
    },
    trainColors: {
      train1: "green",
      train2: "blue",
    },
  },
};
