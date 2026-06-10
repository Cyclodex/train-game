import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, nWayLanes } from "@/tiles/lanes";

// A 4-way cross where the east–west main road carries a kerb-side BUS LANE
// (index 0) alongside a car lane (index 1), crossing a 1-lane north–south road.
// This exercises bus-lane handling THROUGH a junction (the cross-lane fix):
//   • a bus driving straight along the main road stays on the bus lane right
//     across the cross;
//   • a bus CAN turn off the main road — the kerb bus lane feeds the natural
//     right turn onto the side road (left turns come from the inner car lane,
//     just like real kerb-side markings);
//   • a bus turning in from the side road lands on / settles onto the bus lane;
//   • a car never ends up on the bus lane, on the through road OR after a turn.
// Toggle Debug to see the amber bus-lane markings and watch buses hold the kerb
// bus lane through the intersection while cars keep to the car lane.
const T = Position.Top;
const B = Position.Bottom;
const L = Position.Left;
const R = Position.Right;

// A straight east–west tile: kerb bus lane (index 0) + one car lane (index 1)
// each direction.
function ewArm(): { connections: []; road: Lane[] } {
  return {
    connections: [],
    road: [
      { from: L, to: [R], index: 0, kind: "bus" },
      { from: L, to: [R], index: 1 },
      { from: R, to: [L], index: 0, kind: "bus" },
      { from: R, to: [L], index: 1 },
    ],
  };
}

// The crossroads centre. Right-hand traffic, so right turns leave from the kerb
// lane and left turns from the inner lane. The kerb BUS lane therefore feeds
// straight + the right turn; the inner CAR lane feeds straight + the left turn
// (and keeps the right turn too, so a car is never stranded). The 1-lane
// north–south arms carry all of their turns. Heading east (L→…): right = B
// (south), left = T (north); heading west (R→…): right = T, left = B.
function centre(): { connections: []; road: Lane[] } {
  return {
    connections: [],
    road: [
      { from: L, to: [R, B], index: 0, kind: "bus" }, // bus: straight + right turn
      { from: L, to: [R, T, B], index: 1 }, // car: straight + both turns
      { from: R, to: [L, T], index: 0, kind: "bus" }, // bus: straight + right turn
      { from: R, to: [L, T, B], index: 1 }, // car: straight + both turns
      { from: T, to: [B, L, R], index: 0 },
      { from: B, to: [T, L, R], index: 0 },
    ],
  };
}

const nsArm = () => ({ connections: [], road: nWayLanes(T, B, 1) });

export const buscross: TestScenario = {
  id: "buscross",
  name: "Cross with a bus lane (buses hold the lane through it)",
  description:
    "A 4-way cross where the east–west main road has a kerb bus lane + a car lane " +
    "crossing a 1-lane side road. Buses ride the bus lane straight through the " +
    "intersection (and settle onto it after turning in), while cars stay on the car " +
    "lane — even across the junction. Enable Debug for the amber bus-lane markings.",
  level: {
    // East–west main road (bus + car lane).
    "0,2": ewArm(),
    "1,2": ewArm(),
    "2,2": centre(),
    "3,2": ewArm(),
    "4,2": ewArm(),
    // North–south 1-lane side road.
    "2,0": nsArm(),
    "2,1": nsArm(),
    "2,3": nsArm(),
    "2,4": nsArm(),
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  // A mixed car + bus stream from every edge so both classes meet at the cross.
  traffic: { mix: { car: 1, bus: 1 }, spawnInterval: 0.8, maxCars: 12 },
};
