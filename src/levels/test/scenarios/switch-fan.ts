import { Position, ActiveIntersection } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Left } = Position;

// The junction switch FAN, in the shape that used to be worst to read: an
// all-pairs 4-way cross, where every one of the four entries carries its own
// independent setting. The old three-bulb widget drew four identical little
// black boxes round the tile and nothing said which one governed the train that
// was coming, or which bulb meant which way.
//
// What this map is for (each is a thing to look at, not just click):
//   * FOUR fans at once — the densest case. They should read as four separate
//     controls, each clearly belonging to its own edge, not as clutter.
//   * The arrows point the true way out. From the west entry: up → yellow, on
//     → red, down → green. No decoding.
//   * APPROACH EMPHASIS: the train comes in from the west, so the west fan
//     brightens and grows while the other three recede. That is the answer to
//     "which of these four do I care about?".
//   * The ROUTE RIBBON on the rails shows where the west fan currently points,
//     and hovering another arm previews that route as a dashed line.
//
// The board makes you use it: the cross is authored to start switched to the
// west entry's LEFT arm (north, the yellow depot), and the train is GREEN, so
// leaving it alone parks it wrong and bounces it. One click on the west fan's
// downward arrow sends it home — and note it is ONE click: the old widget could
// only cycle, so reaching a specific exit took up to three and a guess.
export const switchFan: TestScenario = {
  id: "switch-fan",
  name: "Switch fan",
  description:
    "A 4-way cross with all four switches live: aim the west fan's arrow at the green depot before the train gets there.",
  level: {
    "0,1": expandKind("depot", 1), // start, opens Right (west of the cross)
    "1,1": expandKind("straight", 1), // run-up, so there is time to throw it
    "2,1": expandKind("cross", 0, {
      // Starts pointing north (yellow) — the wrong way for this train.
      defaultArms: { [Left]: ActiveIntersection.Left },
    }),
    "3,1": expandKind("straight", 1),
    "4,1": expandKind("depot", 3), // east arm, opens Left
    "2,0": expandKind("depot", 2), // north arm, opens Bottom
    "2,2": expandKind("depot", 0), // south arm, opens Top — the destination
  },
  trains: {
    train1: mkTrain("train1", 0, 1, "people", 2, "2,2"),
  },
  colors: {
    depotColors: {
      "0,1": "blue", // start — distinct so the train leaves
      "2,0": "yellow", // north: where the authored arm points (a mismatch)
      "4,1": "red", // east: straight on
      "2,2": "green", // south: the match
    },
    trainColors: { train1: "green" },
  },
};
