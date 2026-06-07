import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// Route-inspection demo. A compact 4-way intersection with a single short arm in
// each direction, kept deliberately quiet (few cars) so you can hover/click one
// car and clearly see its centreline route bend through the junction.
//
// This is the test stage for the **car route debug overlay**: turn debug on (it
// is on by default here), hover a car to preview where it is going, and click it
// to pin that route while it drives. There is no rail — pure road.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });

export const carroute: TestScenario = {
  id: "carroute",
  name: "Car route: inspect where a car is going",
  description:
    "Quiet 4-way intersection. With debug on, hover a car to preview its route and click to pin it — watch the line bend at the junction as the car turns.",
  level: {
    // One short arm off each side of the central junction.
    "1,0": road([Position.Top, Position.Bottom]),
    "0,1": road([Position.Left, Position.Right]),
    "2,1": road([Position.Left, Position.Right]),
    "1,2": road([Position.Top, Position.Bottom]),
    // The junction tile carries every turn so a car can go straight, left or right
    // from any arm — giving the router real choices to visualise.
    "1,1": road(
      [Position.Left, Position.Right],
      [Position.Top, Position.Bottom],
      [Position.Left, Position.Top],
      [Position.Left, Position.Bottom],
      [Position.Right, Position.Top],
      [Position.Right, Position.Bottom],
    ),
  },
  trains: {},
  size: { cols: 3, rows: 3 },
  // Quiet roads: a long spawn interval and a small cap keep only a car or two on
  // the map at a time, so a single route is easy to follow.
  traffic: { spawnInterval: 2.5, maxCars: 3 },
};
