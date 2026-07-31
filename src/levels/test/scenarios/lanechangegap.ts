import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { oneWayLanes } from "@/tiles/lanes";

// LANE-CHANGE GAP ACCEPTANCE in isolation (#56).
//
// A busy one-way 3-lane straight, long enough that keep-right pulls every car
// toward the kerb but far too busy for all of them to get there at once. That is
// the whole point: the kerb lane is usually occupied, so a car crossing toward it
// has to find a real hole first, and the mechanic under test is what it does when
// there isn't one.
//
// What a correct sim does here, watching the debug driving-lines:
//  • a car crossing two lanes checks EACH lane as it reaches it — the gap that let
//    it leave lane 2 says nothing about lane 0;
//  • the check follows the car's route across the tile seam, so a merge that will
//    finish on the next tile sees the traffic already lying there;
//  • refused, it holds one lane short or eases back the way it came, and never
//    parks astride a lane line where it would block both;
//  • it brakes for the car it is merging in behind from the moment it starts to
//    encroach, instead of sliding through it and recovering afterwards.
//
// Every body stays out of every other body. Before the fix this map's cousins
// (busarterial, buscross, roadstraightlanes) each recorded a measured overlap of
// a tenth of a tile or more, with a bus tail sweeping through a stopped bus's
// nose for several ticks.

const lanes3 = (): Level[string] => ({
  connections: [],
  road: oneWayLanes(Position.Left, Position.Right, 3),
});

const COLS = 8;

export const lanechangegap: TestScenario = {
  id: "lanechangegap",
  name: "Lane change: gap acceptance",
  description:
    "A busy one-way 3-lane straight. Keep-right sends every car toward the kerb, " +
    "but there is rarely room for all of them — so each crossing is re-checked lane " +
    "by lane and across the tile seam ahead. A car with no gap holds its lane or " +
    "eases back rather than sweeping through the traffic, and never sits astride " +
    "the line blocking two lanes at once.",
  level: Object.fromEntries(
    Array.from({ length: COLS }, (_, x) => [`${x},1`, lanes3()]),
  ),
  trains: {},
  size: { cols: COLS, rows: 3 },
  traffic: {
    spawnInterval: 0.4,
    maxCars: 12,
    // Eastbound only, so the map is one dense stream sorting itself out.
    spawnEntries: [{ coord: { x: 0, y: 1 }, entryPort: Position.Left }],
  },
};
