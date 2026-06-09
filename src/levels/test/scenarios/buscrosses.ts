import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, nWayLanes } from "@/tiles/lanes";

// A family of 4-way intersections built around real-world BUS-LANE layouts. Each
// is the smallest cross that shows its idea in isolation; toggle Debug for the
// amber bus-lane markings + the cyan lane arrows (where vehicles actually drive).
// Right-hand traffic, lane index 0 = kerb, highest index = centre. The kerb-side
// turn is a RIGHT turn; the centre-side turn is a LEFT turn — that's why a kerb
// bus lane naturally feeds straight + right, and a median bus lane straight + left.
const T = Position.Top;
const R = Position.Right;
const B = Position.Bottom;
const L = Position.Left;

type Cell = { connections: []; road: Lane[] };

// ---------------------------------------------------------------------------
// 1) buscrossboth — two bus-route streets crossing: a kerb bus lane + a car lane
//    on BOTH the E-W and the N-S road. Buses ride their kerb bus lane straight
//    across and turn right off it (right is the kerb side); a turning bus lands on
//    the cross street's kerb bus lane. Left-turning buses use the car lane. Cars
//    never touch a bus lane on either road.
// ---------------------------------------------------------------------------
const ewKerbBus = (): Cell => ({
  connections: [],
  road: [
    { from: L, to: [R], index: 0, kind: "bus" },
    { from: L, to: [R], index: 1 },
    { from: R, to: [L], index: 0, kind: "bus" },
    { from: R, to: [L], index: 1 },
  ],
});
const nsKerbBus = (): Cell => ({
  connections: [],
  road: [
    { from: T, to: [B], index: 0, kind: "bus" },
    { from: T, to: [B], index: 1 },
    { from: B, to: [T], index: 0, kind: "bus" },
    { from: B, to: [T], index: 1 },
  ],
});

export const buscrossboth: TestScenario = {
  id: "buscrossboth",
  name: "Cross: bus lanes on both roads",
  description:
    "Two bus-route streets crossing — each has a kerb bus lane + a car lane in " +
    "both directions. Buses ride the bus lane straight through and turn right off " +
    "it (landing on the cross street's bus lane); left turns come from the car " +
    "lane. Cars never use a bus lane on either road. Enable Debug for the markings.",
  level: {
    "0,2": ewKerbBus(),
    "1,2": ewKerbBus(),
    "3,2": ewKerbBus(),
    "4,2": ewKerbBus(),
    "2,0": nsKerbBus(),
    "2,1": nsKerbBus(),
    "2,3": nsKerbBus(),
    "2,4": nsKerbBus(),
    "2,2": {
      connections: [],
      road: [
        // kerb bus lane: straight + right; inner car lane: straight + both turns.
        { from: L, to: [R, B], index: 0, kind: "bus" },
        { from: L, to: [R, T, B], index: 1 },
        { from: R, to: [L, T], index: 0, kind: "bus" },
        { from: R, to: [L, T, B], index: 1 },
        { from: T, to: [B, L], index: 0, kind: "bus" },
        { from: T, to: [B, L, R], index: 1 },
        { from: B, to: [T, R], index: 0, kind: "bus" },
        { from: B, to: [T, L, R], index: 1 },
      ],
    },
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  traffic: { mix: { car: 1, bus: 1 }, spawnInterval: 0.7, maxCars: 14 },
};

// ---------------------------------------------------------------------------
// 2) busmedian — a centre-running (BRT-style) bus lane. On the E-W corridor each
//    direction has a kerb CAR lane + an inner (median-side) BUS lane. Buses run in
//    the median and turn LEFT off it (left is the median side); a bus turning RIGHT
//    must cross to the kerb car lane. The N-S road is an ordinary 1-lane street.
// ---------------------------------------------------------------------------
const ewMedianBus = (): Cell => ({
  connections: [],
  road: [
    { from: L, to: [R], index: 0 },
    { from: L, to: [R], index: 1, kind: "bus" },
    { from: R, to: [L], index: 0 },
    { from: R, to: [L], index: 1, kind: "bus" },
  ],
});
const ns1 = (): Cell => ({ connections: [], road: nWayLanes(T, B, 1) });

export const busmedian: TestScenario = {
  id: "busmedian",
  name: "Cross: centre-running (BRT) bus lane",
  description:
    "A BRT-style corridor: the E-W road runs its bus lane in the MEDIAN (inner) " +
    "lane, with cars on the kerb. Buses go straight or turn left from the median; " +
    "a bus turning right crosses to the kerb car lane (and stays there — no flip- " +
    "flopping). It crosses an ordinary 1-lane street. Enable Debug for the markings.",
  level: {
    "0,2": ewMedianBus(),
    "1,2": ewMedianBus(),
    "3,2": ewMedianBus(),
    "4,2": ewMedianBus(),
    "2,0": ns1(),
    "2,1": ns1(),
    "2,3": ns1(),
    "2,4": ns1(),
    "2,2": {
      connections: [],
      road: [
        // kerb car lane: straight + right; median bus lane: straight + left.
        { from: L, to: [R, B], index: 0 },
        { from: L, to: [R, T], index: 1, kind: "bus" },
        { from: R, to: [L, T], index: 0 },
        { from: R, to: [L, B], index: 1, kind: "bus" },
        { from: T, to: [B, L, R], index: 0 },
        { from: B, to: [T, L, R], index: 0 },
      ],
    },
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  traffic: { mix: { car: 1, bus: 1 }, spawnInterval: 0.8, maxCars: 12 },
};

// ---------------------------------------------------------------------------
// 3) busarterial — a wide arterial (3 lanes per direction: a kerb BUS lane + 2 car
//    lanes) crossing a minor 1-lane road. Through buses hold the kerb bus lane;
//    the inner car lane carries left turns, the middle lane goes straight, the kerb
//    bus lane also takes the right turn. Exercises a bus lane on a 3-lane road and a
//    wide-arm → narrow-arm junction.
// ---------------------------------------------------------------------------
const ewArterial = (): Cell => ({
  connections: [],
  road: [
    { from: L, to: [R], index: 0, kind: "bus" },
    { from: L, to: [R], index: 1 },
    { from: L, to: [R], index: 2 },
    { from: R, to: [L], index: 0, kind: "bus" },
    { from: R, to: [L], index: 1 },
    { from: R, to: [L], index: 2 },
  ],
});

export const busarterial: TestScenario = {
  id: "busarterial",
  name: "Cross: bus lane on a 3-lane arterial",
  description:
    "A wide arterial — a kerb bus lane plus two car lanes each way — crossing a " +
    "minor 1-lane road. Through buses hold the kerb bus lane; the inner lane turns " +
    "left, the middle goes straight, the kerb bus lane also turns right. Shows a " +
    "bus lane on a 3-lane road and a wide→narrow junction. Enable Debug for markings.",
  level: {
    "0,2": ewArterial(),
    "1,2": ewArterial(),
    "3,2": ewArterial(),
    "4,2": ewArterial(),
    "2,0": ns1(),
    "2,1": ns1(),
    "2,3": ns1(),
    "2,4": ns1(),
    "2,2": {
      connections: [],
      road: [
        { from: L, to: [R, B], index: 0, kind: "bus" }, // kerb bus: straight + right
        { from: L, to: [R], index: 1 }, // middle: straight
        { from: L, to: [R, T], index: 2 }, // inner: straight + left
        { from: R, to: [L, T], index: 0, kind: "bus" },
        { from: R, to: [L], index: 1 },
        { from: R, to: [L, B], index: 2 },
        { from: T, to: [B, L, R], index: 0 },
        { from: B, to: [T, L, R], index: 0 },
      ],
    },
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  traffic: { mix: { car: 1, bus: 1 }, spawnInterval: 0.7, maxCars: 16 },
};

// ---------------------------------------------------------------------------
// 4) busmedianboth — two BRT corridors crossing: a centre-running bus lane on BOTH
//    roads (kerb car + median bus each direction, both axes). Buses run the medians
//    and turn left across the junction; cars keep to the kerb lanes. The case where
//    two bus rapid-transit lines intersect.
// ---------------------------------------------------------------------------
const nsMedianBus = (): Cell => ({
  connections: [],
  road: [
    { from: T, to: [B], index: 0 },
    { from: T, to: [B], index: 1, kind: "bus" },
    { from: B, to: [T], index: 0 },
    { from: B, to: [T], index: 1, kind: "bus" },
  ],
});

export const busmedianboth: TestScenario = {
  id: "busmedianboth",
  name: "Cross: two BRT corridors (median bus lanes both ways)",
  description:
    "Two bus-rapid-transit lines crossing: each road runs its bus lane in the " +
    "median, cars on the kerb. Buses hold the median and turn left across the " +
    "junction; cars keep the kerb lanes and turn right. Buses meet buses in the " +
    "middle. Enable Debug for the amber median markings.",
  level: {
    "0,2": ewMedianBus(),
    "1,2": ewMedianBus(),
    "3,2": ewMedianBus(),
    "4,2": ewMedianBus(),
    "2,0": nsMedianBus(),
    "2,1": nsMedianBus(),
    "2,3": nsMedianBus(),
    "2,4": nsMedianBus(),
    "2,2": {
      connections: [],
      road: [
        { from: L, to: [R, B], index: 0 }, // kerb car: straight + right
        { from: L, to: [R, T], index: 1, kind: "bus" }, // median bus: straight + left
        { from: R, to: [L, T], index: 0 },
        { from: R, to: [L, B], index: 1, kind: "bus" },
        { from: T, to: [B, L], index: 0 },
        { from: T, to: [B, R], index: 1, kind: "bus" },
        { from: B, to: [T, R], index: 0 },
        { from: B, to: [T, L], index: 1, kind: "bus" },
      ],
    },
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  traffic: { mix: { car: 1, bus: 1 }, spawnInterval: 0.7, maxCars: 14 },
};
