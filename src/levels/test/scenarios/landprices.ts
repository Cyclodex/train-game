import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { TerrainKind, TileCell } from "@/tiles/model";

// Land prices — the terrain build surcharge in isolation (Tycoon phase 2).
//
// `buildgap` with ground that costs money: the three-tile gap crosses grass
// ($1,000), a wood ($1,500) and a town ($2,500) — $5,000 for the direct link,
// against a $6,000 budget (LANDPRICES_TUNING). Arm Build and hover the gap: the
// preview tag prices each ground differently, out of the same table the charge
// reads (TERRAIN_BUILD_FACTOR), so what's shown is what's billed. The budget
// affords the direct link with one spare grass piece — the surcharge, not the
// base rate, is what makes wandering unaffordable.
//
// The /test stage shows the board and its waiting train; the build gesture
// lives in PlayView, so play it at /#/play?mode=tycoon&board=landprices.
const ground = (terrain: TerrainKind) => (): TileCell => ({ connections: [], terrain });
const F = ground("forest");
const U = ground("urban");

export const landprices: TestScenario = {
  id: "landprices",
  name: "Land prices",
  description:
    "A gap over grass, wood and town: the same track at three prices. Close it and deliver.",
  modeId: "tycoon",
  allowIncomplete: true,
  size: { cols: 8, rows: 3 },
  level: {
    // West: the origin station and its line, ending open at 2,1's east edge.
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    "2,1": expandKind("straight", 1),
    // THE GAP: 3,1 bare grass, 4,1 through the wood, 5,1 through the town.
    "4,1": F(),
    "5,1": U(),
    // East: one stub of line and the destination station, open at 6,1's west.
    "6,1": expandKind("straight", 1),
    "7,1": expandKind("depot", 3),
    // The wood and the town the gap cuts through, so the surcharges read as
    // places rather than as invisible price tags.
    "4,0": F(),
    "4,2": F(),
    "5,0": U(),
    "5,2": U(),
    "6,0": U(),
  },
  trains: {
    t1: mkTrain("t1", 0, 1, "people", 1, "7,1"),
  },
  // Pinned for the /test stage so the waiting train always matches the depot
  // across the gap (same convention as buildgap).
  colors: {
    depotColors: { "0,1": "blue", "7,1": "green" },
    trainColors: { t1: "green" },
  },
};
