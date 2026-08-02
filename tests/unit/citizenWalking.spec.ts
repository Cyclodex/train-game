import { describe, it, expect } from "vitest";
import { createGame } from "@/game";
import { citizensMode } from "@/modes/citizens";
import { citizenwalk } from "@/levels/test/scenarios/citizenwalk";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { threecities } from "@/levels/test/scenarios/threecities";
import { createPedestrianSim } from "@/sim/pedestrians";
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

  it("puts people on the pavement, not down the middle of the road", () => {
    const sim = createPedestrianSim({ level: citizenwalk.level, seed: 4, speed: 0.25 });
    // Several walkers so both pavements are used.
    for (const from of ["2,2", "3,2", "4,2", "5,2"]) sim.request(from, "3,0");
    let offCentre = 0;
    let samples = 0;
    for (let t = 0; t < 30; t += 0.2) {
      sim.step(0.2);
      for (const w of sim.sample()) {
        samples += 1;
        // A tile centre sits at *.5; anybody walking the carriageway would sit
        // on one of those lines. On a pavement they never do.
        const dx = Math.abs((w.x % 1) - 0.5);
        const dy = Math.abs((w.y % 1) - 0.5);
        if (dx > 0.05 || dy > 0.05) offCentre += 1;
      }
    }
    expect(samples).toBeGreaterThan(20);
    expect(offCentre).toBe(samples);
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
