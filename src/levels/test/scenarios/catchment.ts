import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const town = (): TileCell => ({ connections: [], terrain: "urban" });

// Terrain sets the demand: the same line calls at a TOWN station and a LONELY
// halt. The town platform (six urban tiles in walking reach) fills fast and
// deep; the meadow halt sees a trickle. Toggle Debug to see each station's
// walking-catchment ring — the reach the rates are derived from.
export const catchment: TestScenario = {
  id: "catchment",
  name: "Catchment from terrain",
  description:
    "A town station's platform fills fast; a lonely halt sees a trickle. Debug shows the reach.",
  level: {
    // The town around station A (2,1): a block of houses either side.
    "1,0": town(),
    "2,0": town(),
    "3,0": town(),
    "1,2": town(),
    "2,2": town(),
    "3,2": town(),
    // The line.
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    "2,1": expandKind("station", 1),
    "3,1": expandKind("straight", 1),
    "4,1": expandKind("straight", 1),
    "5,1": expandKind("straight", 1),
    "6,1": expandKind("station", 1),
    "7,1": expandKind("straight", 1),
    "8,1": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 1, "people", 2, "8,1"),
  },
  colors: {
    depotColors: {
      "0,1": "blue",
      "8,1": "green",
    },
    trainColors: {
      train1: "green",
    },
  },
};
