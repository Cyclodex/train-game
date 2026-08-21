import { describe, expect } from "vitest";
import { itSlow } from "../support/tier";
import { createRoadSim } from "@/sim/road";
import { hinterland } from "@/levels/test/scenarios/hinterland";
import { levelBounds } from "@/tiles/bounds";
import { makeRng } from "@/utils/globalHelpers";

// MARKTSTADT MUST KEEP MOVING AT VILLAGE LOAD.
//
// The village used to be a ladder of single-file two-way streets with a junction
// at each end and nothing in between, and under its own residents' traffic it
// deadlocked outright: a queue backed into a junction box, the box blocked the
// stream that would have let the queue out, and the cars there never moved again
// — 42 of the 46 cars on the board standing still for the rest of the run, and
// 35 journeys a day ending "given up on" at `maxWaitSec * 2`, the give-up clock
// for a driver whose car never arrives.
//
// This is the guard on the layout that fixed it (a middle rung at y=10 and two
// lanes each way inside the ladder — see the header of the scenario). It runs the
// ROAD LAYER ALONE, with no trains and no citizens, because the property it pins
// is purely one of the street network under load: hold a steady fleet of car
// trips across the village, and nothing may end up permanently stopped.
//
// WHY LOAD IS 24 AND NOT 40. A constant load holds the network at that density
// for the whole run — every arrival is instantly replaced, which no real traffic
// (and not the citizens board, whose demand comes in peaks) ever does. A constant
// 40 is past the network's stable capacity: about a third of seeds end in genuine
// permanent gridlock, and WHICH seeds those are re-rolls on any change to the
// sim's dynamics — that is how this guard first shipped green on seeds 3+11 and
// turned red when an unrelated constants retune (PR #98, CLIP_LANES) landed.
// Asserting zero freeze at a supercritical load asserts a coin toss; asserting it
// at village load asserts the layout.
//
// THE LOAD-24 ENVELOPE IS MEASURED, NOT ASSUMED (re-swept 2026-08-21, seeds 1..20
// against BOTH trip streams — this file's and the one it used to hand-roll):
//
//   layout       | arrived  | gave up | frozen | longest stand
//   ships        | 887-967  |       0 |      0 |        24.25s
//   old ladder   | 192-674  |    0-23 |    0-3 |          352s
//
// Forty runs of the shipped plan, not one frozen car and not one give-up. The old
// ladder never once clears 700 arrivals and jams solid on a third of its seeds.
// So at this load every assertion below is true of the shipped layout on every
// seed AND false of the plan it replaced — which is the whole job of a guard.
//
// `arrived` is the DISCRIMINATING one: freeze-freedom is shared by both plans at
// any load either survives, so it is a backstop and not the evidence. Read the
// two together — a plan that carried nothing would also freeze nothing.
//
// The remaining supercritical knot is real, precisely understood, and NOT this
// board's authoring error: a level crossing directly between two junction boxes
// couples them through the patience-less rail-crossing keep-clear into one
// mutual-exclusion zone, and two opposing streams close a wait-cycle through it
// (full mechanism in the scenario header). Raising that ceiling needs a sim
// mechanism, not a bigger test threshold.
const LOAD = 24; // concurrent journeys — a full village peak, inside capacity
const SECONDS = 900;
const GIVE_UP_SEC = 360; // tuning.maxWaitSec * 2, the citizen layer's own clock

// Trip ENDS come from the project's own seeded PRNG (`makeRng`, mulberry32). It
// is deterministic and it is a stream of its OWN, so it cannot perturb the road
// sim's — which is the whole requirement here. Do NOT hand-roll a "self-contained"
// LCG for it, which is what this file used to do: the obvious glibc
// `s * 1103515245 + 12345` constants overflow the double mantissa in JS, so the
// state space collapses and the result is not the generator it looks like
// (measured period from every seed tried: 10466 values, against the 2^31 the
// arithmetic promises).
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
  // version of this guard came to pass on a load it should have failed. Four is
  // what the slow tier can afford (~2s each); the twenty-seed sweep behind the
  // table above is what licenses these four to stand for the rest.
  for (const seed of [1, 3, 7, 11]) {
    // Long-run tier: 3600 ticks of the road layer over the village's 84 road
    // tiles, four times. Seconds, not milliseconds — full suite only.
    itSlow(`carries a full village fleet without deadlocking (seed ${seed})`, () => {
      const r = driveTheVillage(seed);
      // Nothing may be permanently stuck. A car waits at a junction for a few
      // seconds all the time; a car that has not moved for a minute is a car
      // that is never moving again on this board. (Measured margin at this load:
      // the longest stand over 40 probed runs is 24.25s.)
      expect(r.frozen).toBe(0);
      expect(r.longestStop).toBeLessThan(60);
      // ...and the network must actually CARRY the load — the assertion that
      // separates this layout from the one it replaced. Every probed seed lands
      // 887-967 journeys here; the old ladder tops out at 674.
      expect(r.arrived).toBeGreaterThan(700);
      expect(r.gaveUp).toBeLessThan(20);
    });
  }
});
