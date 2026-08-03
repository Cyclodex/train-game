import { describe, it, expect } from "vitest";
import { createGame } from "@/game";
import { citizensMode } from "@/modes/citizens";
import { citizenwalk } from "@/levels/test/scenarios/citizenwalk";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { citizenzebra, CROSSING_X } from "@/levels/test/scenarios/citizenzebra";
import { threecities } from "@/levels/test/scenarios/threecities";
import { createPedestrianSim } from "@/sim/pedestrians";
import { pavementOffsets, roadHalfUnits } from "@/tiles/footway";
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

    // Held at the kerb: they reach the zebra and stop there.
    let sawWaiting = false;
    for (let t = 0; t < 6; t += 0.1) {
      sim.step(0.1);
      if (sim.waitingCount() > 0) sawWaiting = true;
    }
    expect(sawWaiting).toBe(true);
    expect(sim.status(id)).toBe("walking");
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

  it("goes anyway rather than standing at a kerb for ever", () => {
    // The deadlock backstop. Somebody who waits indefinitely is a bug, not
    // caution: the tile is already claimed, so nothing new can drive onto it,
    // and a walker frozen at a kerb holds the crossing closed and takes the
    // whole road down with it.
    const sim = createPedestrianSim({
      level: citizenwalk.level,
      seed: 1,
      speed: 0.25,
      roadBusy: () => true, // a car that never, ever moves
    });
    const id = sim.request("3,2", "3,0") as string;
    let arrived = false;
    for (let t = 0; t < 120; t += 0.1) {
      sim.step(0.1);
      if (sim.status(id) === "arrived") {
        arrived = true;
        break;
      }
    }
    expect(arrived).toBe(true);
  });

  it("crosses straight over and never doubles back into the road", () => {
    // The bug this exists for was visible on the board: people stepped onto the
    // zebra and came back out of the MIDDLE of the street. The cause was taking
    // the pavement's entry/exit ports from the PLOT the walker came from rather
    // than from the road, so the "pavement" ran across the carriageway and the
    // walk doubled back along it.
    const sim = createPedestrianSim({ level: citizenwalk.level, seed: 1, speed: 0.25 });
    const id = sim.request("3,2", "3,0") as string; // house, over the north zebra, works

    const ys: number[] = [];
    for (let t = 0; t < 200; t += 0.05) {
      sim.step(0.05);
      const [w] = sim.sample();
      if (!w) break;
      // While on the crossing tile, track how far north they have got.
      if (w.x > 3 && w.x < 4 && w.y > 1 && w.y < 2) ys.push(w.y);
    }
    expect(sim.status(id)).toBe("arrived");
    expect(ys.length).toBeGreaterThan(4);
    // Monotonic: south kerb to north kerb, never back the other way. A doubling
    // back shows up here as a reversal.
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1] + 1e-9);
    // ...and they really did get from one pavement to the other.
    expect(ys[0] - ys[ys.length - 1]).toBeGreaterThan(0.2);
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

describe("a zebra on a busy road", () => {
  // The board that tests this under load: a through road open at both map edges,
  // two lanes each way, running at full density, with one crossing and a town
  // that all has to get over it.
  function busyGame() {
    return createGame(
      citizenzebra.level,
      [],
      200,
      citizensMode,
      1,
      undefined,
      citizenzebra.traffic,
      "citizenzebra",
      () => 100 // density slider at maximum
    );
  }

  it("stops the traffic for people, without ever deadlocking", () => {
    const game = busyGame();
    let peakOnFoot = 0;
    let worstCarWait = 0;
    run(game, 1200, () => {
      peakOnFoot = Math.max(peakOnFoot, game.citizenStats.onFoot);
      worstCarWait = Math.max(worstCarWait, game.roadFrame.maxCarWaitSec);
    });

    // People really are crossing a busy road...
    expect(peakOnFoot).toBeGreaterThan(5);
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(50);
    // ...the traffic really does give way to them...
    expect(worstCarWait).toBeGreaterThan(1);
    // ...and it gets going again. THE regression guard: a car held at the kerb
    // still registers a body point on the crossing tile, so a walker that waits
    // for "any car touching the tile" waits for a car that is waiting for the
    // walker. That deadlock measured a 1078-second queue; anything above a
    // minute here means it is back.
    expect(worstCarWait).toBeLessThan(60);
  }, 90000);

  it("keeps the walkers moving too — nobody is stuck at the kerb for ever", () => {
    const game = busyGame();
    run(game, 900);
    // A town that cannot cross its own road would show up as abandoned journeys.
    expect(game.citizenStats.tripsAbandoned).toBeLessThan(
      game.citizenStats.tripsCompleted / 10
    );
    expect(game.citizenStats.modeShare.walk).toBeGreaterThan(0.4);
  }, 90000);

  it("nobody crosses the carriageway anywhere but the zebra", () => {
    const game = busyGame();
    // Where the tarmac ends, from the same geometry the road is drawn from.
    const half = roadHalfUnits(citizenzebra.level["3,1"]) / 100;

    const offenders = new Set<string>();
    let onZebra = 0;
    run(game, 900, () => {
      for (const p of game.pedestrians) {
        const x = p.x / 200;
        const y = p.y / 200;
        if (y <= 1 || y >= 2) continue; // not on the road row at all
        if (Math.abs(y - 1.5) >= half) continue; // on a pavement, outside the kerb
        if (Math.floor(x) === CROSSING_X) {
          onZebra += 1; // the one tile where being in the road is the point
          continue;
        }
        offenders.add(p.id);
      }
    });

    // People DO use the crossing...
    expect(onZebra).toBeGreaterThan(50);
    // ...and nobody is out on the tarmac anywhere else.
    //
    // THE regression guard, and it caught a real one: a pavement `side` is fixed
    // to the street, but the offset handed to the geometry sampler is relative to
    // the DIRECTION OF TRAVEL. Applying the side as a constant sign meant that
    // everyone walking back the other way was placed on the opposite bank, and
    // their driveway at the far end then hauled them straight over the road. On
    // this board — canonical direction eastbound, jobs reached by walking west
    // from the zebra — that was 125 people strolling across the traffic.
    expect([...offenders]).toEqual([]);
  }, 90000);
});
