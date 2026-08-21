import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

const { Left, Right } = Position;

// The meadow's BACKDROP trees layered like real foliage: the seeded scatter that
// used to be a CSS texture UNDER the board now renders as a world overlay in the
// canopy z band (components/BackdropTrees.vue), so a crown that overlaps the
// line sits ON TOP of the rails, the train and the road cars — the same
// pass-under effect a forest canopy has (see /test/clearing). And the same
// right-of-way rule: a trunk standing IN the ballast or on the tarmac is
// felled (TRUNK_CLEAR vs the cell's corridors), only trees BESIDE the line
// survive to overhang it.
//
// A rail line and a one-way street run side by side across open meadow; the
// fixed backdrop seed scatters trees along both corridors, so some are felled
// and the survivors' crowns hang over the passing train and cars. With the
// stage's 🌳 BG toggle off (flat debug ground) the overlay disappears with the
// rest of the theme.
export const backdroptrees: TestScenario = {
  id: "backdroptrees",
  name: "Backdrop trees",
  description:
    "Meadow backdrop crowns render above rails, trains and cars; trunks keep out of the right-of-way like the forest's (toggle 🌳 BG to strip them).",
  // The rows are PICKED AGAINST THE SEED: with the fixed 680px layout, row 0's
  // carriageway swallows three trunks while big crowns lean over it from both
  // verges, and row 3's ballast fells a cluster while the tall tree just south
  // of it (world ~(603,728)) spreads its crown right across the track.
  level: {
    // --- Road: a one-way street along the top, cars flowing east ---
    "0,0": { connections: [], road: fromPairs([[Left, Right]]) },
    "1,0": { connections: [], road: fromPairs([[Left, Right]]) },
    "2,0": { connections: [], road: fromPairs([[Left, Right]]) },
    "3,0": { connections: [], road: fromPairs([[Left, Right]]) },
    "4,0": { connections: [], road: fromPairs([[Left, Right]]) },
    // --- Rail: a straight run along the bottom, depot to depot ---
    "0,3": expandKind("depot", 1), // opens east
    "1,3": expandKind("straight", 1),
    "2,3": expandKind("straight", 1),
    "3,3": expandKind("straight", 1),
    "4,3": expandKind("depot", 3), // opens west
  },
  trains: {
    train1: mkTrain("train1", 0, 3, "people", 2, "4,3"),
  },
  size: { cols: 5, rows: 4 },
};
