import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// Many cars on a winding S-shaped road with sustained sequential curves.
//
// The road snakes in an S: enters from the left (westbound side), turns
// southeast at (2,0), immediately curves back west at (2,1), runs west,
// curves southwest at (0,1), then turns northeast at (0,2) and exits at
// the bottom-right. Multiple 90° bends in quick succession keep cars
// constantly in curves with very little straight between them, so the
// CAR_GAP spacing is under maximum stress through the bends.
//
const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });

export const carscurve: TestScenario = {
  id: "carscurve",
  name: "Cars on S-curve road",
  description:
    "Many cars snake through a tight S-shaped road with four sequential 90° curves — maximum time in bends to stress gap spacing.",
  level: {
    // Top leg: enters left, runs east, curves down
    "0,0": road([Position.Left, Position.Right]),   // straight east (entry)
    "1,0": road([Position.Left, Position.Right]),   // straight east
    "2,0": road([Position.Left, Position.Bottom]),  // SE curve — turns south

    // Middle leg: curves back west immediately
    "2,1": road([Position.Top, Position.Left]),     // SW curve — turns west
    "1,1": road([Position.Right, Position.Left]),   // straight west
    "0,1": road([Position.Right, Position.Bottom]), // SW curve — turns south

    // Bottom leg: curves east, exits south
    "0,2": road([Position.Top, Position.Right]),    // NE curve — turns east
    "1,2": road([Position.Left, Position.Right]),   // straight east
    "2,2": road([Position.Left, Position.Bottom]),  // SE curve — exits south (open edge)
  },
  trains: {},
  size: { cols: 3, rows: 3 },
  // Single entry from the left; cars exit off the bottom of (2,2) and despawn.
  // Aggressive spawn keeps the whole S densely packed at all times.
  traffic: {
    spawnInterval: 0.5,
    maxCars: 16,
    spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
  },
};
