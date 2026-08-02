import { describe, expect } from "vitest";
import { itSlow } from "../support/tier";
import { createRoadSim } from "@/sim/road";
import { lanesAllowingExit } from "@/tiles/lanes";
import { crossturns2lane } from "@/levels/test/scenarios/crossturns";

// Guards the multi-lane all-turns junction: every lane of every approach permits
// every turn (the editor authoring fix), AND cars actually spread across the
// lanes instead of all piling into lane 0 (the spawn-preference fix). Without the
// latter, a 2-lane junction drives like a single lane.
describe("multi-lane all-turns junction", () => {
  itSlow("cars cross from a permitted lane and use the inner lane too", () => {
    const centre = crossturns2lane.level["2,2"].road!;
    const sim = createRoadSim({
      level: crossturns2lane.level,
      width: 5,
      height: 5,
      seed: 6,
      spawnInterval: 0.4,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 14,
    });
    const seen = new Set<string>();
    let crossed = 0;
    let wrongLane = 0;
    let innerLane = 0;
    for (let s = 0; s < 1500; s++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        if (f.coord.x !== 2 || f.coord.y !== 2 || f.exitPort === null || seen.has(c.id)) continue;
        seen.add(c.id);
        crossed++;
        const lane = Math.round(c.laneIndex);
        if (!lanesAllowingExit(centre, f.entryPort, f.exitPort).includes(lane)) wrongLane++;
        if (lane >= 1) innerLane++;
      }
    }
    expect(crossed).toBeGreaterThan(20);
    expect(wrongLane).toBe(0); // never crosses from a lane that forbids the move
    expect(innerLane).toBeGreaterThan(0); // the inner lane is genuinely used
  }, 15000);
});
