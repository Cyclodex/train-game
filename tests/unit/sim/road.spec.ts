import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import {
  roadTraverse,
  roadEntries,
  createRoadSim,
} from "@/sim/road";

// A simple straight road across three tiles (Left<->Right), open at both map
// edges (0,0 enters from the left edge, 2,0 leaves at the right edge).
function straightRoad(): Level {
  const road: [Position, Position] = [Position.Left, Position.Right];
  return {
    "0,0": { connections: [], road: [road] },
    "1,0": { connections: [], road: [road] },
    "2,0": { connections: [], road: [road] },
  };
}

describe("roadTraverse", () => {
  it("follows a straight road to the next tile", () => {
    const lvl = straightRoad();
    const t = roadTraverse(lvl, { x: 0, y: 0 }, Position.Left);
    expect(t.exitPort).toBe(Position.Right);
    expect(t.next).toEqual({ coord: { x: 1, y: 0 }, entryPort: Position.Left });
  });

  it("returns no next tile when the road runs off the map edge", () => {
    const lvl = straightRoad();
    const t = roadTraverse(lvl, { x: 2, y: 0 }, Position.Left);
    expect(t.exitPort).toBe(Position.Right);
    expect(t.next).toBeNull();
  });

  it("returns no exit for a port the road does not use", () => {
    const lvl = straightRoad();
    const t = roadTraverse(lvl, { x: 0, y: 0 }, Position.Top);
    expect(t.exitPort).toBeNull();
    expect(t.next).toBeNull();
  });

  it("ignores rail connections (only road pairs route cars)", () => {
    // A level crossing: rail Top<->Bottom, road Left<->Right.
    const lvl: Level = {
      "0,0": {
        connections: [[Position.Top, Position.Bottom]],
        road: [[Position.Left, Position.Right]],
      },
    };
    // Entering from the road Left, the car leaves Right (not via the rail).
    const t = roadTraverse(lvl, { x: 0, y: 0 }, Position.Left);
    expect(t.exitPort).toBe(Position.Right);
    // Entering from the rail Top, the road has no such port: no exit.
    const r = roadTraverse(lvl, { x: 0, y: 0 }, Position.Top);
    expect(r.exitPort).toBeNull();
  });
});

describe("roadEntries", () => {
  it("finds road ports that open onto the map edge (car spawn points)", () => {
    const lvl = straightRoad();
    const entries = roadEntries(lvl, 3, 1);
    // 0,0 opens left onto the edge; 2,0 opens right onto the edge.
    expect(entries).toContainEqual({ coord: { x: 0, y: 0 }, entryPort: Position.Left });
    expect(entries).toContainEqual({ coord: { x: 2, y: 0 }, entryPort: Position.Right });
    // The middle tile connects on both sides to road neighbours: not an entry.
    expect(entries.every(e => !(e.coord.x === 1 && e.coord.y === 0))).toBe(true);
  });
});

describe("createRoadSim — spawning + movement", () => {
  it("does not spawn or move when there are no roads", () => {
    const sim = createRoadSim({ level: {}, width: 3, height: 1, seed: 1 });
    for (let i = 0; i < 100; i++) sim.step(0.1, () => false);
    expect(sim.cars().length).toBe(0);
  });

  it("spawns cars deterministically and drives them along the road", () => {
    const lvl = straightRoad();
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 7,
      spawnInterval: 1, // one spawn attempt per second of sim time
    });
    // Advance enough sim time to spawn at least one car and move it.
    let moved = false;
    for (let i = 0; i < 200; i++) {
      sim.step(0.1, () => false);
      if (sim.cars().some(c => c.headIndex > 0 || c.headProgress > 0)) moved = true;
    }
    expect(sim.cars().length).toBeGreaterThan(0);
    expect(moved).toBe(true);
  });

  it("is deterministic for a fixed seed", () => {
    const run = () => {
      const sim = createRoadSim({
        level: straightRoad(),
        width: 3,
        height: 1,
        seed: 42,
        spawnInterval: 1,
      });
      for (let i = 0; i < 60; i++) sim.step(0.1, () => false);
      return sim.cars().map(c => ({
        head: c.headIndex,
        prog: Math.round(c.headProgress * 1000),
      }));
    };
    expect(run()).toEqual(run());
  });
});

describe("createRoadSim — occupancy gate", () => {
  it("a car never enters a tile occupied by another car", () => {
    // Two-tile road; force two cars onto it and check they never share a tile.
    const lvl: Level = {
      "0,0": { connections: [], road: [[Position.Left, Position.Right]] },
      "1,0": { connections: [], road: [[Position.Left, Position.Right]] },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 2,
      height: 1,
      seed: 3,
      spawnInterval: 0.2, // spawn often to crowd the road
    });
    for (let i = 0; i < 300; i++) {
      sim.step(0.05, () => false);
      const tiles = sim.cars().map(c => c.tileId);
      const unique = new Set(tiles);
      expect(unique.size).toBe(tiles.length); // no two cars on the same tile
    }
  });
});

describe("createRoadSim — crossing gate from rail reservation", () => {
  it("holds a car at a closed crossing and releases it when the train clears", () => {
    // road across 0,0 (open left) -> 1,0 (the crossing) -> 2,0 (open right).
    const lvl: Level = {
      "0,0": { connections: [], road: [[Position.Left, Position.Right]] },
      "1,0": {
        connections: [[Position.Top, Position.Bottom]],
        road: [[Position.Left, Position.Right]],
      },
      "2,0": { connections: [], road: [[Position.Left, Position.Right]] },
    };
    let closed = true;
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 5,
      spawnInterval: 0.5,
    });
    // Run with the crossing closed: cars pile up before 1,0 but never enter it.
    for (let i = 0; i < 200; i++) {
      sim.step(0.1, id => id === "1,0" && closed);
      expect(sim.cars().every(c => c.tileId !== "1,0")).toBe(true);
    }
    expect(sim.cars().length).toBeGreaterThan(0); // at least one is waiting

    // Open the gate: a waiting car must now be able to reach/pass the crossing.
    closed = false;
    let enteredCrossing = false;
    for (let i = 0; i < 400; i++) {
      sim.step(0.1, () => false);
      if (sim.cars().some(c => c.tileId === "1,0")) enteredCrossing = true;
    }
    expect(enteredCrossing).toBe(true);
  });
});
