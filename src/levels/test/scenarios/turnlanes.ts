import { Position } from "@/types";
import { Port } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { Lane } from "@/tiles/lanes";

// Widening one-way approach into a full 4-way cross. A single northbound one-way
// road spawns at the south edge and OPENS UP from 1 → 2 → 3 lanes as it climbs,
// then meets a full crossroads and fans out straight / left / right.
//
// Arm widths follow the two different rules a one-way junction actually paints by:
//
//   TURN arms match the lanes that take the turn. A one-way junction paints
//   LANE-ANCHORED slip channels covering only the turning lanes, so a 1-lane turn
//   into a 3-lane arm necks at the seam and leaves tarmac no car ever drives.
//   `syncJunctionLanesAround` splits the 3 approach lanes inner→left,
//   middle→straight, kerb→right+straight, so exactly one lane turns each way and
//   the west and east arms are 1 lane wide.
//
//   The STRAIGHT arm matches the junction's THROUGH CORRIDOR, which is painted to
//   the widest arm (here the 3-lane approach) — not the number of straight
//   movements. Only 2 lanes go straight, but narrowing the north arm to 2 tapers
//   the corridor and paints a closure gore right at the junction exit, so it stays
//   3. Toggle Debug for the per-lane turn arrows.

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
    "and right. The turn arms are 1 lane each — exactly the lanes that turn — so " +
    "each slip channel meets its arm flush instead of necking into unused tarmac, " +
    "while the straight arm stays 3 to match the through corridor. Toggle Debug.",
  level: {
    // South arm: one-way northbound, widening toward the junction.
    "3,7": { connections: [], road: oneWayN(B, T, 1) }, // single lane (spawn here)
    "3,6": { connections: [], road: oneWayN(B, T, 2) }, // opens to 2
    "3,5": { connections: [], road: oneWayN(B, T, 3) }, // opens to 3
    "3,4": { connections: [], road: oneWayN(B, T, 3) }, // 3-lane approach
    // The crossroads.
    "3,3": { connections: [], road: crossCentre() },
    // North exit arm (straight): 3 lanes — the STRAIGHT arm matches the junction's
    // through corridor (which is painted to the widest arm), not the number of
    // straight movements. Narrowing it to 2 would taper the corridor and paint a
    // closure gore immediately after the junction.
    "3,2": { connections: [], road: oneWayN(B, T, 3) },
    "3,1": { connections: [], road: oneWayN(B, T, 3) },
    "3,0": { connections: [], road: oneWayN(B, T, 3) },
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
