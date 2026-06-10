import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// Two trains crossing at a level intersection. The centre tile is a pure crossing
// (the four turn connections are disabled, leaving only the two straight-throughs)
// so neither train can turn — they simply contend for the shared tile, which the
// occupancy gate serialises. Each train has its own coloured destination depot, so
// both deliver.
export const cross: TestScenario = {
  id: "cross",
  name: "Crossing",
  description: "Two trains cross at a shared intersection and both deliver.",
  level: {
    // vertical lane (col 1)
    "1,0": expandKind("depot", 2), // opens Bottom
    "1,2": expandKind("depot", 0), // opens Top
    // horizontal lane (row 1)
    "0,1": expandKind("depot", 1), // opens Right
    "2,1": expandKind("depot", 3), // opens Left
    // the crossing — straight-throughs only
    "1,1": expandKind("cross", 0, {
      disable: [
        [Top, Right],
        [Right, Bottom],
        [Bottom, Left],
        [Left, Top],
      ],
    }),
  },
  trains: {
    trainH: mkTrain("trainH", 0, 1, "people", 2, "2,1"),
    trainV: mkTrain("trainV", 1, 0, "fraight", 2, "1,2"),
  },
  colors: {
    depotColors: {
      "0,1": "blue", // trainH start
      "2,1": "green", // trainH destination
      "1,0": "yellow", // trainV start
      "1,2": "red", // trainV destination
    },
    trainColors: { trainH: "green", trainV: "red" },
  },
};
