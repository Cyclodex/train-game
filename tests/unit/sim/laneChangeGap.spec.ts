import { describe, it, expect } from "vitest";
import { itSlow } from "../support/tier";
import { scenarioById } from "@/levels/test";
import { simFor, worstSweptOverlap } from "../support/roadSim";

// Lane-change gap acceptance (#56), on the map built for it: a busy one-way
// 3-lane straight where keep-right sends everyone toward a kerb lane that is
// rarely free.
//
// The registry sweep (roadScenarioSweep.spec.ts) already asserts no scenario
// clips — but at ONE seed. That is exactly how this defect stayed half-hidden for
// so long: the four bus maps the issue named were merely the ones that clipped at
// seed 5, while roadstraightlanes and overtakeloop were just as broken one seed
// over. So this spec runs the dedicated map across several seeds, and pins the two
// invariants a lane change must hold beyond "no overlap this time".

const SEEDS = [1, 3, 5, 7, 11];
const STEPS = 800;

describe("lane-change gap acceptance (#56)", () => {
  const scenario = scenarioById("lanechangegap");

  for (const seed of SEEDS) {
    it(`seed ${seed}: no two bodies ever overlap`, () => {
      const sim = simFor(scenario, seed);
      let worst = 0;
      for (let i = 0; i < STEPS; i++) {
        sim.step(0.05, () => false);
        worst = Math.max(worst, worstSweptOverlap(sim));
      }
      // The clean bound the whole gallery is held to. Before the fix this map's
      // cousins measured up to 0.22 — a whole body length of one car inside
      // another.
      expect(worst, "bodies overlapped during a lane change").toBeLessThan(0.02);
    }, 30000);
  }

  itSlow("never leaves a stopped vehicle parked astride a lane line", () => {
    // A car halted mid-merge blocks BOTH lanes for as long as the queue lasts, and
    // is what made "brake when the gap closes" measure worse than doing nothing.
    // A stopped straddler must resolve onto one lane within a beat.
    let worstStraddle = 0;
    for (const seed of SEEDS) {
      const sim = simFor(scenario, seed);
      const straddling = new Map<string, number>();
      for (let i = 0; i < STEPS; i++) {
        sim.step(0.05, () => false);
        for (const c of sim.cars()) {
          const off = Math.abs(c.laneIndex - Math.round(c.laneIndex));
          const stuck = c.velocity <= 0.001 && off > 0.05;
          const ticks = stuck ? (straddling.get(c.id) ?? 0) + 1 : 0;
          straddling.set(c.id, ticks);
          worstStraddle = Math.max(worstStraddle, ticks);
        }
      }
    }
    // 20 ticks = 1 simulated second: long enough for the shuffle onto a lane
    // (LANE_PARK_RATE), far short of "stuck there".
    expect(worstStraddle, "a stopped car sat astride a lane line").toBeLessThan(20);
  }, 30000);

  itSlow("keeps the road flowing — gap acceptance must not gridlock the merge", () => {
    // The cheap way to never clip is to never move. Every seed must still deliver
    // cars off the far edge of the map.
    for (const seed of SEEDS) {
      const sim = simFor(scenario, seed);
      let spawned = 0;
      const seen = new Set<string>();
      for (let i = 0; i < STEPS; i++) {
        sim.step(0.05, () => false);
        for (const c of sim.cars()) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            spawned++;
          }
        }
      }
      // Far more cars passed through than the map holds at once, so traffic is
      // entering at one edge and leaving at the other rather than standing still.
      expect(spawned, `seed ${seed} did not turn traffic over`).toBeGreaterThan(20);
    }
  }, 30000);
});
