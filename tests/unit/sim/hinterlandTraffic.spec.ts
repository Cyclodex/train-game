import { describe, it, expect } from "vitest";
import { createRoadSim } from "@/sim/road";
import { hinterland } from "@/levels/test/scenarios/hinterland";
import { levelBounds } from "@/tiles/bounds";

// MARKTSTADT MUST NOT GRIDLOCK.
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
// ROAD LAYER ALONE, with no trains and no citizens, because the failure is purely
// a property of the street network under load: hold a steady fleet of car trips
// across the village and nothing may end up permanently stopped.
//
// The shipped layout carries this cleanly. The OLD one fails it hard: about a
// third of the arrivals, and every car in the fleet frozen at the end.
const LOAD = 40; // concurrent journeys — about what the citizen board peaks at
const SECONDS = 900;
const GIVE_UP_SEC = 360; // tuning.maxWaitSec * 2, the citizen layer's own clock

// Deterministic, self-contained: this picks trip ENDS, so it must not perturb
// the road sim's own seeded streams.
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

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
  for (const seed of [3, 11]) {
    it(`carries a full village fleet without deadlocking (seed ${seed})`, () => {
      const r = driveTheVillage(seed);
      // Nothing may be permanently stuck. A car waits at a junction for a few
      // seconds all the time; a car that has not moved for a minute is a car
      // that is never moving again on this board.
      expect(r.frozen).toBe(0);
      expect(r.longestStop).toBeLessThan(60);
      // ...and the network must actually carry the load. The deadlocked layout
      // managed about 450 arrivals in this window with a third of the fleet
      // abandoning; a flowing one is several times that with almost none.
      expect(r.arrived).toBeGreaterThan(900);
      expect(r.gaveUp).toBeLessThan(20);
    });
  }
});
