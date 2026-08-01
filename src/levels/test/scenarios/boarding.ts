import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Two stations on one line: the passenger loop in miniature. Passengers gather
// on both platforms (the default demand schedule); the train boards at its
// first call, carries them one hop, and lets them off at the next — watch the
// crowds drain into the train and the activity log count "(n on, m off)".
// Colours are pinned so the far depot matches and the run ends parked.
export const boarding: TestScenario = {
  id: "boarding",
  name: "Boarding & riding",
  description:
    "Crowds build on two platforms; the train boards, rides a hop, lets them off.",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("station", 1),
    "3,0": expandKind("straight", 1),
    "4,0": expandKind("station", 1),
    "5,0": expandKind("straight", 1),
    "6,0": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 0, "people", 2, "6,0"),
  },
  colors: {
    depotColors: {
      "0,0": "blue",
      "6,0": "green",
    },
    trainColors: {
      train1: "green",
    },
  },
};
