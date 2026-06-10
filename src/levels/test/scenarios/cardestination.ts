import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// 4-way road junction for demonstrating car destination route planning.
// Cars spawn from all four edges and the BFS planner picks a random exit arm.
// Enable Debug mode to see:
//   - Cyan directed arrows on each lane in the road network.
//   - A small "→N" label on the tile a car is currently heading toward,
//     where N is the car's numeric ID.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });

export const cardestination: TestScenario = {
  id: "cardestination",
  name: "Car destinations: route planning debug",
  description:
    "4-way junction where each car plans a BFS route to a random exit. Enable Debug to " +
    "see the lane-graph arrows (cyan = car lane) and destination markers on exit tiles.",
  level: {
    // Horizontal arm.
    "0,2": road([Position.Left, Position.Right]),
    "1,2": road([Position.Left, Position.Right]),
    "3,2": road([Position.Left, Position.Right]),
    "4,2": road([Position.Left, Position.Right]),
    // Vertical arm.
    "2,0": road([Position.Top, Position.Bottom]),
    "2,1": road([Position.Top, Position.Bottom]),
    "2,3": road([Position.Top, Position.Bottom]),
    "2,4": road([Position.Top, Position.Bottom]),
    // Full 4-way junction tile with all turn movements.
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
