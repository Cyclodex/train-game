import { Position } from "@/types";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkLineTrain } from "@/levels/test/scenario";
import { expandKind } from "@/tiles/kinds";

// A LINE THAT NAMES A STOP TWICE — A → C → B → C, the Transport-Fever shape.
//
// Three stations on one straight: A at the west end, B at the east, C in the
// middle. The line calls at C in BOTH directions by naming it twice, and the
// order is the contract: the train works A, C, B, C, A, C, B, C … for ever,
// turning back at the depot past each end of the line.
//
// What to watch:
//  1. **C is served twice a lap** — once outbound, once on the way home — and
//     never twice in a row (the transit layer refuses a doubled call).
//  2. **The order holds.** Bound for A, the train runs PAST C and B without
//     stopping: a lined train calls only at the stop it is heading for. This
//     board exists because the old rule ("call at any of the line's stops when
//     passing") let every en-route platform hijack the cursor — on a ring, a
//     stop whose route led past the others was never reached at all.
//  3. **Open the line's Edit view**: C's badge carries both call positions
//     ("2·4"), because a revisit is a fact the player drew and should read.
const stn = (name: string): TileCell => ({
  connections: [[Position.Left, Position.Right]],
  role: "station",
  stationName: name,
});

export const linerevisit: TestScenario = {
  id: "linerevisit",
  name: "A line calls twice (A→C→B→C)",
  description:
    "The middle station is on the line twice — served outbound AND homebound, " +
    "in strict line order, with the turn-backs at the depots past each end.",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": stn("A"),
    "2,0": expandKind("straight", 1),
    "3,0": stn("C"),
    "4,0": expandKind("straight", 1),
    "5,0": stn("B"),
    "6,0": expandKind("depot", 3),
  },
  trains: {
    train1: mkLineTrain("train1", 0, 0, "people", 2, [
      "1,0",
      "3,0",
      "5,0",
      "3,0",
    ]),
  },
  colors: {
    depotColors: { "0,0": "blue", "6,0": "blue" },
    trainColors: { train1: "green" },
  },
  size: { cols: 7, rows: 1 },
};
