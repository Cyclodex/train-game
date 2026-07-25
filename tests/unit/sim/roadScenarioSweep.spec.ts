import { describe, it, expect } from "vitest";
import { SCENARIOS } from "@/levels/test";
import { simFor, worstSweptOverlap, hasRoad, canSpawn, frontTiles } from "../support/roadSim";

// Registry-wide behavioural sweep of the road scenarios.
//
// The targeted specs each prove one mechanic on one hand-picked map. This file
// asks the question none of them do: does EVERY scenario in the gallery still
// behave like a road when you actually run it? A scenario is the project's unit
// of manual QA (CLAUDE.md: every feature ships one), so a gallery entry that
// gridlocks, spawns nothing, or lets bodies clip is a broken exhibit even when
// the mechanic it demonstrates is fine.
//
// It iterates the registry rather than a hand-written list, so a new scenario is
// covered the day it is added — which is the point: the failure mode this guards
// against is a scenario nobody has looked at in months.
//
// Deliberately NOT asserted here: anything about a specific map's layout. Those
// belong in the targeted specs. This is a liveness/health check.

const ROAD_SCENARIOS = SCENARIOS.filter(hasRoad);

// KNOWN, MEASURED body-overlap on a few bus maps. These are not "tolerated
// noise" — they are a real defect, recorded with the number they currently
// produce so they cannot quietly get worse while the fix is designed.
//
// The mechanism: lane-change gap acceptance is evaluated on the vehicle's
// CURRENT tile at the moment it commits. A long vehicle that crosses a tile seam
// mid-change never re-checks against the traffic on the tile it arrives at, so a
// bus that set off into a clear gap can finish the merge on the next tile with a
// stopped bus already lying in it, and its tail sweeps through that bus's nose
// for a few ticks. Bus maps show it because a bus is 1.45x a car's length and
// bus lanes force frequent merges; car-only maps stay clean.
//
// Fixing it properly means re-checking a committed change across a seam without
// leaving vehicles stranded astride the line (pausing mid-change makes a vehicle
// overlap BOTH lanes and measured worse). Tracked in the road backlog.
const KNOWN_OVERLAP: Record<string, number> = {
  busarterial: 0.09,
  buscross: 0.05,
  busonewaycross: 0.05,
  busmegacross: 0.04,
};
const CLEAN_OVERLAP = 0.02;

// Steps at 0.05s = 40s of simulated time. Long enough for a car to cross even the
// biggest gallery map several times, short enough to keep the sweep quick.
const STEPS = 800;
const SEED = 5;

describe("road scenario sweep — every gallery scenario stays live", () => {
  it("finds road scenarios to sweep (guards against the filter silently emptying)", () => {
    expect(ROAD_SCENARIOS.length).toBeGreaterThan(20);
  });

  for (const scenario of ROAD_SCENARIOS) {
    it(`${scenario.id}: populates, flows, and never clips`, () => {
      const sim = simFor(scenario, SEED);
      const live = canSpawn(scenario);
      let peakCars = 0;
      let worstOverlap = 0;
      // Flow = tile CROSSINGS. Counting despawns would call a closed circuit
      // (carcircle, overtakeloop) gridlocked when its cars are lapping happily,
      // and counting distance would drown a jam in the free cars around it.
      let crossings = 0;
      let lateCrossings = 0; // crossings in the final quarter — a jam that forms
      //                        and never clears shows up here and nowhere else
      let prev = frontTiles(sim);
      // Stuck detection: a tick where EVERY vehicle is stationary. A few are
      // normal (a red signal, a train on a crossing); hundreds in a row are not.
      let allStopped = 0;
      let longestAllStopped = 0;

      for (let i = 0; i < STEPS; i++) {
        sim.step(0.05, () => false);
        const cars = sim.cars();
        peakCars = Math.max(peakCars, cars.length);
        worstOverlap = Math.max(worstOverlap, worstSweptOverlap(sim));

        const now = frontTiles(sim);
        for (const [id, tile] of now) {
          const was = prev.get(id);
          if (was !== undefined && was !== tile) {
            crossings++;
            if (i >= STEPS * 0.75) lateCrossings++;
          }
        }
        prev = now;

        if (cars.length > 0 && cars.every(c => c.speed <= 0.001)) {
          allStopped++;
          longestAllStopped = Math.max(longestAllStopped, allStopped);
        } else {
          allStopped = 0;
        }
      }

      // No two bodies ever share road — asserted for EVERY scenario, spawning or
      // not. The clean tolerance absorbs body-sampling and curve discretisation;
      // a real clip is far larger. Scenarios with a KNOWN_OVERLAP are held to
      // their recorded number instead, so the defect is pinned rather than hidden.
      const bound = KNOWN_OVERLAP[scenario.id] ?? CLEAN_OVERLAP;
      expect(
        worstOverlap,
        KNOWN_OVERLAP[scenario.id]
          ? `${scenario.id} regressed past its recorded known overlap`
          : `${scenario.id} had bodies overlap`,
      ).toBeLessThan(bound);

      // A scenario with no way in is a deliberate static gallery (a closed ring
      // for eyeballing curve geometry). It must not crash, but it has no traffic
      // to be live about.
      if (!live) {
        expect(peakCars, `${scenario.id} cannot spawn yet produced vehicles`).toBe(0);
        return;
      }

      // 1. The road populated at all. A zero here means the scenario's spawn
      //    entries or lane directions are broken — it renders but is a dead map.
      expect(peakCars, `${scenario.id} never spawned a vehicle`).toBeGreaterThan(0);

      // 2. Traffic moved, and was STILL moving at the end of the run.
      expect(crossings, `${scenario.id} never advanced a vehicle to another tile`)
        .toBeGreaterThan(peakCars);
      expect(
        lateCrossings,
        `${scenario.id} stopped advancing before the run ended (jam that never clears?)`,
      ).toBeGreaterThan(0);

      // 3. No permanent standstill. 200 ticks = 10 simulated seconds with every
      //    vehicle stationary, which no signal phase or level crossing justifies.
      expect(
        longestAllStopped,
        `${scenario.id} stood completely still for ${longestAllStopped} ticks`,
      ).toBeLessThan(200);
    }, 30000);
  }
});
