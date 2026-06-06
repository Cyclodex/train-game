import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// 4-way road intersection where cars can enter from all four arms and take any
// exit (straight, left turn, right turn). The centre tile has explicit turn
// connections so that `partnersOf(road, Left)` returns more than just `[Right]`
// and cars actually have choices when routing.
//
// There is no rail here — pure road scenario. Cars spawn from all four edges.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });

export const roadjunction: TestScenario = {
  id: "roadjunction",
  name: "Road junction: all directions",
  description:
    "4-way intersection with cars entering from all four arms in all directions (right/straight/left). Non-conflicting movements flow simultaneously.",
  level: {
    // Horizontal road.
    "0,2": road([Position.Left, Position.Right]),
    "1,2": road([Position.Left, Position.Right]),
    "3,2": road([Position.Left, Position.Right]),
    "4,2": road([Position.Left, Position.Right]),
    // Vertical road.
    "2,0": road([Position.Top, Position.Bottom]),
    "2,1": road([Position.Top, Position.Bottom]),
    "2,3": road([Position.Top, Position.Bottom]),
    "2,4": road([Position.Top, Position.Bottom]),
    // The crossing tile with all turn connections so cars can go straight,
    // turn left, or turn right from any arm.
    "2,2": road(
      [Position.Left, Position.Right],
      [Position.Top, Position.Bottom],
      [Position.Left, Position.Top],
      [Position.Left, Position.Bottom],
      [Position.Right, Position.Top],
      [Position.Right, Position.Bottom],
    ),
  },
  trains: {},
  size: { cols: 5, rows: 5 },
};
