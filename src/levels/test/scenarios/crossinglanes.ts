import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { nWayLanes, oneWayLanes } from "@/tiles/lanes";

const { Top, Right, Bottom, Left } = Position;

// MULTI-LANE level crossings — the same mechanic as `crossing`, but on a wide
// street (3 lanes per direction, 6 lanes of tarmac = 168px of a 200px tile).
//
// The crossing furniture must be DERIVED from the road it guards, not painted at
// fixed tile percentages: on a wide street a fixed-percentage boom stands its
// post in the middle of the carriageway and its arm covers only the inner lanes.
// Here each approach gets its own half-barrier, hinged on the verge OUTSIDE the
// kerb and reaching to the centre line — one on the LEFT, one on the RIGHT, the
// way a real Bahnübergang guards a dual carriageway.
//
// Both orientations are on the board because the overlay draws the upright
// layout and rotates a quarter turn for a horizontal road, so a handedness
// mistake only shows up in one of them:
//
//   left block   (1,2)  — horizontal rail + VERTICAL road   → furniture upright
//   middle block (6,2)  — vertical rail   + HORIZONTAL road → furniture rotated
//   right block  (10,2) — a 2-lane ONE-WAY street, which is guarded differently:
//                         no oncoming half to leave clear and nothing to guard
//                         behind the crossing, so it gets ONE full-width barrier
//                         on the approach side instead of a diagonal pair.
//
// The two blocks are independent: each road is a stub whose open ends are spawn
// points (a road end with no road beyond it is an entry, see sim/road.ts
// `roadEntries`), so cars queue at both gates without needing a junction.
export const crossinglanes: TestScenario = {
  id: "crossinglanes",
  name: "Level crossing: multi-lane street",
  description:
    "A 3-lane-per-direction street crosses the track in both orientations. Each approach gets its own half-barrier, hinged on the verge outside the kerb — left bar and right bar, sized to the road.",
  level: {
    // --- Block 1: horizontal rail, vertical 3+3 lane road (upright furniture) ---
    "0,2": expandKind("depot", 1), // opens east onto the rail
    "1,2": {
      ...expandKind("straight", 1), // horizontal rail (Left-Right) …
      road: nWayLanes(Top, Bottom, 3), // … under a 6-lane vertical street
    },
    "2,2": expandKind("straight", 1),
    "3,2": expandKind("depot", 3), // opens west

    "1,0": { connections: [], road: nWayLanes(Top, Bottom, 3) },
    "1,1": { connections: [], road: nWayLanes(Top, Bottom, 3) },
    "1,3": { connections: [], road: nWayLanes(Top, Bottom, 3) },
    "1,4": { connections: [], road: nWayLanes(Top, Bottom, 3) },

    // --- Block 2: vertical rail, horizontal 3+3 lane road (rotated furniture) ---
    "6,0": expandKind("depot", 2), // opens south onto the rail
    "6,1": expandKind("straight", 0),
    "6,2": {
      ...expandKind("straight", 0), // vertical rail (Top-Bottom) …
      road: nWayLanes(Left, Right, 3), // … under a 6-lane horizontal street
    },
    "6,3": expandKind("straight", 0),
    "6,4": expandKind("depot", 0), // opens north

    "5,2": { connections: [], road: nWayLanes(Left, Right, 3) },
    "7,2": { connections: [], road: nWayLanes(Left, Right, 3) },

    // --- Block 3: horizontal rail, 2-lane ONE-WAY southbound street ---
    "9,2": expandKind("depot", 1), // opens east
    "10,2": {
      ...expandKind("straight", 1),
      road: oneWayLanes(Top, Bottom, 2),
    },
    "11,2": expandKind("depot", 3), // opens west

    "10,0": { connections: [], road: oneWayLanes(Top, Bottom, 2) },
    "10,1": { connections: [], road: oneWayLanes(Top, Bottom, 2) },
    "10,3": { connections: [], road: oneWayLanes(Top, Bottom, 2) },
    "10,4": { connections: [], road: oneWayLanes(Top, Bottom, 2) },
  },
  trains: {
    train1: mkTrain("train1", 0, 2, "people", 3, "3,2"),
    train2: mkTrain("train2", 6, 0, "fraight", 3, "6,4"),
    train3: mkTrain("train3", 9, 2, "people", 2, "11,2"),
  },
  size: { cols: 12, rows: 5 },
  // Busy enough that both gates hold a real queue on their wide approaches.
  traffic: { spawnInterval: 0.5, maxCars: 22 },
};
