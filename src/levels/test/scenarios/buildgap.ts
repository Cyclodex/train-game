import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { TerrainKind, TileCell } from "@/tiles/model";

// Build the gap — the in-play build tool in isolation (Tycoon phase 2).
//
// Train Valley's opening move, reduced to its atoms: a line that stops two
// tiles short of the destination, a train waiting with a ticking fare, and a
// budget. Close the gap (arm Build, click the open end, click the far open
// end — $1,000 a tile out of the same pool the fare pays into), then dispatch
// and deliver across the track you just bought. The pond south of the gap is
// the `canBuildOn` gate in miniature: a route can't be dragged through it.
//
// The budget (STARTING_BALANCE, 3 tiles' worth) affords the direct link with
// one tile to spare but NOT a wandering detour, so the refusal preview (red
// ghost + red tag) is reachable here too.
//
// This board is DELIBERATELY incomplete — `allowIncomplete` tells the registry
// validation to tolerate the dangling open ends and the unreachable
// destination, which are the scenario's whole point (see scenario.ts).
//
// The /test stage shows the board and its waiting train; the build gesture
// itself lives in PlayView, so play it at /#/play?mode=tycoon&board=buildgap
// (that exact flow is the e2e test).
const ground = (terrain: TerrainKind) => (): TileCell => ({ connections: [], terrain });
const V = ground("water");

export const buildgap: TestScenario = {
  id: "buildgap",
  name: "Build the gap",
  description:
    "A line two tiles short of its station, and the budget to close it. Buy the missing link, then send the train across it.",
  modeId: "tycoon",
  allowIncomplete: true,
  size: { cols: 7, rows: 3 },
  level: {
    // West: the origin station and its line, ending open at 2,1's east edge.
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    "2,1": expandKind("straight", 1),
    // 3,1 and 4,1: THE GAP. Two tiles of grass the player buys track across.
    // East: one stub of line and the destination station, open at 5,1's west.
    "5,1": expandKind("straight", 1),
    "6,1": expandKind("depot", 3),
    // A pond hugging the gap's south side: unbuildable, so the route planner
    // demonstrably refuses to go that way round.
    "3,2": V(),
    "4,2": V(),
  },
  trains: {
    t1: mkTrain("t1", 0, 1, "people", 1, "6,1"),
  },
  // Pinned for the /test stage so the waiting train always matches the depot
  // across the gap. (PlayView derives its own seeded assignment, which reaches
  // the same pairing — one train, one non-start depot.)
  colors: {
    depotColors: { "0,1": "blue", "6,1": "green" },
    trainColors: { t1: "green" },
  },
};
