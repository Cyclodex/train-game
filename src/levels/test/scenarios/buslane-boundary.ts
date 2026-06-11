import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";

// Reproduction of issue #33: a bus-only road segment sits between two T-junctions
// that connect to a regular car road below. Before the fix, cars would spawn at
// the regular-road side of the junction/bus-lane seam, appearing to come from the
// bus lane. After the fix, only the true map-edge openings (left of 0,3 and right
// of 6,3) are spawn entries, so all cars arrive from the outer ends of the road.

const L = Position.Left;
const R = Position.Right;
const T = Position.Top;
const B = Position.Bottom;

export const buslaneBoundary: TestScenario = {
  id: "buslane-boundary",
  name: "Bus lane: no car spawn at bus-lane seam (issue #33)",
  description:
    "Bus-only segment between two T-junctions and a lower car road. " +
    "Cars must only spawn at the outer map edges (far left / far right) — " +
    "never at the junction/bus-lane seam. Enable Debug to see amber bus-lane " +
    "arrows on the middle segment and confirm every car comes from an outer edge.",
  level: {
    // Left end of upper road — regular straight
    "0,3": {
      connections: [],
      road: [
        { from: L, to: [R], index: 0 },
        { from: R, to: [L], index: 0 },
      ],
    },
    // Left junction: cars from Left can go Right or Bottom; Right/Bottom go Left
    "1,3": {
      connections: [],
      road: [
        { from: L, to: [R, B], index: 0 },
        { from: R, to: [L], index: 0 },
        { from: B, to: [L], index: 0 },
      ],
    },
    // Bus-only segment (3 tiles)
    "2,3": {
      connections: [],
      road: [
        { from: L, to: [R], index: 0, kind: "bus" },
        { from: R, to: [L], index: 0, kind: "bus" },
      ],
    },
    "3,3": {
      connections: [],
      road: [
        { from: L, to: [R], index: 0, kind: "bus" },
        { from: R, to: [L], index: 0, kind: "bus" },
      ],
    },
    "4,3": {
      connections: [],
      road: [
        { from: L, to: [R], index: 0, kind: "bus" },
        { from: R, to: [L], index: 0, kind: "bus" },
      ],
    },
    // Right junction: cars from Right can go Left or Bottom; Left/Bottom go Right
    "5,3": {
      connections: [],
      road: [
        { from: L, to: [R], index: 0 },
        { from: R, to: [L, B], index: 0 },
        { from: B, to: [R], index: 0 },
      ],
    },
    // Right end of upper road — regular straight
    "6,3": {
      connections: [],
      road: [
        { from: L, to: [R], index: 0 },
        { from: R, to: [L], index: 0 },
      ],
    },
    // Lower road connecting the two junctions (cars bypass the bus segment)
    "1,4": {
      connections: [],
      road: [
        { from: T, to: [R], index: 0 },
        { from: R, to: [T], index: 0 },
      ],
    },
    "2,4": {
      connections: [],
      road: [
        { from: L, to: [R], index: 0 },
        { from: R, to: [L], index: 0 },
      ],
    },
    "3,4": {
      connections: [],
      road: [
        { from: L, to: [R], index: 0 },
        { from: R, to: [L], index: 0 },
      ],
    },
    "4,4": {
      connections: [],
      road: [
        { from: L, to: [R], index: 0 },
        { from: R, to: [L], index: 0 },
      ],
    },
    "5,4": {
      connections: [],
      road: [
        { from: L, to: [T], index: 0 },
        { from: T, to: [L], index: 0 },
      ],
    },
  },
  trains: {},
  size: { cols: 7, rows: 5 },
  traffic: { mix: { car: 1 }, spawnInterval: 1.5, maxCars: 8 },
};
