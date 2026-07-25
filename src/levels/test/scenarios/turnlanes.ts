import { Position } from "@/types";
import { Port } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { Lane } from "@/tiles/lanes";

// Widening one-way approach into a full 4-way cross. A single northbound one-way
// road spawns at the south edge and OPENS UP from 1 → 2 → 3 lanes as it climbs,
// then meets a full crossroads and fans out straight / left / right.
//
// Each EXIT ARM is sized to the lanes that actually take its movement, which is
// what keeps the junction flush. `syncJunctionLanesAround` derives the movements
// from the arm widths (receiving-capacity rule), so the 3 approach lanes split
// inner→left, middle→straight, kerb→right+straight: 1 lane turns west, 1 turns
// east, 2 go straight. The arms are therefore 1 / 2 / 1 lanes wide, not a uniform
// 3 — a one-way junction paints LANE-ANCHORED slip channels covering only the
// turning lanes, so a 1-lane turn into a 3-lane arm necks visibly at the seam and
// leaves two lanes of tarmac no car ever drives. Match arm width to turning lanes
// and every painted lane carries traffic. Toggle Debug for the per-lane turn arrows.

const T = Position.Top;
const B = Position.Bottom;
const L = Position.Left;
const R = Position.Right;

// One-way road from `from` toward `to` with `n` lanes (indices 0..n-1).
function oneWayN(from: Port, to: Port, n: number): Lane[] {
  return Array.from({ length: n }, (_, i) => ({ from, to: [to], index: i }));
}

// The crossroads centre: the three inbound (south) lanes reach all three exits.
// `syncJunctionLanesAround` then narrows each lane to the movements its arm can
// receive (inner→left, middle→straight, kerb→right+straight).
function crossCentre(): Lane[] {
  return Array.from({ length: 3 }, (_, i) => ({ from: B, to: [T, L, R], index: i }));
}

export const turnlanes: TestScenario = {
  id: "turnlanes",
  name: "Turn lanes: one-way widens 1→2→3 into a cross",
  description:
    "A single one-way road spawns at the south edge and opens up from 1 to 2 to 3 " +
    "lanes as it climbs into a full 4-way crossroads, then fans out left, straight " +
    "and right. Each exit arm is as wide as the number of lanes that actually turn " +
    "into it (1 west, 2 north, 1 east), so every slip channel meets its arm flush " +
    "and no lane is painted that cars never use. Toggle Debug for the turn arrows.",
  level: {
    // South arm: one-way northbound, widening toward the junction.
    "3,7": { connections: [], road: oneWayN(B, T, 1) }, // single lane (spawn here)
    "3,6": { connections: [], road: oneWayN(B, T, 2) }, // opens to 2
    "3,5": { connections: [], road: oneWayN(B, T, 3) }, // opens to 3
    "3,4": { connections: [], road: oneWayN(B, T, 3) }, // 3-lane approach
    // The crossroads.
    "3,3": { connections: [], road: crossCentre() },
    // North exit arm (straight): 2 lanes — the two approach lanes that go straight.
    "3,2": { connections: [], road: oneWayN(B, T, 2) },
    "3,1": { connections: [], road: oneWayN(B, T, 2) },
    "3,0": { connections: [], road: oneWayN(B, T, 2) },
    // West exit arm (left turn): 1 lane — only the inner approach lane turns left.
    "2,3": { connections: [], road: oneWayN(R, L, 1) },
    "1,3": { connections: [], road: oneWayN(R, L, 1) },
    "0,3": { connections: [], road: oneWayN(R, L, 1) },
    // East exit arm (right turn): 1 lane — only the kerb approach lane turns right.
    "4,3": { connections: [], road: oneWayN(L, R, 1) },
    "5,3": { connections: [], road: oneWayN(L, R, 1) },
    "6,3": { connections: [], road: oneWayN(L, R, 1) },
  },
  trains: {},
  size: { cols: 7, rows: 8 },
  // Steady flow from the single south source so the widening approach is easy to
  // watch (the test world's live Cars slider scales density on top of this).
  traffic: { spawnInterval: 0.7, maxCars: 14 },
};
