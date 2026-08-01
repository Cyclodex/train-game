import { describe, expect } from "vitest";
import { itSlow } from "../support/tier";
import { createRoadSim } from "@/sim/road";
import { busshortcut } from "@/levels/test/scenarios/busshortcut";

// The middle bus-only street tiles. A car must NEVER occupy one of these.
const MIDDLE = new Set(["2,1", "2,2", "2,3"]);

describe("busshortcut scenario — traffic flows, the bus shortcut is bus-only", () => {
  itSlow("spawns both classes, keeps cars out of the middle, and routes buses through it", () => {
    const sim = createRoadSim({
      level: busshortcut.level,
      width: busshortcut.size!.cols,
      height: busshortcut.size!.rows,
      seed: 7,
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      mix: busshortcut.traffic!.mix,
      maxCars: 14,
    });

    // Track every vehicle that ever appears (by id) and its class, plus whether a
    // car ever sat on a middle tile and whether a bus ever used the middle street.
    const seenCars = new Set<string>();
    const seenBuses = new Set<string>();
    let carInMiddle = false;
    let busInMiddle = false;

    for (let i = 0; i < 3000; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const isBus = c.units[0].part === "bus";
        if (isBus) seenBuses.add(c.id);
        else seenCars.add(c.id);
        for (const u of c.units) {
          for (const s of [u.front, u.rear]) {
            const id = `${s.coord.x},${s.coord.y}`;
            if (!MIDDLE.has(id)) continue;
            if (isBus) busInMiddle = true;
            else carInMiddle = true;
          }
        }
      }
    }

    // (a) Both classes actually spawned — the closed-loop bug (zero vehicles) is gone.
    expect(seenCars.size).toBeGreaterThan(0);
    expect(seenBuses.size).toBeGreaterThan(0);
    // (b) No car ever occupied a bus-only middle-street tile.
    expect(carInMiddle).toBe(false);
    // (c) At least one bus took the middle shortcut.
    expect(busInMiddle).toBe(true);
  }, 30000); // heavy sim loop — fine alone, can exceed 5s under full-suite load
});
