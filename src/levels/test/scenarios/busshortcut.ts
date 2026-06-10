import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, nWayLanes, twoWay } from "@/tiles/lanes";

// busshortcut — a rectangular two-way CAR loop with a bus-only middle street
// cutting straight across it (an H / theta shape). The middle vertical street is
// every-lane kind:"bus", so a CAR may never turn into it (usableExits bars the
// bus lanes) while a BUS can take the shortcut through the middle instead of
// driving the long way round the loop. This is the scenario for the bus-lane
// lane-click tool: a whole bus-only STREET that changes route choice, which the
// other bus scenarios (bus lanes BESIDE car lanes) don't demonstrate.
//
//   (0,0)──(1,0)──[2,0]──(3,0)──(4,0)        []  = T-junction (loop ∩ middle)
//     │              ║              │         ──  = two-way car road
//   (0,1)         (2,1)bus        (4,1)       ║   = bus-only middle street
//     │              ║              │
//   (0,2)         (2,2)bus        (4,2)
//     │              ║              │
//   (0,3)         (2,3)bus        (4,3)
//     │              ║              │
//   (0,4)──(1,4)──[2,4]──(3,4)──(4,4)
//
const T = Position.Top;
const R = Position.Right;
const B = Position.Bottom;
const L = Position.Left;

type Cell = { connections: []; road: Lane[] };

// Two-way car cells of the outer loop.
const horiz = (): Cell => ({ connections: [], road: nWayLanes(L, R, 1) });
const vert = (): Cell => ({ connections: [], road: nWayLanes(T, B, 1) });
const curve = (a: Position, b: Position): Cell => ({ connections: [], road: twoWay(a, b) });

// The bus-only middle street: a 1-lane two-way vertical street whose BOTH lanes
// are kind:"bus", so cars are barred and only buses use it.
const busVert = (): Cell => ({ connections: [], road: nWayLanes(T, B, 1, "bus") });

// A loop ∩ middle-street T-junction. Each loop approach has TWO lanes: a kerb CAR
// lane (index 0) that can ONLY go straight along the loop, and an inner BUS lane
// (index 1, kind:"bus") that goes straight OR turns into the middle street. Because
// the only lane permitting the turn onto the middle is a bus lane, class-aware
// routing (usableExits) never offers a car the turn — cars stay on the loop; buses
// may shortcut. The middle-street arrival lane is bus-only too, so it stays a bus
// street end to end.
const topTee = (): Cell => ({
  connections: [],
  road: [
    // West approach: kerb car lane straight only; inner bus lane straight + south.
    { from: L, to: [R], index: 0 },
    { from: L, to: [R, B], index: 1, kind: "bus" },
    // East approach: same, mirrored.
    { from: R, to: [L], index: 0 },
    { from: R, to: [L, B], index: 1, kind: "bus" },
    // Middle street northbound arrival: a bus rejoins the loop either way.
    { from: B, to: [L, R], index: 0, kind: "bus" },
  ],
});
const bottomTee = (): Cell => ({
  connections: [],
  road: [
    { from: L, to: [R], index: 0 },
    { from: L, to: [R, T], index: 1, kind: "bus" },
    { from: R, to: [L], index: 0 },
    { from: R, to: [L, T], index: 1, kind: "bus" },
    { from: T, to: [L, R], index: 0, kind: "bus" },
  ],
});

export const busshortcut: TestScenario = {
  id: "busshortcut",
  name: "Bus-only shortcut street",
  description:
    "A rectangular two-way car loop with a bus-only street cutting straight across " +
    "the middle (an H shape). Buses take the shortcut through the middle; cars are " +
    "barred from it and must drive the long way round the loop. The whole middle " +
    "street is a bus lane — class-aware routing means a car is never offered the " +
    "turn onto it. Enable Debug to see the amber bus lanes and the lane arrows.",
  level: {
    // Top edge (y=0): curve corners, straights, and the top T-junction at x=2.
    "0,0": curve(R, B),
    "1,0": horiz(),
    "2,0": topTee(),
    "3,0": horiz(),
    "4,0": curve(L, B),
    // Left column (x=0) and right column (x=4): vertical car road.
    "0,1": vert(),
    "0,2": vert(),
    "0,3": vert(),
    "4,1": vert(),
    "4,2": vert(),
    "4,3": vert(),
    // Middle column (x=2): the bus-only street.
    "2,1": busVert(),
    "2,2": busVert(),
    "2,3": busVert(),
    // Bottom edge (y=4): curve corners, straights, and the bottom T-junction.
    "0,4": curve(R, T),
    "1,4": horiz(),
    "2,4": bottomTee(),
    "3,4": horiz(),
    "4,4": curve(L, T),
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  // Spawn both classes so the demo shows cars looping while buses cut through.
  traffic: { mix: { car: 1, bus: 1 }, spawnInterval: 0.7, maxCars: 14 },
};
