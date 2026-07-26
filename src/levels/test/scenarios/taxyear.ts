import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// The second clock — the calendar and the annual upkeep, in isolation
// (Tycoon, design doc §1.2 M1/M13 and §1.3 "two clocks, opposed").
//
// Everything else in Tycoon pushes one way: the fare decays, so HURRY. The tax
// pushes the other: every piece of track you lay costs money every year you own
// it, so BUILD LEAN. This board is the smallest place both are visible at once.
//
// The board is a line with a two-tile gap and a deep purse. What to watch, in
// order, at /#/play?mode=tycoon&board=taxyear:
//
//  1. The HUD's second row is a DATE, not a stopwatch — "Jan 1830" — with the
//     annual upkeep beside it. Before you build, that upkeep is $0: only track
//     the PLAYER laid is taxed, so a board you were given costs nothing to hold.
//  2. Close the gap the direct way (2 pieces, $2,000) and the upkeep line jumps
//     to $600/yr. A year here lasts ten seconds, so within ten more the balance
//     steps down by exactly that, tagged "1830 upkeep" in the ledger.
//  3. Then try it the other way round: Retry, and close the same gap by
//     dragging up over row 0 and back down. Six pieces instead of two — the
//     delivery is identical, and you now pay $1,800 every single year for it.
//     That is the whole mechanic: the balance became a decision.
//  4. Bulldoze one of the pieces and the annual figure falls with it. Upkeep is
//     charged on the railway that is standing when the year turns, not on what
//     you once bought.
//
// The dials are tuned for WATCHING, not for balance (`TAXYEAR_TUNING` in
// `modes/tycoon.ts`): a 10-second year and $300 a piece make each levy a step
// you can see, and $9,000 is a deep enough purse that the point lands before
// the money runs out. `lakevalley-open` is where the tax is tuned to bite, and
// `/test/bankrupt` is where it is tuned to WIN — over-build here for long
// enough and this board will fold too, but that is the other scenario's lesson.
//
// DELIBERATELY INCOMPLETE, like `buildgap`: the dangling ends either side of
// the gap are the point, so `allowIncomplete` opts the registry validation out
// of exactly the checks that would call them a broken map. The /test stage
// shows the board and the calendar; the build gesture itself lives in PlayView.
export const taxyear: TestScenario = {
  id: "taxyear",
  name: "The tax year",
  description:
    "A calendar, and an annual bill for every piece of track you laid. Close the gap cheaply or scenically — the upkeep remembers which.",
  modeId: "tycoon",
  allowIncomplete: true,
  size: { cols: 6, rows: 3 },
  level: {
    // West: the origin station and its line, ending open at 1,1's east edge.
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    // 2,1 and 3,1: the gap. Two tiles the direct link costs; the empty rows
    // above and below are buildable too, which is what makes the expensive
    // route a real option rather than a thought experiment.
    // East: one stub of line and the destination station, open at 4,1's west.
    "4,1": expandKind("straight", 1),
    "5,1": expandKind("depot", 3),
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
