import { Position } from "@/types";
import { Port } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { Lane } from "@/tiles/lanes";

// Turn-aware lane discipline on an UNRESTRICTED cross. A single 3-lane one-way road
// climbs north into an all-turns crossroads where EVERY approach lane may go
// straight, left or right — there is no dedicated turn lane to force the choice.
// Even so, cars sort themselves by the turn they will take: a left-turner eases to
// the INNER lane (index 2), a right-turner and a straight-through keep to the KERB
// lane (index 0), a few tiles before the box — instead of cutting across from
// whichever lane they spawned in. (Contrast `turnlanes`, where the lanes are
// dedicated and the junction geometry itself dictates the lane.)
//
// Watch with Debug on: the cyan driving-lines show each car drifting to the correct
// side of the road on the approach, not at the seam.

const T = Position.Top;
const B = Position.Bottom;
const L = Position.Left;
const R = Position.Right;

// One-way road from `from` toward `to` with `n` lanes (indices 0..n-1).
function oneWayN(from: Port, to: Port, n: number): Lane[] {
  return Array.from({ length: n }, (_, i) => ({ from, to: [to], index: i }));
}

// All-turns cross centre: each of the 3 southbound-approach lanes may exit straight
// (T), left (L) or right (R) — unrestricted, so lane choice is pure discipline.
function crossCentre(): Lane[] {
  return Array.from({ length: 3 }, (_, i) => ({ from: B, to: [T, L, R], index: i }));
}

export const laneDiscipline: TestScenario = {
  id: "lane-discipline",
  name: "Lane discipline: sort by the upcoming turn",
  description:
    "A 3-lane one-way road climbs into an all-turns crossroads where every lane may " +
    "turn any way. Cars still pre-sort by their route: left-turners ease to the inner " +
    "lane, right-turners and straight-through traffic keep to the kerb — before the " +
    "junction, not cutting across it. Toggle Debug for the driving-lines.",
  level: {
    // South arm: one-way northbound, full 3 lanes, long enough to sort.
    "2,6": { connections: [], road: oneWayN(B, T, 3) }, // spawn (south edge)
    "2,5": { connections: [], road: oneWayN(B, T, 3) },
    "2,4": { connections: [], road: oneWayN(B, T, 3) },
    "2,3": { connections: [], road: oneWayN(B, T, 3) }, // 3-lane approach
    // The all-turns crossroads.
    "2,2": { connections: [], road: crossCentre() },
    // North exit arm (straight): 3 lanes.
    "2,1": { connections: [], road: oneWayN(B, T, 3) },
    "2,0": { connections: [], road: oneWayN(B, T, 3) },
    // West exit arm (left turn): 3 lanes.
    "1,2": { connections: [], road: oneWayN(R, L, 3) },
    "0,2": { connections: [], road: oneWayN(R, L, 3) },
    // East exit arm (right turn): 3 lanes.
    "3,2": { connections: [], road: oneWayN(L, R, 3) },
    "4,2": { connections: [], road: oneWayN(L, R, 3) },
  },
  trains: {},
  size: { cols: 5, rows: 7 },
  // Steady flow from the single south source so the pre-sorting on the approach is
  // easy to watch (the test world's live Cars slider scales density on top).
  traffic: { spawnInterval: 0.8, maxCars: 12 },
};
