import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// The game-feel layer (sound + feedback FX) in isolation, under Tycoon so the
// money half exists too. Two disjoint lanes, colours pinned so each shows one
// outcome — send the trains from their fare pins and watch/listen:
//
//   Lane A (row 0): a colour MATCH. On arrival: the delivery chime, the green
//     pulse ring on the depot, the register "ka-ching", the banked fare flying
//     up as a "+$…" chip, and the HUD money row flashing green as it lands.
//   Lane B (row 2): a MISMATCH. On arrival: the bounce thud and the red
//     squash-flash on the depot the train just thudded off.
//
// The click cues ride the same board: the signal on lane A clicks as you cycle
// it (junction switches clack the same way on any junction board). Sounds are
// gated behind the first click anyway (browser autoplay policy), so the pin
// click that dispatches a train is also what unlocks the audio.
export const gamefeel: TestScenario = {
  id: "gamefeel",
  name: "Game feel: chime, thud & cash",
  description:
    "Top lane delivers — chime, pulse and the fare flying home; bottom lane bounces — thud and squash-flash.",
  modeId: "tycoon",
  level: {
    // Lane A: match, with a signal mid-lane for the signal-click cue.
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1, { signals: true }),
    "2,0": expandKind("straight", 1),
    "3,0": expandKind("depot", 3),
    // Lane B: mismatch.
    "0,2": expandKind("depot", 1),
    "1,2": expandKind("straight", 1),
    "2,2": expandKind("straight", 1),
    "3,2": expandKind("depot", 3),
  },
  trains: {
    delivers: mkTrain("delivers", 0, 0, "people", 2, "3,0"),
    bounces: mkTrain("bounces", 0, 2, "fraight", 2, "3,2"),
  },
  colors: {
    depotColors: {
      "0,0": "blue", // home — not the train's colour, or it parks at home
      "3,0": "green", // matches `delivers` → chime + cash
      "0,2": "blue", // home — `bounces` parks here after the bounce
      "3,2": "red", // mismatch for `bounces` → thud + squash
    },
    trainColors: {
      delivers: "green",
      bounces: "blue",
    },
  },
};
