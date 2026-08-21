import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

const { Left, Right } = Position;
const road = { connections: [], road: fromPairs([[Left, Right]]) };

// Crossing Keeper, playable in isolation: one train delivers across a single
// level crossing while a one-way street of cars flows through it. As the train
// runs its line it reserves the crossing tile (the gate closes) and the queued
// cars accrue patience; once the train parks at its matching depot the gate
// reopens and the queue flushes. The train DOES arrive at a colour-matched depot,
// so the board is winnable (deliveriesRequired === 1) — unlike `keepcrossingclear`
// (which bounces forever to keep a gate cycling). It was built for the
// Crossing-Keeper mode, which was retired from the picker in #121; the board now
// runs the stage's default (Sandbox) and demonstrates the CROSSING MECHANIC —
// gate closes on reservation, queue accrues patience, gate reopens on arrival.
// It is the board a future road-scoring mode should be pinned to.
//
//   Rail (vertical):  depot (1,0) → crossing (1,1) → straight (1,2) → depot (1,3)
//   Road (horizontal): edge (0,1) → crossing (1,1) → edge (2,1)
export const crossingkeeper: TestScenario = {
  id: "crossingkeeper",
  name: "Crossing Keeper",
  description:
    "A winnable crossing: deliver the train across the gate while the road traffic keeps flowing through it.",
  level: {
    // Rail: a short depot-to-depot line crossing the road at (1,1).
    "1,0": expandKind("depot", 2), // opens south onto the crossing line
    "1,1": { ...expandKind("straight", 0), road: fromPairs([[Left, Right]]) }, // the crossing
    "1,2": expandKind("straight", 0), // clearance so the consist parks off the rails
    "1,3": expandKind("depot", 0), // opens north — the train's destination
    // Road: one-way street from the left edge, across the crossing, out the right.
    "0,1": road,
    "2,1": road,
  },
  trains: {
    // Delivers from (1,0) to its matching depot (1,3): one matched arrival → win.
    train1: mkTrain("train1", 1, 0, "people", 1, "1,3"),
  },
  colors: {
    depotColors: {
      "1,0": "red",
      "1,3": "red", // matches the train → it parks (gate reopens), board is won
    },
    trainColors: {
      train1: "red",
    },
  },
  size: { cols: 3, rows: 4 },
};
