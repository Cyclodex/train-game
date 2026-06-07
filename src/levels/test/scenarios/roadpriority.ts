import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// T-junction where a horizontal main road (roadPriority: 1) meets a vertical
// side road (roadPriority: 0) from the south. Side-road cars yield to
// main-road traffic; the starvation guard lets them through after 5 s of
// continuous yielding.
//
// Layout (5×5):
//   row 2: horizontal main road (west–east)
//   col 2, rows 3–4: south side road
//   "2,2": T-junction tile — L↔R through + L/R↔Bottom turns (no north arm)
//
// There is no rail here — pure road priority scenario. Cars spawn from both
// roads so the yield behaviour is visible under load.
const road = (priority: number, ...ports: [Position, Position][]) => ({
  connections: [] as [Position, Position][],
  road: fromPairs(ports),
  roadPriority: priority,
});

export const roadpriority: TestScenario = {
  id: "roadpriority",
  name: "Road priority: main vs side road",
  description:
    "T-junction where a main road (priority 1) meets a side road (priority 0). Side-road cars yield to main-road traffic, but the starvation guard lets them through after 5 s.",
  level: {
    // Main road (horizontal).
    "0,2": road(1, [Position.Left, Position.Right]),
    "1,2": road(1, [Position.Left, Position.Right]),
    // T-junction: through traffic L↔R; side road turns L/R↔Bottom.
    // No [Top, Bottom] pair — there is no north arm.
    "2,2": road(
      1,
      [Position.Left, Position.Right],
      [Position.Left, Position.Bottom],
      [Position.Right, Position.Bottom],
    ),
    "3,2": road(1, [Position.Left, Position.Right]),
    "4,2": road(1, [Position.Left, Position.Right]),
    // Side road (vertical, south arm only).
    "2,3": road(0, [Position.Top, Position.Bottom]),
    "2,4": road(0, [Position.Top, Position.Bottom]),
  },
  trains: {},
  size: { cols: 5, rows: 5 },
};
