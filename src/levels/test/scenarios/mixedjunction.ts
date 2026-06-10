import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, nWayLanes } from "@/tiles/lanes";

// Junctions whose arms have DIFFERENT lane counts on each side — the case the
// user asked to harden ("create your own crosses with different lanes on each
// side, then make sure all connections work"). A car fans OUT when it turns onto
// a wider arm and merges DOWN onto a narrower one; every approach lane can reach
// every connected arm. The centre is a road junction, so unequal arm widths are
// valid (no lane-count mismatch is flagged) and `junctionExitLane` matches each
// movement to a lane on its exit arm. Toggle Debug to watch the per-lane turn
// arrows and each car ease into its matched lane past the centre.
const T = Position.Top;
const R = Position.Right;
const B = Position.Bottom;
const L = Position.Left;
const ARMS: Position[] = [T, R, B, L];

// A junction centre from a per-approach lane count. Each present arm (count > 0)
// contributes `count` lanes (indices 0..count-1); every lane permits all the
// OTHER present arms (straight + both turns). No dedicated turn lanes — the point
// here is unequal arm widths fanning/merging, not approach sorting.
function mixedCentre(counts: Partial<Record<Position, number>>): Lane[] {
  const present = ARMS.filter(p => (counts[p] ?? 0) > 0);
  const out: Lane[] = [];
  for (const from of present) {
    const exits = present.filter(p => p !== from);
    for (let i = 0; i < (counts[from] ?? 0); i++) {
      out.push({ from, to: [...exits], index: i });
    }
  }
  return out;
}

// A run of `n`-lane road tiles along a row (horizontal, Left<->Right).
function hRun(y: number, xs: number[], n: number): Level {
  const out: Level = {};
  for (const x of xs) out[`${x},${y}`] = { connections: [], road: nWayLanes(L, R, n) };
  return out;
}
// A run of `n`-lane road tiles down a column (vertical, Top<->Bottom).
function vRun(x: number, ys: number[], n: number): Level {
  const out: Level = {};
  for (const y of ys) out[`${x},${y}`] = { connections: [], road: nWayLanes(T, B, n) };
  return out;
}

// 4-way cross at (3,3): N arm 1 lane, E arm 2, S arm 3, W arm 2 — every arm a
// different width than the one across from it, so each car fans or merges as it
// crosses.
export const mixedcross: TestScenario = {
  id: "mixedcross",
  name: "Cross: a different lane count on every arm",
  description:
    "A 4-way junction with 1 lane north, 2 east, 3 south and 2 west. Cars enter " +
    "from every edge, draw a random destination, and fan out or merge down to a " +
    "lane that matches their turn — never all piling into lane 0. Toggle Debug to " +
    "watch each car ease into its matched lane past the centre.",
  level: {
    ...vRun(3, [0, 1, 2], 1), // north arm: 1 lane
    ...hRun(3, [4, 5, 6], 2), // east arm: 2 lanes
    ...vRun(3, [4, 5, 6], 3), // south arm: 3 lanes
    ...hRun(3, [0, 1, 2], 2), // west arm: 2 lanes
    "3,3": { connections: [], road: mixedCentre({ [T]: 1, [R]: 2, [B]: 3, [L]: 2 }) },
  },
  trains: {},
  size: { cols: 7, rows: 7 },
  traffic: { spawnInterval: 0.7, maxCars: 16 },
};

// T-junction at (3,2): a 3-lane through road (E<->W) with a 2-lane spur dropping
// south. Through traffic merges down when turning onto the spur; spur traffic
// fans out turning onto the 3-lane road.
export const mixedtee: TestScenario = {
  id: "mixedtee",
  name: "T-junction: 3-lane road, 2-lane spur",
  description:
    "A 3-lane east–west road meets a 2-lane spur dropping south. Through cars may " +
    "go straight or turn down (merging 3→2); spur cars turn onto the wide road " +
    "(fanning 2→3). Every approach lane can reach every connected arm.",
  level: {
    ...hRun(2, [0, 1, 2], 3), // west arm: 3 lanes
    ...hRun(2, [4, 5, 6], 3), // east arm: 3 lanes
    ...vRun(3, [3, 4, 5], 2), // south spur: 2 lanes
    "3,2": { connections: [], road: mixedCentre({ [L]: 3, [R]: 3, [B]: 2 }) },
  },
  trains: {},
  size: { cols: 7, rows: 6 },
  traffic: { spawnInterval: 0.7, maxCars: 14 },
};

// Cross at (2,1) fed from below by a 1-lane CURVE: a 2-lane E–W road crossed by a
// 1-lane N–S road whose south arm bends away east. The junction's narrow-arm
// laneCountAt over-counts (every wide-road lane that can turn onto it counts), so
// the curve's turn glide must seam-match its target band (turnSeamBand) to the
// band the junction actually positions entering vehicles with — or every car and
// lane arrow eases half a lane wide and snaps sideways exactly at the entrance
// seam (the /play sandbox bug this reproduces). Exits through the same arm were
// always fine; watch the ENTRY: a car rounding the bend must arrive dead on the
// junction's own lane line.
export const curvefeed: TestScenario = {
  id: "curvefeed",
  name: "Cross fed by a curve (narrow arm)",
  description:
    "A 2-lane road crossed by a 1-lane road whose south arm immediately bends " +
    "east through a curve. Cars rounding the bend into the junction must line up " +
    "exactly with the junction's lane at the entrance seam — no sideways snap. " +
    "Toggle Debug to check the curve's turn arrow meets the junction's paths.",
  level: {
    ...vRun(2, [0], 1), // north arm: 1 lane
    ...hRun(1, [0, 1], 2), // west arm: 2 lanes
    ...hRun(1, [3, 4], 2), // east arm: 2 lanes
    "2,1": { connections: [], road: mixedCentre({ [T]: 1, [R]: 2, [B]: 1, [L]: 2 }) },
    // South arm: a 1-lane curve bending east, fed by a 1-lane road.
    "2,2": { connections: [], road: nWayLanes(T, R, 1) },
    ...hRun(2, [3, 4], 1),
  },
  trains: {},
  size: { cols: 5, rows: 3 },
  traffic: { spawnInterval: 0.7, maxCars: 10 },
};
