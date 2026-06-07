import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { fromPairs } from "@/tiles/lanes";
import { createRoadSim } from "@/sim/road";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { oppositePort } from "@/sim/topology";
import { carroute } from "@/levels/test/scenarios/carroute";
import { isRoadJunction } from "@/tiles/lanes";

// A simple straight road across three tiles (Left<->Right), open at both map
// edges — a car entering at the left edge drives to the right edge.
function straightRoad(): Level {
  const road: [Position, Position] = [Position.Left, Position.Right];
  return {
    "0,0": { connections: [], road: fromPairs([road]) },
    "1,0": { connections: [], road: fromPairs([road]) },
    "2,0": { connections: [], road: fromPairs([road]) },
  };
}

describe("RoadSim.routePath", () => {
  it("returns [] for an unknown car id", () => {
    const sim = createRoadSim({ level: straightRoad(), width: 3, height: 1, seed: 1 });
    expect(sim.routePath("nope")).toEqual([]);
  });

  it("traces a live car's remaining route from its head tile to its destination edge", () => {
    const sim = createRoadSim({
      level: straightRoad(),
      width: 3,
      height: 1,
      seed: 1,
      spawnInterval: 1,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
    });
    // Step until a car exists.
    let id = "";
    for (let i = 0; i < 50 && !id; i++) {
      sim.step(0.1, () => false);
      const cars = sim.cars();
      if (cars.length > 0) id = cars[0].id;
    }
    expect(id).not.toBe("");

    const car = sim.cars().find(c => c.id === id)!;
    const path = sim.routePath(id);

    // Non-empty, and starts at the car's current head tile.
    expect(path.length).toBeGreaterThan(0);
    expect(getCoordinatesId(path[0].coord)).toBe(car.tileId);

    // The final segment exits the map at the car's destination opening.
    const dest = sim.cars().find(c => c.id === id);
    expect(dest).toBeTruthy();
    const last = path[path.length - 1];
    // The destination on a straight road open both ends is the right edge of 2,0.
    expect(getCoordinatesId(last.coord)).toBe("2,0");
    expect(last.exitPort).toBe(Position.Right);
  });

  it("traces routes that turn at a junction on the carroute demo map", () => {
    // Drive the actual /test/carroute map until several cars have routed, then
    // confirm at least one car's route bends (a non-straight move at the
    // junction) — the case the overlay exists to visualise.
    const sim = createRoadSim({
      level: carroute.level,
      width: carroute.size!.cols,
      height: carroute.size!.rows,
      seed: 7,
      spawnInterval: carroute.traffic!.spawnInterval,
      maxCars: carroute.traffic!.maxCars,
    });
    let sawTurn = false;
    for (let i = 0; i < 400 && !sawTurn; i++) {
      sim.step(0.1, () => false);
      for (const c of sim.cars()) {
        const path = sim.routePath(c.id);
        for (const seg of path) {
          if (!isRoadJunction(carroute.level[getCoordinatesId(seg.coord)]?.road)) continue;
          // A turn: the exit is not the straight-through (opposite of entry).
          if (seg.exitPort !== null && seg.exitPort !== oppositePort(seg.entryPort)) {
            sawTurn = true;
          }
        }
      }
    }
    expect(sawTurn).toBe(true);
  });
});
