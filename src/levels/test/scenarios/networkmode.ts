import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const town = (): TileCell => ({ connections: [], terrain: "urban" });

// THE NETWORK MODE in one board: a two-station line through a town, with a
// shuttle that has to keep both platforms clear. The crowds build from the
// terrain (the houses either side of each station), the HUD counts people
// carried rather than trains parked, and letting a platform overflow ends the
// run — which is the whole mode in one screen.
//
// BALANCED AGAINST ONE TRAIN, deliberately. The line is single track, so a
// second shuttle would meet the first head-on and deadlock — there is no
// passing loop here. That makes the board's capacity a fixed number (a
// four-wagon train, so 24 seats a round trip) and the towns are sized to sit
// just under it: comfortable if you keep the shuttle moving, lost if you leave
// it standing. The first cut of this board paired one train with two full-size
// towns and was unwinnable in 19 seconds.
export const networkmode: TestScenario = {
  id: "networkmode",
  name: "Network mode",
  description:
    "One shuttle, two town stations: carry the people before a platform overflows.",
  modeId: "network",
  level: {
    // Houses around station A (2,1)…
    "1,0": town(),
    "2,0": town(),
    "3,0": town(),
    "1,2": town(),
    "2,2": town(),
    // …and around station B (5,1).
    "4,0": town(),
    "5,0": town(),
    "5,2": town(),
    "6,2": town(),
    // The line.
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    "2,1": expandKind("station", 1),
    "3,1": expandKind("straight", 1),
    "4,1": expandKind("straight", 1),
    "5,1": expandKind("station", 1),
    "6,1": expandKind("straight", 1),
    "7,1": expandKind("depot", 3),
  },
  trains: {
    shuttle: mkTrain("shuttle", 0, 1, "people", 4, "7,1"),
  },
  // NEITHER depot matches the shuttle, and that is the point: a train that
  // matches its destination PARKS there, which would end the service after one
  // trip. A mismatch bounces it back out (sim: bounceOutOfDepot), so the two
  // depots act as the turn-backs of a shuttle that runs all day — which is what
  // a network mode needs and what a puzzle mode's "everyone home" never wanted.
  colors: {
    depotColors: {
      "0,1": "blue",
      "7,1": "red",
    },
    trainColors: {
      shuttle: "green",
    },
  },
};
