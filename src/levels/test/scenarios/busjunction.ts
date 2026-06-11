import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, nWayLanes } from "@/tiles/lanes";

// A T-junction where the east arm is a bus-only street (no car lanes). Cars
// drive the north–south through road and must NOT be routed into the east arm,
// even though the junction tile carries a physical (car-lane) connection toward
// it (as the editor authors it). The routing fix excludes bus-only-adjacent arms
// from the car-destination list, so cars never take the east exit and despawn.
//
// Without the fix: some cars are planned a route to the junction's east exit,
// drive toward the bus-only road, and vanish at the boundary. The "disappear
// behind the bus lane" symptom is exactly this.
// With the fix: all cars route north–south; no car ever reaches the east arm.

const T = Position.Top;
const R = Position.Right;
const B = Position.Bottom;

// One car lane in each direction (N and S), plus an east arm that physically
// connects to the bus-only road. The east arm's car lane is what the editor
// creates when you draw a connection; the routing logic must exclude it.
function junctionCenter(): { connections: []; road: Lane[] } {
  return {
    connections: [],
    road: [
      { from: T, to: [B, R], index: 0 }, // car from north: straight or right
      { from: B, to: [T, R], index: 0 }, // car from south: straight or right
      { from: R, to: [T, B], index: 0 }, // car from east (bus-only road side)
    ],
  };
}

// Bus-only road: a single bus lane each direction, NO car lanes.
function busOnly(): { connections: []; road: Lane[] } {
  return {
    connections: [],
    road: [
      { from: Position.Left, to: [Position.Right], index: 0, kind: "bus" },
      { from: Position.Right, to: [Position.Left], index: 0, kind: "bus" },
    ],
  };
}

export const busjunction: TestScenario = {
  id: "busjunction",
  name: "Junction: bus-only arm (cars must not enter)",
  description:
    "A T-junction whose east arm leads to a bus-only street. Cars drive the " +
    "north–south through road; the junction's east arm is physically wired as " +
    "a car connection (as the editor creates it), but cars must not be routed " +
    "there — the routing excludes bus-only dead-ends as car destinations. Enable " +
    "Debug to see the amber bus-lane markings and confirm every car stays on the " +
    "N–S road and never enters the orange east arm.",
  level: {
    // North–south through road (1 car lane each way).
    "2,0": { connections: [], road: nWayLanes(T, B, 1) },
    "2,1": { connections: [], road: nWayLanes(T, B, 1) },
    "2,2": junctionCenter(),
    "2,3": { connections: [], road: nWayLanes(T, B, 1) },
    "2,4": { connections: [], road: nWayLanes(T, B, 1) },
    // East arm: bus-only road (no car lanes — cars must never enter here).
    "3,2": busOnly(),
    "4,2": busOnly(),
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  traffic: { mix: { car: 1 }, spawnInterval: 1.0, maxCars: 6 },
};
