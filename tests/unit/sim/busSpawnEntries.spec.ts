import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { roadEntries, roadExits } from "@/sim/road";

// A bus-only street's open map edge must be a BUS spawn entry and a BUS routing
// destination (busOnly: true) — previously it produced neither, so buses never
// spawned on bus-only border streets (signalbuslane1l) and planRoute could not
// target them. Car entries/exits stay exactly as before (no busOnly flag).
const { Top, Bottom, Left, Right } = Position;

describe("roadEntries / roadExits on bus-only streets", () => {
  // 3x1 map: a bus-only N-S street column at x=1 plus a car E-W street row —
  // separate strips so each class's openings are unambiguous.
  const level: Level = {
    // bus-only vertical street (both directions), open at top and bottom edges
    "1,0": {
      connections: [],
      road: [
        { from: Top, to: [Bottom], index: 0, kind: "bus" },
        { from: Bottom, to: [Top], index: 0, kind: "bus" },
      ],
    },
    // car-only horizontal street, open at left and right edges
    "0,1": {
      connections: [],
      road: [
        { from: Left, to: [Right], index: 0 },
        { from: Right, to: [Left], index: 0 },
      ],
    },
  };
  const W = 3;
  const H = 3;

  it("bus-only open ends are busOnly entries; car streets stay plain", () => {
    const entries = roadEntries(level, W, H);
    const busTop = entries.find(e => e.coord.x === 1 && e.coord.y === 0 && e.entryPort === Top);
    expect(busTop).toBeDefined();
    expect(busTop?.busOnly).toBe(true);
    const carLeft = entries.find(e => e.coord.x === 0 && e.coord.y === 1 && e.entryPort === Left);
    expect(carLeft).toBeDefined();
    expect(carLeft?.busOnly).toBeUndefined();
  });

  it("bus-only open ends are busOnly routing exits; car exits stay plain", () => {
    const exits = roadExits(level, W, H);
    const busTop = exits.find(e => e.coord.x === 1 && e.coord.y === 0 && e.entryPort === Top);
    expect(busTop).toBeDefined();
    expect(busTop?.busOnly).toBe(true);
    const carRight = exits.find(e => e.coord.x === 0 && e.coord.y === 1 && e.entryPort === Right);
    expect(carRight).toBeDefined();
    expect(carRight?.busOnly).toBeUndefined();
  });
});
