import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Fares priced by DISTANCE, in isolation (Tycoon).
//
// Two identical trains — same type, same single wagon — on two disjoint lanes.
// The only difference is how far the job is: two tiles for `shorthaul`, eight
// for `longhaul`. Read the two pins the moment the board opens and the pricing
// is the whole demo:
//
//   shorthaul  $470   = handling 250 + wagon 150 +  2 tiles x 35
//   longhaul   $680   = handling 250 + wagon 150 +  8 tiles x 35
//
// …then leave them sitting and watch the SECOND half of the model. The short
// fare falls in big chunks and bottoms out in 16s; the long one ticks gently and
// survives four times as long, because the decay is normalised to each train's
// own ideal trip (`fareFor`). Both bottom out after the same number of ideal
// trips, so the long haul is a bigger prize and NOT a harder one to collect —
// which is the point. Before 2026-07-26 both would have shown the same $600 and
// decayed at the same per-second rate, making the long haul strictly worse.
//
// Two lanes rather than one train, because the mechanic only means anything as a
// comparison: a single fare is just a number. Disjoint lanes so neither train can
// block the other and the only variable is the length of its job. Colours are
// pinned so both park on a real match — a mismatched arrival pays nothing and
// would muddle the reading.
export const faredistance: TestScenario = {
  id: "faredistance",
  name: "Fares by distance",
  description:
    "Same train, different haul: the long job is worth more and burns slower — distance is a prize, not a penalty.",
  modeId: "tycoon",
  level: {
    // Short haul: 0,0 → 2,0 (two tiles of demand).
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("depot", 3),
    // Long haul: 0,2 → 8,2 (eight tiles of demand).
    "0,2": expandKind("depot", 1),
    "1,2": expandKind("straight", 1),
    "2,2": expandKind("straight", 1),
    "3,2": expandKind("straight", 1),
    "4,2": expandKind("straight", 1),
    "5,2": expandKind("straight", 1),
    "6,2": expandKind("straight", 1),
    "7,2": expandKind("straight", 1),
    "8,2": expandKind("depot", 3),
  },
  trains: {
    shorthaul: mkTrain("shorthaul", 0, 0, "people", 1, "2,0"),
    longhaul: mkTrain("longhaul", 0, 2, "people", 1, "8,2"),
  },
  colors: {
    depotColors: {
      "0,0": "blue", // home — deliberately NOT the train's colour, or it parks at home
      "2,0": "green",
      "0,2": "blue",
      "8,2": "red",
    },
    trainColors: {
      shorthaul: "green",
      longhaul: "red",
    },
  },
};
