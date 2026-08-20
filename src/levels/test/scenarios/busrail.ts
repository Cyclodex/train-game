import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { twoWay } from "@/tiles/lanes";
import { TestScenario, mkLineTrain, railRing } from "@/levels/test/scenario";
import type { ParkingRow } from "@/tiles/parking";

const town = (): TileCell => ({ connections: [], terrain: "urban" });
// A piece of the ring road: two-way between the two ports it joins, so a
// straight and a corner are authored the same way.
const road = (a: Position, b: Position): TileCell => ({
  connections: [],
  road: twoWay(a, b),
});
const halt = (from: Position): ParkingRow => ({ from, kind: "busstop", count: 1 });
const stationEW = (name: string): TileCell => ({
  connections: [[Position.Left, Position.Right]],
  role: "station",
  stationName: name,
});

// BUS AND TRAIN, ONE JOURNEY (#90).
//
// A bus is planned exactly like a train: draw a line, buy a bus, assign it.
// This board is the proof that the two make ONE network rather than two — a
// person at ALTSTADT can only reach OSTBAHNHOF by riding the bus round to the
// stop outside Hauptbahnhof, walking the few steps up to the platform, and
// taking the train on. No single vehicle makes that journey.
//
// THE STREET IS A RING, and that is load-bearing rather than scenic. A bus runs
// its line as a CYCLE, so the road has to give it a way back to the first stop.
// The first cut of this board was a straight street with a stop at each end: the
// bus reached the far stop, could not turn round (the router plans lane by lane
// and there is no U-turn), drove off the end of the map and was re-spawned at
// the other stop — a teleport, which read on the board as a bus that sat at the
// halt for ever and then jumped. A ring needs no U-turn: every stop leads on to
// the next.
//
// THE WALK is what joins bus to train (D5, `walkLinksOf` in tiles/catchment.ts):
// a kerb and a platform are separate islands however close they are drawn, until
// something says a passenger may cross between them. So the geometry is
// load-bearing too —
//   · the interchange halt (2,3) is DIRECTLY BELOW Hauptbahnhof (2,2), one tile:
//     well inside the walking radius, so the network joins there;
//   · Altstadt (5,6) is four tiles from every platform: outside it, so its
//     people genuinely cannot walk to a train and the bus is the only way in.
// Move either one and the board stops demonstrating anything.
//
//   rail ring   1,1 ──── OST(2,1) ──── 3,1 ──── 4,1
//                │                               │
//               1,2 ──── HBF(2,2) ──── 3,2 ──── 4,2
//
//   ring road   1,3 ─ HALT(2,3) ─ 3,3 ─ 4,3 ─ 5,3 ─ 6,3     <- 2,3 is under HBF
//                │                                   │
//               1,4                                 6,4
//                │                                   │
//               1,5                                 6,5
//                │                                   │
//               1,6 ─ 2,6 ─ 3,6 ─ 4,6 ─ ALT(5,6) ─ 6,6
export const busrail: TestScenario = {
  id: "busrail",
  name: "Bus and train",
  description:
    "A journey nobody can make on one vehicle: the bus round to the interchange, then the train.",
  modeId: "network",
  level: {
    // --- the railway: a compact ring with two platforms and one shed --------
    ...railRing(1, 1, 4, 2),
    "2,1": stationEW("Ostbahnhof"),
    "2,2": stationEW("Hauptbahnhof"),
    "0,2": expandKind("depot", 1),
    // Where the shed's spur meets the ring: a T, so the train can pull out and
    // turn either way onto it.
    "1,2": {
      connections: [
        [Position.Top, Position.Right], // the ring's south-west corner
        [Position.Left, Position.Top], // out of the shed, northbound
        [Position.Left, Position.Right], // out of the shed, eastbound
      ],
    },

    // --- the ring road, one tile below the railway --------------------------
    // North side. THE INTERCHANGE sits directly under Hauptbahnhof.
    "1,3": road(Position.Right, Position.Bottom), // NW corner
    "2,3": {
      ...road(Position.Left, Position.Right),
      parking: {
        // Its OWN facility id. Two stops sharing one id are one facility to the
        // parking layer — they pool their capacity and show a single sign, so
        // the board read "H 2/2" once instead of a halt at each end.
        facility: "halt-hbf",
        label: "Hauptbahnhof",
        // A stop is a pause, not parking: doors, a moment, gone.
        dwellSec: [5, 9],
        rows: [halt(Position.Left)],
      },
    },
    "3,3": road(Position.Left, Position.Right),
    "4,3": road(Position.Left, Position.Right),
    "5,3": road(Position.Left, Position.Right),
    "6,3": road(Position.Left, Position.Bottom), // NE corner
    // The two sides.
    "1,4": road(Position.Top, Position.Bottom),
    "1,5": road(Position.Top, Position.Bottom),
    "6,4": road(Position.Top, Position.Bottom),
    "6,5": road(Position.Top, Position.Bottom),
    // South side. ALTSTADT is out of walking reach of any platform, so the bus
    // is the only way its people reach the railway at all.
    "1,6": road(Position.Top, Position.Right), // SW corner
    "2,6": road(Position.Left, Position.Right),
    "3,6": road(Position.Left, Position.Right),
    "4,6": road(Position.Left, Position.Right),
    "5,6": {
      ...road(Position.Left, Position.Right),
      parking: {
        facility: "halt-altstadt",
        label: "Altstadt",
        dwellSec: [5, 9],
        rows: [halt(Position.Left)],
      },
    },
    "6,6": road(Position.Top, Position.Left), // SE corner

    // --- the houses each stop serves ---------------------------------------
    // Altstadt's own quarter, south of the ring.
    "4,7": town(),
    "5,7": town(),
    "6,7": town(),
    // ...and the town the railway serves, north of it.
    "3,0": town(),
    "4,0": town(),
  },
  trains: {
    // The railway between the two platforms. Ordered at the shed, in service
    // for ever — a ring needs no turn-back.
    rail: mkLineTrain("rail", 0, 2, "people", 2, ["2,2", "2,1"]),
  },
  colors: {
    depotColors: { "0,2": "blue" },
    trainColors: { rail: "green" },
  },
  size: { cols: 8, rows: 8 },
};
