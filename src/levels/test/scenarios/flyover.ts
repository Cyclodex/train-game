import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Grade separation in isolation: two lines cross at ONE cell, and the
// north-south line rides a deck OVER the east-west one. No junction, no
// switch, no conflict — the two trains cross the same tile at the same moment
// and never see each other.
//
// What makes this different from the `cross` scenario one gallery over: a flat
// diamond crossing is ONE piece of track, so the interlocking serialises it —
// on an unsignalled board the first train reserves its whole route at
// departure and the second waits at its depot door until the line clears. Here
// `TileCell.flyover` names the pair that rides the deck, and the sim keys
// occupancy/reservation per LEVEL (`claimKey`): the deck and the ground line
// are different "tiles" as far as contention goes, so both trains roll on
// tick one and meet in the middle, one above the other.
//
// Watch for: the deck carries its own track and parapet; the upper train is
// lifted above the deck while the lower one slips underneath it; and the
// debug overlay shows BOTH trains' reservations across the shared cell.
//
// The flyover is authored data (there is deliberately no auto-flyover — see
// tiles/model.ts): crossing an existing line with the editor's route tool
// still builds a flat junction. An editor verb for it is a follow-up.
const level: Record<string, TileCell> = {};

// The east-west line, along row 2.
for (let x = 0; x <= 6; x++) level[`${x},2`] = expandKind("straight", 1);
// The north-south line, down column 3.
for (let y = 0; y <= 4; y++) level[`3,${y}`] = expandKind("straight", 0);
// Where they meet: two independent pairs, the vertical one on the deck.
level["3,2"] = {
  connections: [
    [Position.Left, Position.Right],
    [Position.Top, Position.Bottom],
  ],
  flyover: [Position.Top, Position.Bottom],
};
level["0,2"] = expandKind("depot", 1);
level["6,2"] = expandKind("depot", 3);
level["3,0"] = expandKind("depot", 2);
level["3,4"] = expandKind("depot", 0);

export const flyover: TestScenario = {
  id: "flyover",
  name: "Flyover crossing",
  description:
    "Two lines cross one cell at two levels: the deck pair and the ground pair claim separately, so both trains cross at the same moment — no junction, no held train, no collision risk.",
  size: { cols: 7, rows: 5 },
  level,
  trains: {
    train1: mkTrain("train1", 0, 2, "people", 2, "6,2"),
    train2: mkTrain("train2", 3, 0, "people", 2, "3,4"),
  },
};
