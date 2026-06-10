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
// So traffic actually flows, the two junctions where the middle meets the loop
// (top at 2,0, bottom at 2,4) are also the map-edge openings: each grows a CAR
// arm off the map (north at 2,0, south at 2,4). Vehicles spawn at the north edge
// and cross to the south edge (and vice-versa). For that north↔south trip the
// bus-only middle street is the DIRECT path, so the class-aware router routes a
// BUS straight down the middle while a CAR — barred from the middle — must drive
// the long way round the loop. The off-map car arm only ever turns ONTO the loop
// (left/right), never into the middle (the only lane permitting that turn is a
// bus lane), so the hard guarantee holds: no car-usable lane enters the bus
// street.
//
//                       north                  []  = junction (loop ∩ middle ∩ edge)
//                         ║                     ──  = two-way car road
//          (0,0)──(1,0)──[2,0]──(3,0)──(4,0)    ║   = bus-only middle street / car arm
//            │              ║              │     │   = two-way car road (column)
//          (0,1)         (2,1)bus        (4,1)
//            │              ║              │
//          (0,2)         (2,2)bus        (4,2)
//            │              ║              │
//          (0,3)         (2,3)bus        (4,3)
//            │              ║              │
//          (0,4)──(1,4)──[2,4]──(3,4)──(4,4)
//                         ║
//                       south
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

// The TOP junction (2,0): the loop's top edge (L<->R) meets the bus-only middle
// (its south arm) AND opens off the map to the north (the spawn/despawn edge).
// Lane design enforcing the hard guarantee that a car never enters the middle:
//  • Each loop approach (L, R) has a kerb CAR lane (index 0, straight along the
//    loop OR off the north edge) and an inner BUS lane (index 1, additionally
//    south into the middle).
//  • The north edge arm is a CAR lane: a vehicle entering from the north may turn
//    onto the loop (L/R) but its `to` never lists B, so a car can't drive into
//    the middle. A separate BUS lane from the north additionally permits south,
//    so a bus crossing the map drives straight down the middle.
// The only lane whose `to` includes the middle (B) is a bus lane — class-aware
// routing therefore never offers a car the turn onto the bus street.
const topTee = (): Cell => ({
  connections: [],
  road: [
    // West approach: kerb car lane (straight or off-map north); inner bus lane adds south.
    { from: L, to: [R, T], index: 0 },
    { from: L, to: [R, T, B], index: 1, kind: "bus" },
    // East approach: same, mirrored.
    { from: R, to: [L, T], index: 0 },
    { from: R, to: [L, T, B], index: 1, kind: "bus" },
    // North edge arrival: a CAR lane turns onto the loop only (never the middle);
    // a BUS lane additionally drives straight south down the middle.
    { from: T, to: [L, R], index: 0 },
    { from: T, to: [L, R, B], index: 1, kind: "bus" },
    // Middle street northbound arrival: a bus rejoins the loop or exits north.
    { from: B, to: [L, R, T], index: 0, kind: "bus" },
  ],
});
// The BOTTOM junction (2,4): mirror of the top, opening off the map to the south.
const bottomTee = (): Cell => ({
  connections: [],
  road: [
    { from: L, to: [R, B], index: 0 },
    { from: L, to: [R, B, T], index: 1, kind: "bus" },
    { from: R, to: [L, B], index: 0 },
    { from: R, to: [L, B, T], index: 1, kind: "bus" },
    { from: B, to: [L, R], index: 0 },
    { from: B, to: [L, R, T], index: 1, kind: "bus" },
    { from: T, to: [L, R, B], index: 0, kind: "bus" },
  ],
});

export const busshortcut: TestScenario = {
  id: "busshortcut",
  name: "Bus-only shortcut street",
  description:
    "A rectangular two-way car loop with a bus-only street cutting straight across " +
    "the middle (an H shape). Vehicles enter from the open north edge and leave at " +
    "the south edge. For that north–south trip the middle is the direct path, so a " +
    "BUS takes the shortcut straight through it while a CAR — barred from the middle " +
    "— must drive the long way round the loop. The whole middle street is a bus lane, " +
    "and class-aware routing means a car is never offered the turn onto it. Enable " +
    "Debug to see the amber bus lanes and the lane arrows.",
  level: {
    // Top edge (y=0): curve corners, straights, and the top junction at x=2.
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
    // Bottom edge (y=4): curve corners, straights, and the bottom junction.
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
