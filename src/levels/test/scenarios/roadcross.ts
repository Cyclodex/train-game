import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// Road-junction interlock: two car streams cross at a 4-way road intersection
// without gridlocking in the middle.
//
// A horizontal road (row y=2) and a vertical road (column x=2) cross at (2,2).
// Cars spawn one-way from the two "near" edges (Left → eastbound, Bottom →
// northbound), so the two streams meet head-to-side at the centre tile. The
// junction is a single mutually-exclusive resource: a car only enters it when no
// other car occupies it, waiting clear of the entry edge otherwise (instead of
// rolling halfway in, which is what jams two perpendicular queues into a frozen
// cross). The streams take turns through the crossing and never deadlock.
//
// There is no rail here — it's a pure road feature — so the scenario has no
// trains; the car simulation runs on its own.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });

export const roadcross: TestScenario = {
  id: "roadcross",
  name: "Road junction interlock",
  description:
    "Two one-way car streams cross a 4-way road intersection, taking turns through the centre instead of gridlocking.",
  level: {
    // Vertical road, north–south through the centre.
    "2,0": road([Position.Top, Position.Bottom]),
    "2,1": road([Position.Top, Position.Bottom]),
    "2,3": road([Position.Top, Position.Bottom]),
    "2,4": road([Position.Top, Position.Bottom]),
    // Horizontal road, west–east through the centre.
    "0,2": road([Position.Left, Position.Right]),
    "1,2": road([Position.Left, Position.Right]),
    "3,2": road([Position.Left, Position.Right]),
    "4,2": road([Position.Left, Position.Right]),
    // The crossing itself: both roads pass straight through.
    "2,2": road([Position.Left, Position.Right], [Position.Top, Position.Bottom]),
  },
  trains: {},
  size: { cols: 5, rows: 5 },
};
