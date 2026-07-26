import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Dispatch & fare decay, in isolation (Tycoon phase 1).
//
// Two identical lanes, two identical trains, both WAITING with a fare pin over
// them. Nothing moves until you click a pin — that is the mechanic. Send the top
// one immediately and leave the bottom one sitting, and the two pins tell the
// whole story: the dispatched train banks close to its base fare, the one still
// on the platform watches its own fare fall. In Train Valley the decay starting
// while the train waits is precisely what makes prompt dispatch a skill (design
// doc §1.2 M7), so the demo has to show it happening to a train that has not
// moved at all.
//
// Both lanes are three tiles long and disjoint, so neither train can interfere
// with the other and the only variable is WHEN you sent it. Colours are pinned so
// both trains park on a real match — a bounce here would muddle the reading of
// the fare, since a mismatched arrival pays nothing and keeps decaying.
export const dispatch: TestScenario = {
  id: "dispatch",
  name: "Dispatch & fare decay",
  description:
    "Two waiting trains with ticking fares. Send one now, one late — the pins show the cost of waiting.",
  modeId: "tycoon",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("straight", 1),
    "3,0": expandKind("depot", 3),
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    "2,1": expandKind("straight", 1),
    "3,1": expandKind("depot", 3),
  },
  trains: {
    prompt: mkTrain("prompt", 0, 0, "people", 2, "3,0"),
    patient: mkTrain("patient", 0, 1, "people", 2, "3,1"),
  },
  colors: {
    depotColors: {
      "0,0": "blue", // start — deliberately NOT the train's colour, or it parks at home
      "3,0": "green",
      "0,1": "blue",
      "3,1": "red",
    },
    trainColors: {
      prompt: "green",
      patient: "red",
    },
  },
};
