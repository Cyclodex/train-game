import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// The save/load contention pocket. Two trains cross a shared intersection with
// a signal on each horizontal approach, so a mid-run snapshot catches the whole
// interlocking machinery in flight: one train holding a block reservation, the
// other braking on the red, both between their depots. Pinned colours + puzzle
// mode keep every run identical, which is what the round-trip tests
// (tests/unit/sim/saveRestore.spec.ts, tests/unit/gameSave.spec.ts) rely on:
// step N, save, restore, step M must equal stepping N+M straight through.
//
// Play it at /#/play?board=saveload to exercise the save/load UI on it.
export const saveload: TestScenario = {
  id: "saveload",
  name: "Save & load",
  description:
    "Two trains contending over a signalled crossing — the round-trip board for save → load → resume.",
  modeId: "puzzle",
  level: {
    // horizontal lane (row 1), signalled on both approaches to the crossing
    "0,1": expandKind("depot", 1), // opens Right
    "1,1": expandKind("straight", 1, { signals: true }),
    "3,1": expandKind("straight", 1, { signals: true }),
    "4,1": expandKind("depot", 3), // opens Left
    // vertical lane (col 2)
    "2,0": expandKind("depot", 2), // opens Bottom
    "2,2": expandKind("depot", 0), // opens Top
    // the crossing — straight-throughs only
    "2,1": expandKind("cross", 0, {
      disable: [
        [Top, Right],
        [Right, Bottom],
        [Bottom, Left],
        [Left, Top],
      ],
    }),
  },
  trains: {
    trainH: mkTrain("trainH", 0, 1, "people", 2, "4,1"),
    trainV: mkTrain("trainV", 2, 0, "fraight", 2, "2,2"),
  },
  colors: {
    depotColors: {
      "0,1": "blue", // trainH start
      "4,1": "green", // trainH destination
      "2,0": "yellow", // trainV start
      "2,2": "red", // trainV destination
    },
    trainColors: { trainH: "green", trainV: "red" },
  },
};
