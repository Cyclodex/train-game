import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { citizensMode, citizensModeWith } from "@/modes/citizens";
import { citizenwalk } from "@/levels/test/scenarios/citizenwalk";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { citizenzebra, CROSSING_X } from "@/levels/test/scenarios/citizenzebra";
import {
  citizencrossback,
  CROSSING_ID,
} from "@/levels/test/scenarios/citizencrossback";
import {
  citizenrail,
  CROSSING_X as RAIL_X,
  STREET_Y as RAIL_Y,
} from "@/levels/test/scenarios/citizenrail";
import { threecities } from "@/levels/test/scenarios/threecities";
import { createPedestrianSim } from "@/sim/pedestrians";
import { pavementOffsets, roadHalfUnits } from "@/tiles/footway";
import { roadEntries } from "@/sim/road";

// Walking people, end to end. Like the driving spec, everything here runs
// through `game.advance()` — the headless world step — so a figure on the
// pavement is provable without a browser.
// The shipped mode by default; `tuning` for tests that need to see the daily
// rhythm or several days pass inside a few hundred board seconds. See the same
// note in citizenDriving.spec.ts.
function newGame(scenario = citizenwalk, tuning?: Parameters<typeof citizensModeWith>[0]) {
  return createGame(
    scenario.level,
    [],
    200,
    tuning ? citizensModeWith(tuning) : citizensMode,
    1,
    scenario.colors,
    undefined,
    scenario.id
  );
}

function trainDefs(trains: typeof citizenrail.trains): TrainDef[] {
  return Object.values(trains).map<TrainDef>(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
    destinations: (t.routeDestinations ?? []).map(d => d.to),
  }));
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

  // A WALK IS CONTINUOUS. Nobody teleports.
  //
  // The measuring stick for the three tests below: a stride is `speed * dt`
  // (0.25 * 0.2 = 0.05 of a tile, plus the ±20% spread), a road is ~0.44 of a
  // tile wide and a tile is 1. So anything over 0.15 in one tick is not walking
  // — it is either a hop across the carriageway or a hop to another tile, and
  // both were real.
  const STRIDE_MAX = 0.15;

  /** Every position a walk passes through, sampled each tick until they arrive. */
  function walkSamples(level: typeof citizenwalk.level, from: string, to: string) {
    const sim = createPedestrianSim({ level, seed: 1, speed: 0.25 });
    const id = sim.request(from, to);
    expect(id).toBeTruthy();
    const path: { x: number; y: number }[] = [];
    for (let t = 0; t < 400; t += 0.2) {
      sim.step(0.2);
      const [w] = sim.sample();
      if (!w) break;
      path.push({ x: w.x, y: w.y });
    }
    expect(sim.status(id as string)).toBe("arrived");
    return path;
  }

  /** The longest single tick of a walk, and where it happened. */
  function longestStride(path: { x: number; y: number }[]) {
    let worst = 0;
    let at = "";
    for (let i = 1; i < path.length; i++) {
      const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (d > worst) {
        worst = d;
        at = `${path[i - 1].x.toFixed(2)},${path[i - 1].y.toFixed(2)} -> ${path[i].x.toFixed(2)},${path[i].y.toFixed(2)}`;
      }
    }
    return { worst, at };
  }

  it("does not jump a tile when the walk DOUBLES BACK over a zebra", () => {
    // The reported bug, in one line: "he went left, and suddenly appeared
    // right." When the only crossing is past the destination, the route reaches
    // the crossing tile and leaves it BY THE SAME EDGE. That tile has to be
    // retraced — walked in to the middle and back out the way you came. Walking
    // on to the far edge instead put the walker a tile beyond where the next
    // step resumed, so they snapped a whole tile backwards: measured at 1.05.
    // The house and its works are on the SAME tile of street, opposite banks.
    const path = walkSamples(citizencrossback.level, "3,2", "3,0");
    expect(longestStride(path).worst).toBeLessThan(STRIDE_MAX);

    // And the shape of the walk is the point: west to the zebra, over, then
    // east again along the other bank to a door opposite the one they left.
    const xs = path.map(p => p.x);
    const turn = xs.indexOf(Math.min(...xs));
    expect(turn).toBeGreaterThan(2); // they really did walk out to the crossing
    expect(xs[0] - xs[turn]).toBeGreaterThan(0.8); // ...a tile west of the door
    expect(xs[xs.length - 1] - xs[turn]).toBeGreaterThan(0.8); // ...and back east
    // They changed banks exactly once, and only over the crossing tile.
    const crossed = path.filter((p, i) => i > 0 && (p.y - 1.5) * (path[i - 1].y - 1.5) < 0);
    expect(crossed).toHaveLength(1);
    expect(Math.floor(crossed[0].x)).toBe(Number(CROSSING_ID.split(",")[0]));
  });

  it("keeps to one BANK round a corner that spells its sides the other way round", () => {
    // A `side` is measured against each tile's OWN through direction, and a
    // tile's through direction is whichever movement its lane list names first.
    // `citizencrossback`'s bend is authored `twoWay(Right, Bottom)` and the
    // straight beside it `twoWay(Left, Right)`, so +1 means the OUTER bank on
    // one and the SOUTH bank on the other — opposite banks of the same street.
    // Carrying the bare number over that seam walked somebody a road's width
    // sideways, mid-stride, with no crossing under them (measured at 0.44).
    // The works round the bend on the west arm: cross at the zebra, then turn
    // the north-west corner onto the west arm's outer pavement.
    const path = walkSamples(citizencrossback.level, "3,2", "0,2");
    expect(longestStride(path).worst).toBeLessThan(STRIDE_MAX);

    // Having crossed, they walk the top street on its OUTER (north) bank...
    const afterZebra = path.filter(p => p.x > 2 && p.x < 3 && p.y < 1.5);
    expect(afterZebra.length).toBeGreaterThan(2);
    // ...and that is the bank the bend hands on, so they come down the west arm
    // on ITS outer (west) pavement — the same side of the tarmac, spelled with
    // the other sign. The bug put them on the far bank from the seam onwards,
    // having crossed nothing.
    const westArm = path.filter(p => p.x > 1 && p.x < 2 && p.y > 2 && p.y < 3);
    expect(westArm.length).toBeGreaterThan(2);
    for (const p of westArm) expect(p.x).toBeLessThan(1.5);
  });

  it("walks every route on every citizen board without a single jump", () => {
    // The general form of both bugs above, and the guard that catches the next
    // one: walk every pair of plots each board can route between and assert
    // nobody ever moves further in one tick than a person can stride.
    const jumps: string[] = [];
    let walked = 0;
    for (const scenario of [citizenwalk, citizenzebra, citizencrossback]) {
      const plots = Object.keys(scenario.level).filter(id => !!scenario.level[id].city);
      for (const from of plots) {
        for (const to of plots) {
          if (from === to) continue;
          const sim = createPedestrianSim({ level: scenario.level, seed: 1, speed: 0.25 });
          if (!sim.request(from, to)) continue;
          walked += 1;
          const path: { x: number; y: number }[] = [];
          for (let t = 0; t < 400; t += 0.2) {
            sim.step(0.2);
            const [w] = sim.sample();
            if (!w) break;
            path.push({ x: w.x, y: w.y });
          }
          const { worst, at } = longestStride(path);
          if (worst >= STRIDE_MAX) {
            jumps.push(`${scenario.id} ${from}->${to}: ${worst.toFixed(2)} tiles, ${at}`);
          }
        }
      }
    }
    expect(jumps).toEqual([]);
    expect(walked).toBeGreaterThan(300);
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
    // A compressed day so a few hundred board seconds cover several of them:
    // this is about the population's whole daily traffic, not one journey.
    const game = newGame(citizenwalk, { secPerDay: 300 });
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
    // Since phase C′ the keener cyclists take the 2–4 tile trips by BIKE — the
    // slice the bicycle plan explicitly promised them ("the winner for the 2–4
    // tile trips that are currently walk-or-drive") — so walking's share came
    // down from ~0.89 to ~0.62 here. What must stay true is that ACTIVE travel
    // owns this board and the walk is still its biggest single mode; a car
    // town it is not.
    expect(game.citizenStats.modeShare.walk).toBeGreaterThan(0.5);
    expect(
      game.citizenStats.modeShare.walk + game.citizenStats.modeShare.bike
    ).toBeGreaterThan(0.7);
    expect(game.citizenStats.tripsRefused).toBe(0);
  });

  it("nobody is on the pavement at 3am", () => {
    // The daily rhythm, so it sets its own clock — see the driving spec's
    // matching test. The shipped mode opens at 07:00 on purpose.
    const game = newGame(citizenwalk, { secPerDay: 300, startHour: 0 });
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

describe("a level crossing is a pedestrian crossing too", () => {
  // The railway half of the mechanic, and the OPPOSITE of the zebra: at a zebra
  // the walker claims the tile and the traffic gives way; at the tracks the
  // train has absolute priority, the walker waits, and nothing they do reaches
  // the railway at all.
  it("holds a walker at the tracks while a train has the tile, then lets them over", () => {
    let train = true;
    const sim = createPedestrianSim({
      level: citizenrail.level,
      seed: 1,
      speed: 0.25,
      railBusy: id => train && id === `${RAIL_X},${RAIL_Y}`,
    });
    // A house west of the line to a job east of it: the only way is over.
    const id = sim.request(`1,${RAIL_Y - 1}`, `7,${RAIL_Y - 1}`) as string;
    expect(id).toBeTruthy();

    let held = false;
    for (let t = 0; t < 40; t += 0.1) {
      sim.step(0.1);
      if (sim.waitingCount() > 0) held = true;
    }
    // They reached the line and stopped at it — on the near side, never on it.
    expect(held).toBe(true);
    expect(sim.status(id)).toBe("walking");
    const [w] = sim.sample();
    expect(w.waiting).toBe(true);
    // At the EDGE of the crossing tile, not on it: the rails run down its
    // middle (x = RAIL_X + 0.5), and the near boundary is RAIL_X. Somebody held
    // on the track would be the whole bug this rule exists to prevent.
    expect(w.x).toBeCloseTo(RAIL_X, 2);

    // ...and there is NO backstop here. A zebra has one, because a walker can
    // hold the traffic up and two mutual waits deadlock. This cannot: the train
    // never waits, so the wait ends when the train does.
    for (let t = 0; t < 60; t += 0.1) sim.step(0.1);
    expect(sim.status(id)).toBe("walking");

    // The train goes; they cross and arrive.
    train = false;
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

  it("never claims the railway — a train is not something you can stop", () => {
    const sim = createPedestrianSim({
      level: citizenrail.level,
      seed: 1,
      speed: 0.25,
      railBusy: () => false,
    });
    sim.request(`1,${RAIL_Y - 1}`, `7,${RAIL_Y - 1}`);
    for (let t = 0; t < 120; t += 0.1) {
      sim.step(0.1);
      // The zebra claim is what closes a tile to traffic. A pedestrian walking
      // over the RAILS must never produce one, or a queue of people would hold
      // a train at a signal.
      expect(sim.claimedCrossings()).toEqual([]);
      if (sim.count() === 0) break;
    }
  });

  it("gets the whole town to work across a running railway", () => {
    const game = createGame(
      citizenrail.level,
      trainDefs(citizenrail.trains),
      200,
      citizensMode,
      1,
      citizenrail.colors,
      citizenrail.traffic,
      "citizenrail"
    );
    let sawHeld = false;
    let sawTrainOnCrossing = false;
    run(game, 900, () => {
      if (game.pedestrians.some(p => p.waiting)) sawHeld = true;
      if (game.roadFrame.maxCarWaitSec > 1) sawTrainOnCrossing = true;
    });
    // People really do wait at the line...
    expect(sawHeld).toBe(true);
    // ...the cars wait on the same predicate...
    expect(sawTrainOnCrossing).toBe(true);
    // ...and the town still functions: the crossing is a cost, not a wall.
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(20);
    expect(game.citizenStats.tripsAbandoned).toBeLessThan(
      game.citizenStats.tripsCompleted / 4
    );
  }, 90000);
});
