import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { oneWay, turns, twoWay } from "@/tiles/lanes";

// AN ECHELON RANK THAT CROSSES A TILE SEAM — the one thing no other parking map
// has, and the one the apron geometry gets wrong when it is missing.
//
// Every echelon rank in the gallery until now sat on a SINGLE tile, so the fact
// that its apron was a parallelogram never showed: a lone rake reads as a rake.
// Put two of them side by side and the defect is unmissable — the road-side edge
// of each apron started 21px BEFORE its tile and ended 47px short of the far end,
// so consecutive tiles stepped past each other and left a wedge of grass hard
// against the carriageway in the middle of what should be one car park.
//
// Two tiles is the whole point of the map. It is also the smallest thing that can
// show it: one tile cannot have a seam.
//
// Both banks, because the rake mirrors — a "left" row leans the other way, and a
// squared-off apron has to square off the same way on each side or the two banks
// disagree about where the strip ends.
//
// The aisle is one-way, which is what makes a far-bank rank legal at all (nobody
// crosses an oncoming stream to park), and it LOOPS back to the street so a
// driver who finds the rank full has somewhere to go.

const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });

// SIX is what fits on a 200px tile at the 29px echelon pitch, and the pitch is
// the car's WIDTH over sin45 — the cars nest into each other's shadow, which is
// the whole reason to park at an angle.
const rank = (side: "right" | "left") =>
  ({ from: Position.Left, side, kind: "angled" as const, count: 6 });

// Aisle tiles carry no pavement — a car park has none, and the cross-section
// rule would otherwise sit these ranks BEHIND a band nobody wants here.
const bays = () => ({
  connections: [],
  footway: "none" as const,
  road: [oneWay(Position.Left, Position.Right)],
  parking: {
    facility: "echelon",
    label: "Schrägrank",
    // Short stays: this map is about the PAINT, and a rank whose cars sit for
    // half a minute spends the sweep looking like a car park nobody uses.
    dwellSec: [8, 16] as [number, number],
    rows: [rank("right"), rank("left")],
  },
});

const aisleOnly = (road: ReturnType<typeof oneWay>[]) => ({
  connections: [],
  footway: "none" as const,
  road,
  parking: { facility: "echelon" },
});

export const parkechelon: TestScenario = {
  id: "parkechelon",
  name: "Echelon rank across a seam",
  description:
    "Two adjacent tiles of 45° bays on both banks of a one-way aisle. The apron has to run straight through the seam as one strip of tarmac — a raked apron steps past its neighbour and leaves grass against the road.",
  level: {
    "0,0": street(),
    "1,0": {
      connections: [],
      road: [
        turns(Position.Left, [Position.Right, Position.Bottom]),
        turns(Position.Right, [Position.Left, Position.Bottom]),
      ],
    },
    "2,0": street(),
    "3,0": street(),
    "4,0": {
      connections: [],
      road: [
        turns(Position.Left, [Position.Right]),
        turns(Position.Right, [Position.Left]),
        turns(Position.Bottom, [Position.Left, Position.Right]),
      ],
    },
    "5,0": street(),

    // The rank: two tiles of bays, entered from the left and looping back up.
    "1,1": aisleOnly([oneWay(Position.Top, Position.Bottom)]),
    "1,2": aisleOnly([oneWay(Position.Top, Position.Right)]),
    "2,2": bays(),
    "3,2": bays(),
    "4,2": aisleOnly([oneWay(Position.Left, Position.Top)]),
    "4,1": aisleOnly([oneWay(Position.Bottom, Position.Top)]),
  },
  trains: {},
  size: { cols: 6, rows: 3 },
  traffic: { spawnInterval: 1.0, maxCars: 10 },
};
