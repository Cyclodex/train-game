import { describe, expect } from "vitest";
import { itSlow } from "../support/tier";
import { createRoadSim } from "@/sim/road";
import { hinterland } from "@/levels/test/scenarios/hinterland";
import { levelBounds } from "@/tiles/bounds";
import { makeRng } from "@/utils/globalHelpers";

// MARKTSTADT'S STREETS MUST CARRY THE VILLAGE.
//
// The village used to be a ladder of single-file two-way streets with a junction
// at each end and nothing in between, and under its own residents' traffic it
// deadlocked outright: a queue backed into a junction box, the box blocked the
// stream that would have let the queue out, and the cars there NEVER MOVED AGAIN
// — 42 of the 46 cars on the board standing still for the rest of the run, and
// 35 journeys a day ending "given up on" at `maxWaitSec * 2`, the give-up clock
// for a driver whose car never arrives.
//
// This is the guard on the layout that fixed it (a middle rung at y=10 and two
// lanes each way inside the ladder — see the header of the scenario). It runs the
// ROAD LAYER ALONE, with no trains and no citizens, because the property it pins
// is purely one of the street network under load.
//
// WHAT THIS GUARD ASSERTS, AND WHY IT IS THROUGHPUT (corrected 2026-08-21).
//
// The first version of this test held 40 concurrent journeys inside the village
// and asserted that nothing ended up permanently stopped. That assertion cannot
// carry the claim, and the two seeds it shipped with were the reason it looked
// like it could. Measured over seeds 1..12, on the SHIPPED layout:
//
//   concurrent trips | shipped plan          | old ladder
//   12               | clean on every seed   | clean on every seed
//   18               | clean on every seed   | clean on every seed
//   24               | deadlocks on 2 of 6   | deadlocks on 2 of 6
//   40               | deadlocks on 8 of 12  | deadlocks on essentially all
//
// So "nothing is frozen" is VACUOUS at a load both plans survive and FLAKY at a
// load neither reliably survives — it never separates the two layouts, and a
// pair of passing seeds at load 40 was a lucky draw, not a property.
//
// What separates them at every seed is how much the streets CARRY. At 18
// concurrent journeys over 900s the old ladder lands 495-514 arrivals and the
// shipped plan 693-713 — about +37%, on every seed tried, with the longest
// single stand still under 14s. That is the real effect of the middle rung and
// the second lane, so that is what is asserted here. The freeze checks stay as a
// backstop; they are simply not the discriminating half.
//
// 18 is also the honest load: the whole 35x24 board peaks at ~46 cars, and this
// fleet is confined to the 84 road tiles of the village alone.
const LOAD = 18; // concurrent journeys held inside the village
const SECONDS = 900;
const GIVE_UP_SEC = 360; // tuning.maxWaitSec * 2, the citizen layer's own clock

// The floor the shipped plan must clear. Both sides of it are measured, and the
// run is fully deterministic (seeded rng, fixed dt, no clock anywhere in
// `src/sim`), so this is a hard line and not a tolerance: the old ladder tops
// out at 514 and the shipped plan bottoms out at 693.
const MIN_ARRIVALS = 600;

// Trip ENDS come from the project's own seeded PRNG (`makeRng`, mulberry32).
// It is deterministic and it is a stream of its OWN, so it cannot perturb the
// road sim's — which is the whole requirement here. Do NOT hand-roll a
// "self-contained" LCG for this: the obvious glibc `s * 1103515245` constants
// overflow the double mantissa in JS, so the result is not the generator it
// looks like (measured period from these seeds: 10466 values).
const NEVER_CLOSED = () => false;

function villageRoadTiles() {
  return Object.keys(hinterland.level)
    .filter(id => {
      const [x, y] = id.split(",").map(Number);
      return !!hinterland.level[id].road?.length && x <= 12 && y <= 19;
    })
    .sort();
}

function driveTheVillage(seed: number) {
  const level = hinterland.level;
  const grid = levelBounds(level);
  const sim = createRoadSim({
    level,
    width: grid.cols,
    height: grid.rows,
    seed,
    maxCars: 0, // the loop is closed anyway; every car here is a requested trip
  });
  const tiles = villageRoadTiles();
  const rng = makeRng(seed * 31 + 5);
  const live: { id: string; since: number }[] = [];
  // How long each car has been standing still, in seconds.
  const stopped = new Map<string, number>();
  let arrived = 0;
  let gaveUp = 0;
  let longestStop = 0;
  for (let t = 0; t < SECONDS; t += 0.25) {
    while (live.length < LOAD) {
      const from = tiles[Math.floor(rng() * tiles.length)];
      const to = tiles[Math.floor(rng() * tiles.length)];
      if (from === to) break;
      const id = sim.requestTrip(from, to, "car");
      if (!id) break;
      live.push({ id, since: t });
    }
    sim.step(0.25, NEVER_CLOSED);
    for (const car of sim.cars()) {
      if (car.phase !== "driving") continue;
      const still = Math.abs(car.velocity) < 1e-6 ? (stopped.get(car.id) ?? 0) + 0.25 : 0;
      stopped.set(car.id, still);
      if (still > longestStop) longestStop = still;
    }
    for (let i = live.length - 1; i >= 0; i--) {
      if (sim.tripStatus(live[i].id) === "arrived") {
        sim.clearFinishedTrip(live[i].id);
        arrived++;
        live.splice(i, 1);
      } else if (t - live[i].since > GIVE_UP_SEC) {
        sim.abandonTrip(live[i].id);
        gaveUp++;
        live.splice(i, 1);
      }
    }
  }
  const frozen = sim
    .cars()
    .filter(c => c.phase === "driving" && (stopped.get(c.id) ?? 0) > 60).length;
  return { arrived, gaveUp, frozen, longestStop };
}

describe("hinterland: Marktstadt's streets keep moving under their own traffic", () => {
  // FOUR SEEDS, not one and not two. A single trip stream cannot tell a layout
  // that works from a layout that got lucky — that is exactly how the first
  // version of this guard came to pass on a plan it should have failed.
  for (const seed of [1, 3, 7, 11]) {
    // Long-run tier: 3600 ticks of the road layer over the village's 84 road
    // tiles, four times. Seconds, not milliseconds — full suite only.
    itSlow(`carries the village's own traffic (seed ${seed})`, () => {
      const r = driveTheVillage(seed);
      // THE DISCRIMINATING ONE: what the streets actually carry. The old ladder
      // manages 495-514 here; the middle rung and the second lane make it 693+.
      expect(r.arrived).toBeGreaterThan(MIN_ARRIVALS);
      // Nobody may run out of patience at this load — measured 0 on both plans,
      // so this is a backstop against a regression, not a discriminator.
      expect(r.gaveUp).toBe(0);
      // And nothing may be permanently stuck. A car waits at a junction for a
      // few seconds all the time; a car that has not moved for a minute is a car
      // that is never moving again on this board. Longest measured stand: 13.5s.
      expect(r.frozen).toBe(0);
      expect(r.longestStop).toBeLessThan(60);
    });
  }
});
