import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { oneWayLanes, turns, type Lane } from "@/tiles/lanes";

// Diagnostic fixture for one-way TURN-LANE rendering across MIXED exit widths.
//
// A single northbound one-way road spawns at the south edge and widens 1 → 2 → 3
// lanes, then climbs through THREE stacked junctions. Each junction fans the three
// approach lanes out straight / left / right, but onto exit arms of DIFFERENT
// width, so we can watch the turn arrows, lane-divider markings and the junction
// throat against 3-lane, 1-lane and 2-lane exits in one view:
//
//   3,1  →  2-lane West / East exits   (top)
//   3,2  →  1-lane West / East exits   (middle)
//   3,3  →  3-lane West / East exits   (bottom)
//
// Per-lane turn assignment uses the model's `index 0 = kerb side` convention:
// the kerb lane (index0) carries the straight + right(east) movement, the inner
// lane (index2) takes the dedicated left(west) turn. Toggle Debug for the per-lane
// turn arrows + driving-lines — this is the fixture for verifying that a lane's
// straight arrow and its turn arrow start from the SAME lane (one-way offset must
// match between the straight and the turn branch), and that a 3→1 / 3→2 turn
// throat reads cleanly.

const T = Position.Top;
const B = Position.Bottom;
const L = Position.Left;
const R = Position.Right;

// A junction centre that fans the three southbound approach lanes out by lane:
//   kerb lane  (index0) → right(east) + straight
//   middle     (index1) → straight
//   inner lane (index2) → left(west)
function fanCentre(): Lane[] {
  return [turns(B, [R, T], 0), turns(B, [T], 1), turns(B, [L], 2)];
}

export const turnfan: TestScenario = {
  id: "turnfan",
  name: "Turn fan: one-way widens, fans onto 1L / 2L / 3L exits",
  description:
    "A one-way road widens 1→2→3 lanes, then climbs through three junctions that " +
    "fan the lanes out straight / left / right onto exit arms of different width " +
    "(3-lane, then 1-lane, then 2-lane). Diagnostic for one-way turn-lane arrows, " +
    "lane markings and the turn throat across mixed widths. Toggle Debug for arrows.",
  level: {
    // South approach: one-way northbound, widening toward the first junction.
    "3,7": { connections: [], road: oneWayLanes(B, T, 1) },
    "3,6": { connections: [], road: oneWayLanes(B, T, 2) },
    "3,5": { connections: [], road: oneWayLanes(B, T, 3) },
    "3,4": { connections: [], road: oneWayLanes(B, T, 3) },
    // Junction stack (bottom → top): 3L exits, then 1L, then 2L.
    "3,3": { connections: [], road: fanCentre() },
    "3,2": { connections: [], road: fanCentre() },
    "3,1": { connections: [], road: fanCentre() },
    // North straight-through exit, 3 lanes.
    "3,0": { connections: [], road: oneWayLanes(B, T, 3) },
    // 3,3 side exits: 3-lane West and East.
    "2,3": { connections: [], road: oneWayLanes(R, L, 3) },
    "1,3": { connections: [], road: oneWayLanes(R, L, 3) },
    "0,3": { connections: [], road: oneWayLanes(R, L, 3) },
    "4,3": { connections: [], road: oneWayLanes(L, R, 3) },
    "5,3": { connections: [], road: oneWayLanes(L, R, 3) },
    "6,3": { connections: [], road: oneWayLanes(L, R, 3) },
    // 3,2 side exits: 1-lane West and East (3→1 lane turn throat).
    "2,2": { connections: [], road: oneWayLanes(R, L, 1) },
    "1,2": { connections: [], road: oneWayLanes(R, L, 1) },
    "0,2": { connections: [], road: oneWayLanes(R, L, 1) },
    "4,2": { connections: [], road: oneWayLanes(L, R, 1) },
    "5,2": { connections: [], road: oneWayLanes(L, R, 1) },
    "6,2": { connections: [], road: oneWayLanes(L, R, 1) },
    // 3,1 side exits: 2-lane West and East (3→2 lane turn throat).
    "2,1": { connections: [], road: oneWayLanes(R, L, 2) },
    "1,1": { connections: [], road: oneWayLanes(R, L, 2) },
    "0,1": { connections: [], road: oneWayLanes(R, L, 2) },
    "4,1": { connections: [], road: oneWayLanes(L, R, 2) },
    "5,1": { connections: [], road: oneWayLanes(L, R, 2) },
    "6,1": { connections: [], road: oneWayLanes(L, R, 2) },
  },
  trains: {},
  size: { cols: 7, rows: 8 },
  traffic: { spawnInterval: 0.7, maxCars: 18 },
};
