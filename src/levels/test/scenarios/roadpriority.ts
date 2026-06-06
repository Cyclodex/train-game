import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";

// T-junction where a horizontal main road (roadPriority: 1) meets a vertical
// side road (roadPriority: 0) from the south. Side-road cars yield to
// main-road traffic; the starvation guard lets them through after 5 s of
// continuous yielding.
//
// There is no rail here — pure road priority scenario. Cars spawn from both
// roads so the yield behaviour is visible under load.
const main = (...ports: [Position, Position][]) => ({
  connections: [] as [Position, Position][],
  road: ports,
  roadPriority: 1,
});
const side = (...ports: [Position, Position][]) => ({
  connections: [] as [Position, Position][],
  road: ports,
  roadPriority: 0,
});

export const roadpriority: TestScenario = {
  id: "roadpriority",
  name: "Road priority: main vs side road",
  description:
    "T-junction where a main road (priority 1) meets a side road (priority 0). Side-road cars yield to main-road traffic, but the starvation guard lets them through after 5 s.",
  level: {
    // Main road (horizontal).
    "0,2": main([Position.Left, Position.Right]),
    "1,2": main([Position.Left, Position.Right]),
    "2,2": main(
      [Position.Left, Position.Right],
      [Position.Top, Position.Bottom],
      [Position.Left, Position.Bottom],
      [Position.Right, Position.Bottom],
    ),
    "3,2": main([Position.Left, Position.Right]),
    "4,2": main([Position.Left, Position.Right]),
    // Side road (vertical, south arm only).
    "2,3": side([Position.Top, Position.Bottom]),
    "2,4": side([Position.Top, Position.Bottom]),
  },
  trains: {},
  size: { cols: 5, rows: 5 },
};
