import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Left, Right, Top, Bottom } = Position;
const road = { connections: [], road: [[Left, Right]] as [Position, Position][] };

// "Don't block the level crossing": a car won't roll onto the rails if the road
// just past the crossing is jammed and it would be left stranded on the tracks.
//
// One straight road (row y=1) crosses TWO rails: crossing A at (1,1) and crossing
// B at (3,1), one open tile (2,1) between them. A red people-train bounces forever
// between two mismatched depots on crossing B's rail (3,0 green ↔ 3,4 blue). The
// rail extends 3 tiles past the crossing so the loco+wagon fully clear it while
// parked at the south depot — B's gate opens briefly each cycle and the queued
// cars flush through. Only one car fits in the gap between the crossings; the
// next car would have to stop with its body on crossing A — so instead it holds
// short of A, leaving the tracks clear, until B opens. Crossing A's own gate
// never closes (no train runs its rail), proving the hold is about the jam
// beyond, not the gate.
export const keepcrossingclear: TestScenario = {
  id: "keepcrossingclear",
  name: "Keep crossing clear",
  description:
    "Cars won't stop on the rails: when the road past a level crossing is jammed, they hold short of the crossing instead of blocking it.",
  level: {
    // Rail A — a static depot-to-depot line crossing the road at (1,1).
    "1,0": expandKind("depot", 2), // opens south
    "1,1": { ...expandKind("straight", 0), road: [[Left, Right]] }, // crossing A
    "1,2": expandKind("depot", 0), // opens north
    // Rail B — the bouncing train's line, crossing the road at (3,1).
    // Extended 3 tiles south so loco+1 wagon clear the crossing while parked.
    "3,0": expandKind("depot", 2), // opens south
    "3,1": { ...expandKind("straight", 0), road: [[Left, Right]] }, // crossing B
    "3,2": expandKind("straight", 0), // straight below crossing
    "3,3": expandKind("straight", 0), // straight, extra clearance
    "3,4": expandKind("depot", 0), // opens north
    // The road: spawn from the left edge, across both crossings, out the right.
    "0,1": road,
    "2,1": road, // the single car-length gap between the two crossings
    "4,1": road,
  },
  trains: {
    train1: mkTrain("train1", 3, 0, "people", 1, "3,4"),
  },
  colors: {
    depotColors: {
      "3,0": "green", // mismatch → train bounces back out
      "3,4": "blue", // mismatch → train bounces straight back
    },
    trainColors: {
      train1: "red", // matches neither → perpetual bounce, closing crossing B
    },
  },
  size: { cols: 5, rows: 5 },
};
