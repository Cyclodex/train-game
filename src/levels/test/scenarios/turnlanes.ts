import { Position } from "@/types";
import { Port } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { Lane } from "@/tiles/lanes";

// Widening one-way approach into a full 4-way cross. A single northbound one-way
// road spawns at the south edge and OPENS UP from 1 → 2 → 3 lanes as it climbs,
// then meets a full crossroads and fans out straight / left / right.
//
// The whole layout is a UNIFORM one-way system: every arm carries the same three
// one-way lanes, so every seam is the same width and nothing tapers. (A one-way
// road is half the width of a two-way one, so feeding a two-way cross — or fanning
// 3 lanes into 1-lane exits — leaves the junction pinched and painted with
// lane-drop hatching; matching the arm widths is what keeps it flush.) Each of the
// three approach lanes may take any turn through the centre. Toggle Debug for the
// per-lane turn arrows.

const T = Position.Top;
const B = Position.Bottom;
const L = Position.Left;
const R = Position.Right;

// One-way road from `from` toward `to` with `n` lanes (indices 0..n-1).
function oneWayN(from: Port, to: Port, n: number): Lane[] {
  return Array.from({ length: n }, (_, i) => ({ from, to: [to], index: i }));
}

// The crossroads centre: the three inbound (south) lanes each fan out to all three
// exits (straight north, left west, right east). Three lanes cross every seam, so
// every arm — inbound or outbound — is the same width.
function crossCentre(): Lane[] {
  return Array.from({ length: 3 }, (_, i) => ({ from: B, to: [T, L, R], index: i }));
}

export const turnlanes: TestScenario = {
  id: "turnlanes",
  name: "Turn lanes: one-way widens 1→2→3 into a cross",
  description:
    "A single one-way road spawns at the south edge and opens up from 1 to 2 to 3 " +
    "lanes as it climbs into a full 4-way crossroads, then fans out straight, left " +
    "and right. Every arm is a uniform 3-lane one-way road, so all four seams stay " +
    "flush — no pinching or lane-drop hatching. Toggle Debug for the turn arrows.",
  level: {
    // South arm: one-way northbound, widening toward the junction.
    "3,7": { connections: [], road: oneWayN(B, T, 1) }, // single lane (spawn here)
    "3,6": { connections: [], road: oneWayN(B, T, 2) }, // opens to 2
    "3,5": { connections: [], road: oneWayN(B, T, 3) }, // opens to 3
    "3,4": { connections: [], road: oneWayN(B, T, 3) }, // 3-lane approach
    // The crossroads.
    "3,3": { connections: [], road: crossCentre() },
    // North exit arm (straight): one-way northbound, 3 lanes.
    "3,2": { connections: [], road: oneWayN(B, T, 3) },
    "3,1": { connections: [], road: oneWayN(B, T, 3) },
    "3,0": { connections: [], road: oneWayN(B, T, 3) },
    // West exit arm (left turn): one-way westbound, 3 lanes.
    "2,3": { connections: [], road: oneWayN(R, L, 3) },
    "1,3": { connections: [], road: oneWayN(R, L, 3) },
    "0,3": { connections: [], road: oneWayN(R, L, 3) },
    // East exit arm (right turn): one-way eastbound, 3 lanes.
    "4,3": { connections: [], road: oneWayN(L, R, 3) },
    "5,3": { connections: [], road: oneWayN(L, R, 3) },
    "6,3": { connections: [], road: oneWayN(L, R, 3) },
  },
  trains: {},
  size: { cols: 7, rows: 8 },
  // Steady flow from the single south source so the widening approach is easy to
  // watch (the test world's live Cars slider scales density on top of this).
  traffic: { spawnInterval: 0.7, maxCars: 14 },
};
