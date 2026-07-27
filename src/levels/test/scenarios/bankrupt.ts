import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { TerrainKind, TileCell } from "@/tiles/model";

// Bankruptcy — the fail half of the second clock, in isolation (Tycoon; design
// doc §1.2 M1/M14, §8).
//
// `/test/taxyear` shows that upkeep exists and scales with what you built. This
// board shows what happens when it wins. The purse is $6,000, a year is eight
// seconds, and every piece you lay costs $600 a year to keep — so the annual
// bill is not a drip here, it is a countdown.
//
// The arithmetic the board is built on, measured headlessly:
//
//   close the gap directly (2 pieces, $2,000) → $1,200/yr, and $4,000 buys
//   exactly three years. The fourth bill lands at 32s and cannot be paid.
//
//   prompt   build ~3s, send at once → won at 15.7s, banked $3,315
//   relaxed  build ~6s, send at 12s  → won at 24.7s, banked   $855
//   dawdling send at 26s             → BANKRUPT at 32s, $800 short
//
// What to try, at /#/play?mode=tycoon&board=bankrupt:
//
//  1. Close the gap and send the train straight away. You win with change.
//  2. Do it again and leave the train on the platform. After the third bill the
//     calendar row turns red — "can't pay next year" — and you have a whole
//     in-game year to act before the fourth. That warning is the feature; a
//     fail state you cannot see coming is an ambush. Then let the year turn.
//  3. Misdraw the route on purpose and press UNDO (or Ctrl+Z). Full price back,
//     no fee: undo reverses a purchase, and a misdrag is an input error rather
//     than a world event. Now try BULLDOZE instead and watch it charge you —
//     that one removes a railway, and somebody has to pull the rails up.
//
// Note what this board does NOT teach: clearing your way out of an upkeep
// spiral. A two-piece link has no SURPLUS — take a piece out and the gap is
// open again — so here the only real escape is to deliver. `/test/taxyear` has
// the deep purse and the room to over-build, and that is where clearing is
// worth its fee.
//
// The pond under the gap is the `canBuildOn` gate, so a wandering route has to
// go north — a detour, not a shortcut. It is not survivable on this purse, and
// that is a lesson too.
//
// DELIBERATELY INCOMPLETE (`allowIncomplete`), like `buildgap` and `taxyear`:
// the dangling ends either side of the gap are the point. The /test stage shows
// the board, the calendar and the warning; the build gesture lives in PlayView.
const ground = (terrain: TerrainKind) => (): TileCell => ({ connections: [], terrain });
const V = ground("water");

export const bankrupt: TestScenario = {
  id: "bankrupt",
  name: "The bank is counting",
  description:
    "A tight purse and a steep annual bill. Close the gap and deliver before the upkeep folds the railway — or bulldoze your way back under it.",
  modeId: "tycoon",
  allowIncomplete: true,
  size: { cols: 6, rows: 3 },
  level: {
    // West: the origin station and its line, ending open at 1,1's east edge.
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    // 2,1 and 3,1: the gap.
    // East: one stub of line and the destination station, open at 4,1's west.
    "4,1": expandKind("straight", 1),
    "5,1": expandKind("depot", 3),
    // The pond under the gap: unbuildable, so an over-long route has to climb
    // over row 0 rather than sneak underneath.
    "2,2": V(),
    "3,2": V(),
  },
  trains: {
    t1: mkTrain("t1", 0, 1, "people", 1, "5,1"),
  },
  // Pinned for the /test stage so the waiting train always matches the depot
  // across the gap. (PlayView derives its own seeded assignment, which reaches
  // the same pairing — one train, one non-start depot.)
  colors: {
    depotColors: { "0,1": "blue", "5,1": "green" },
    trainColors: { t1: "green" },
  },
};
