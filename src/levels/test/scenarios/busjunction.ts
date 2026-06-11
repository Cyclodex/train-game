import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, nWayLanes } from "@/tiles/lanes";

// A T-junction where the east arm is a bus-only street. Cars drive the N–S
// through road and never enter the east arm. Two layers of protection keep them
// out: (1) the junction's east arm is defined with bus lanes (kind: "bus"), so
// `usableExits(…, "car")` returns only the straight exit — cars literally cannot
// take the east exit from the lane model alone; (2) the roadExits() BFS planner
// also excludes bus-only adjacent arms from car destinations. The debug overlay
// shows the east arm arrows in amber (bus colour) matching the adjacent bus-only
// tiles, making the lane restriction immediately visible.

const T = Position.Top;
const R = Position.Right;
const B = Position.Bottom;

// One car lane N–S, plus a bus lane on the east arm that matches the adjacent
// bus-only road. Car lanes only permit straight movement (no east exit); the bus
// lane handles connections from the east arm so the debug overlay shows amber
// arrows matching the bus-only neighbor tiles.
function junctionCenter(): { connections: []; road: Lane[] } {
  return {
    connections: [],
    road: [
      { from: T, to: [B], index: 0 },                 // car from north: straight only
      { from: B, to: [T], index: 0 },                 // car from south: straight only
      { from: R, to: [T, B], index: 0, kind: "bus" }, // bus from east: go N or S
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
    "north–south through road and never enter the east arm (only buses can). " +
    "The junction's east arm lanes are bus-only (kind: \"bus\"), so the debug " +
    "overlay shows them in amber matching the adjacent bus-only tiles. Enable " +
    "Debug to see the amber bus-lane arrows on the east arm and confirm every " +
    "car stays on the N–S road.",
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
