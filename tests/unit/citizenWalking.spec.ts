import { describe, it, expect } from "vitest";
import { createGame } from "@/game";
import { citizensMode } from "@/modes/citizens";
import { citizenwalk } from "@/levels/test/scenarios/citizenwalk";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { threecities } from "@/levels/test/scenarios/threecities";
import { createPedestrianSim } from "@/sim/pedestrians";
import { pavementOffsets } from "@/tiles/footway";
import { roadEntries } from "@/sim/road";

// Walking people, end to end. Like the driving spec, everything here runs
// through `game.advance()` — the headless world step — so a figure on the
// pavement is provable without a browser.
function newGame(scenario = citizenwalk) {
  return createGame(
    scenario.level,
    [],
    200,
    citizensMode,
    1,
    scenario.colors,
    undefined,
    scenario.id
  );
}

function run(game: ReturnType<typeof createGame>, seconds: number, onTick?: () => void) {
  for (let t = 0; t < seconds; t += 0.2) {
    game.advance(0.2);
    onTick?.();
  }
}

describe("the pedestrian simulation", () => {
  it("walks a route tile by tile and arrives", () => {
    const sim = createPedestrianSim({ level: citizenwalk.level, seed: 1, speed: 0.25 });
    const id = sim.request("3,2", "3,0"); // a house to the works across the street
    expect(id).toBeTruthy();
    expect(sim.count()).toBe(1);

    let arrivedAt = -1;
    for (let t = 0; t < 200; t += 0.2) {
      sim.step(0.2);
      if (sim.status(id as string) === "arrived") {
        arrivedAt = t;
        break;
      }
    }
    expect(arrivedAt).toBeGreaterThan(0);
    expect(sim.count()).toBe(0);
  });

  it("keeps to the pavement on a straight, at the offset the paint uses", () => {
    const sim = createPedestrianSim({ level: citizenwalk.level, seed: 4, speed: 0.25 });
    // A house inside the block to the works outside the NE corner: the route
    // runs along the top of the ring and then turns.
    const id = sim.request("2,2", "6,0");
    expect(id).toBeTruthy();

    // The expected lateral offset, straight from the geometry the art is drawn
    // from — so the walker and the painted band can never drift apart.
    const off = pavementOffsets(citizenwalk.level["3,1"])[0] / 100;

    let checked = 0;
    for (let t = 0; t < 120; t += 0.1) {
      sim.step(0.1);
      const [w] = sim.sample();
      if (!w) break;
      // On a straight run of the top of the ring (y row 1), the pavement sits a
      // fixed distance either side of the carriageway's centreline. Tiles 4 and
      // 5 only: tile 3 carries the zebra, and somebody ON it is deliberately out
      // in the middle of the road.
      const tileX = Math.floor(w.x);
      if (w.y > 1 && w.y < 2 && tileX >= 4 && tileX <= 5) {
        expect(Math.abs(Math.abs(w.y - 1.5) - off)).toBeLessThan(0.02);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("ROUNDS A BEND instead of cutting the corner", () => {
    // The regression this exists for: the first version lerped between tile
    // CENTRES, so on a corner tile a walker left the drawn pavement entirely and
    // turned through a sharp V. A walker on a bend must follow a curve — which
    // means bowing measurably away from the straight chord between where it
    // enters the tile and where it leaves.
    const sim = createPedestrianSim({ level: citizenwalk.level, seed: 4, speed: 0.25 });
    sim.request("2,2", "6,0"); // turns at the ring's north-east corner, tile 6,1

    const onCorner: { x: number; y: number }[] = [];
    for (let t = 0; t < 120; t += 0.05) {
      sim.step(0.05);
      const [w] = sim.sample();
      if (!w) break;
      if (w.x > 6 && w.x < 7 && w.y > 1 && w.y < 2) onCorner.push({ x: w.x, y: w.y });
    }
    expect(onCorner.length).toBeGreaterThan(5);

    // Greatest distance from the chord joining the first and last samples.
    const a = onCorner[0];
    const b = onCorner[onCorner.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let bow = 0;
    for (const p of onCorner) {
      const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
      bow = Math.max(bow, d);
    }
    // A straight line bows 0. A quarter-turn across a tile bows a good fraction
    // of a tile, so this is a wide margin either side of the two behaviours.
    expect(bow).toBeGreaterThan(0.04);
  });

  it("claims the zebra it is crossing, which is what stops the traffic", () => {
    const sim = createPedestrianSim({ level: citizenwalk.level, seed: 1, speed: 0.25 });
    // A house inside the block to the works outside it: they must cross.
    sim.request("3,2", "3,0");
    let claimed: string[] = [];
    for (let t = 0; t < 120; t += 0.1) {
      sim.step(0.1);
      const c = sim.claimedCrossings();
      if (c.length) {
        claimed = c;
        break;
      }
      if (sim.count() === 0) break;
    }
    // The board's northern zebra. game.ts feeds this straight into the road
    // sim's `closed` predicate — the identical mechanism a level crossing uses
    // when a train is coming — so yielding needed no new rule in the traffic
    // model at all.
    expect(claimed).toEqual(["3,1"]);
  });

  it("waits at the kerb while a car is on the crossing, and goes when it clears", () => {
    let busy = true;
    const sim = createPedestrianSim({
      level: citizenwalk.level,
      seed: 1,
      speed: 0.25,
      roadBusy: tileId => busy && tileId === "3,1",
    });
    const id = sim.request("3,2", "3,0") as string;

    // Held: the walker reaches the zebra and stops there.
    let sawWaiting = false;
    for (let t = 0; t < 120; t += 0.1) {
      sim.step(0.1);
      if (sim.waitingCount() > 0) sawWaiting = true;
      if (sawWaiting && t > 40) break;
    }
    expect(sawWaiting).toBe(true);
    expect(sim.status(id)).toBe("walking"); // still stuck at the kerb
    // ...and a waiting walker says so, so the view can show the queue.
    expect(sim.sample().some(w => w.waiting)).toBe(true);

    // The car drives off; they cross and complete the journey.
    busy = false;
    let arrived = false;
    for (let t = 0; t < 200; t += 0.1) {
      sim.step(0.1);
      if (sim.status(id) === "arrived") {
        arrived = true;
        break;
      }
    }
    expect(arrived).toBe(true);
  });

  it("refuses a walk it cannot make rather than inventing a walker", () => {
    const sim = createPedestrianSim({ level: citizenwalk.level, seed: 1 });
    expect(sim.request("3,2", "3,2")).toBeNull();
    // threecities has no roads at all, so no pavements either.
    const bare = createPedestrianSim({ level: threecities.level, seed: 1 });
    expect(bare.request("1,1", "11,2")).toBeNull();
  });
});

describe("citizens walk where you can see them", () => {
  it("the board has no ambient traffic, so anything moving is a resident", () => {
    expect(roadEntries(citizenwalk.level, 8, 6)).toEqual([]);
  });

  it("turns walking citizens into figures on the pavement", () => {
    const game = newGame();
    let peakOnFoot = 0;
    let peakDots = 0;
    run(game, 1200, () => {
      peakOnFoot = Math.max(peakOnFoot, game.citizenStats.onFoot);
      peakDots = Math.max(peakDots, game.pedestrians.length);
    });
    expect(peakOnFoot).toBeGreaterThan(5);
    // The rendered figures ARE the walking citizens — one dot each, no more.
    expect(peakDots).toBe(peakOnFoot);
    // ...and this board is about walking: almost nobody's job needs a car.
    expect(game.citizenStats.modeShare.walk).toBeGreaterThan(0.7);
    expect(game.citizenStats.tripsRefused).toBe(0);
  });

  it("nobody is on the pavement at 3am", () => {
    const game = newGame();
    run(game, 50);
    expect(game.pedestrians.length).toBe(0);
    let peak = 0;
    run(game, 150, () => {
      peak = Math.max(peak, game.pedestrians.length);
    });
    expect(peak).toBeGreaterThan(0);
  });

  it("samples positions in world pixels, on the board", () => {
    const game = newGame();
    let seen: { x: number; y: number } | null = null;
    run(game, 400, () => {
      if (!seen && game.pedestrians.length) seen = { ...game.pedestrians[0] };
    });
    expect(seen).not.toBeNull();
    const at = seen as unknown as { x: number; y: number };
    // The board is 8x6 tiles at 200px.
    expect(at.x).toBeGreaterThan(0);
    expect(at.x).toBeLessThan(8 * 200);
    expect(at.y).toBeGreaterThan(0);
    expect(at.y).toBeLessThan(6 * 200);
  });

  it("a board with no pavements still works — the walk falls back to its clock", () => {
    // threecities is road-free, so no footway can exist on it. Nothing may
    // break: walking journeys simply stay abstract, as they always were.
    const game = newGame(threecities);
    run(game, 600);
    expect(game.pedestrians.length).toBe(0);
    expect(game.citizenStats.onFoot).toBe(0);
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(0);
  });

  it("walkers and drivers coexist on a board that has both", () => {
    const game = newGame(citizencars);
    let sawFoot = false;
    let sawCar = false;
    run(game, 900, () => {
      if (game.citizenStats.onFoot > 0) sawFoot = true;
      if (game.citizenStats.driving > 0) sawCar = true;
    });
    expect(sawFoot).toBe(true);
    expect(sawCar).toBe(true);
  });
});
