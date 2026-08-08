import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { twoWay } from "@/tiles/lanes";
import { TestScenario, mkLineTrain, railRing } from "@/levels/test/scenario";
import type { ParkingRow } from "@/tiles/parking";

const town = (): TileCell => ({ connections: [], terrain: "urban" });
const street = (): TileCell => ({
  connections: [],
  road: twoWay(Position.Left, Position.Right),
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
// person at ALTSTADT can only reach OSTBAHNHOF by riding the bus in to the kerb
// outside Hauptbahnhof, walking the few steps up to the platform, and taking
// the train on. No single vehicle makes that journey.
//
// THE WALK is the piece that joins them (D5, `walkLinksOf` in
// tiles/catchment.ts): a kerb and a platform are separate islands however close
// they are drawn, until something says a passenger may cross between them. So
// the geometry here is load-bearing rather than decorative —
//   · the interchange halt (2,4) is TWO tiles under Hauptbahnhof (2,2): inside
//     the walking radius, so the network joins them;
//   · Altstadt (6,4) is four tiles from every platform: outside it, so its
//     people genuinely cannot walk to a train and the bus is the only way in.
// Move either one and the board stops demonstrating anything.
//
//   rail ring  1,1 ──── OST(2,1) ──── 3,1 ──── 4,1
//               │                               │
//              1,2 ──── HBF(2,2) ──── 3,2 ──── 4,2
//
//   street     2,4(HBF kerb) ── 3,4 ── 4,4 ── 5,4 ── ALT(6,4) ── 7,4
export const busrail: TestScenario = {
  id: "busrail",
  name: "Bus and train",
  description:
    "A journey nobody can make on one vehicle: the bus to the interchange, then the train.",
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

    // --- the street, two rows south of the railway --------------------------
    // THE INTERCHANGE: directly below Hauptbahnhof and inside walking reach.
    "2,4": {
      ...street(),
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
    "3,4": street(),
    "4,4": street(),
    "5,4": street(),
    // ALTSTADT: out of walking reach of any platform, so the bus is the only
    // way its people reach the railway at all.
    "6,4": {
      ...street(),
      parking: {
        facility: "halt-altstadt",
        label: "Altstadt",
        dwellSec: [5, 9],
        rows: [halt(Position.Left)],
      },
    },
    "7,4": street(),

    // --- the houses each stop serves ---------------------------------------
    "5,5": town(),
    "6,5": town(),
    "7,5": town(),
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
  size: { cols: 9, rows: 6 },
};
