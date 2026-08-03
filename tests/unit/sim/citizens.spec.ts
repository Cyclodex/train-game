import { describe, it, expect } from "vitest";
import { Level, TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { twoWay } from "@/tiles/lanes";
import { Position } from "@/types";
import { buildCitizenWorld } from "@/tiles/cities";
import { createCitizenSim, CitizenSim, TransitPort } from "@/sim/citizens";
import type { SimEvent } from "@/sim/simulation";

const town = (): TileCell => ({ connections: [], terrain: "urban" });
const works = (): TileCell => ({ connections: [], terrain: "industry" });

function col(level: Level, x: number, y0: number, h: number, cell: () => TileCell) {
  for (let y = y0; y < y0 + h; y++) level[`${x},${y}`] = cell();
}

// Two towns eleven tiles apart with a station beside each and NOTHING else
// between them: no road, no path, only the railway. Every job is in the east
// town, so the west town's commute is the thing under test.
//
// Kept under four urban tiles per town on purpose — `plotsOf` only carves out
// shops once a town is big enough for a parade, so this board's only jobs are
// the works, and every working citizen therefore has to cross the map.
function twoTownLevel(): Level {
  const level: Level = {};
  col(level, 0, 0, 3, town); // west town: homes
  level["2,1"] = expandKind("station", 1); // its station, 2 tiles away
  col(level, 10, 0, 3, town); // east town: homes
  col(level, 11, 0, 3, works); // and the works next door
  level["9,1"] = expandKind("station", 1); // the station serving both columns
  return level;
}

// A shuttle that calls at one platform, then the other, forever: the smallest
// possible "the trains are running". Returns the events for this tick.
// A stand-in for the rail sim: a platform per station holding NAMED people, and
// a shuttle that calls at each in turn. It speaks the same contract the real one
// does — a dwell event carrying WHO boarded and WHO got off — because that is
// what the citizen layer reads now; before tags it kept a shadow queue here and
// guessed.
function makePlatforms() {
  const waiting = new Map<string, { dest: string; tag: string }[]>();
  return {
    port: {
      enqueue(stationId: string, dest: string, tag: string) {
        const q = waiting.get(stationId) ?? [];
        q.push({ dest, tag });
        waiting.set(stationId, q);
        return true;
      },
      // The fake network connects everything it has a platform for.
      connects: () => true,
    } as TransitPort,
    waiting,
  };
}

function makeShuttle(
  stations: string[],
  periodSec: number,
  capacity: number,
  waiting: Map<string, { dest: string; tag: string }[]>
) {
  let t = 0;
  let next = 0;
  let aboard: string[] = [];
  return {
    tick(dt: number): SimEvent[] {
      t += dt;
      if (t < next) return [];
      next = t + periodSec;
      const tileId = stations[Math.floor(t / periodSec) % stations.length];
      // One hop: everyone aboard gets off here (the classic service).
      const alightedTags = aboard;
      const q = waiting.get(tileId) ?? [];
      const on = q.splice(0, Math.min(capacity, q.length));
      waiting.set(tileId, q);
      aboard = on.map(w => w.tag);
      return [
        {
          type: "dwell",
          trainId: "shuttle",
          tileId,
          boarded: on.length,
          alighted: alightedTags.length,
          ...(on.length ? { boardedTags: aboard } : {}),
          ...(alightedTags.length ? { alightedTags } : {}),
        },
      ];
    },
  };
}

function run(sim: CitizenSim, seconds: number, feed?: (dt: number) => SimEvent[]) {
  const dt = 0.25;
  for (let t = 0; t < seconds; t += dt) sim.step(dt, feed ? feed(dt) : []);
}

describe("citizens: the population", () => {
  it("seeds every home plot without exceeding its capacity", () => {
    const world = buildCitizenWorld(twoTownLevel());
    const sim = createCitizenSim({ world, seed: 3 });
    const homes = sim.plots().filter(p => p.kind === "home");
    expect(homes.length).toBe(6);
    for (const p of homes) {
      expect(p.people).toBeGreaterThan(0);
      expect(p.people).toBeLessThanOrEqual(p.capacity);
    }
    expect(sim.citizens().length).toBe(homes.reduce((n, p) => n + p.people, 0));
  });

  it("gives people jobs, and never more people than the workplace holds", () => {
    const world = buildCitizenWorld(twoTownLevel());
    const sim = createCitizenSim({ world, seed: 3 });
    const employed = sim.citizens().filter(c => c.work).length;
    expect(employed).toBeGreaterThan(0);
    for (const p of sim.plots().filter(p => p.kind !== "home")) {
      expect(p.people).toBeLessThanOrEqual(p.capacity);
    }
    // The jobs are all in the east town, so western commuters exist — which is
    // the entire reason the board needs a railway.
    const across = sim
      .citizens()
      .filter(c => c.work && c.home.startsWith("0,"));
    expect(across.length).toBeGreaterThan(0);
  });

  it("is deterministic: same seed, same world, same run", () => {
    const level = twoTownLevel();
    const a = createCitizenSim({ world: buildCitizenWorld(level), seed: 11 });
    const b = createCitizenSim({ world: buildCitizenWorld(level), seed: 11 });
    run(a, 300);
    run(b, 300);
    expect(a.stats()).toEqual(b.stats());
    expect(a.cities()).toEqual(b.cities());
  });
});

describe("citizens: the clock", () => {
  it("runs a day and sends people out in the morning", () => {
    const world = buildCitizenWorld(twoTownLevel());
    const sim = createCitizenSim({ world, seed: 5, tuning: { secPerDay: 120 } });
    expect(sim.stats().clock).toBe("00:00");
    run(sim, 40); // 08:00
    expect(sim.stats().hour).toBeGreaterThan(7);
    expect(sim.stats().hour).toBeLessThan(9);
    run(sim, 90); // into the next day
    expect(sim.day()).toBe(1);
  });
});

describe("citizens: mode choice", () => {
  it("with no railway and no road between the towns, the commute is refused", () => {
    const world = buildCitizenWorld(twoTownLevel());
    const sim = createCitizenSim({ world, seed: 5 }); // no transit port at all
    run(sim, 200);
    const s = sim.stats();
    expect(s.tripsRefused).toBeGreaterThan(0);
    expect(s.modeShare.transit).toBe(0);
    // ...and the town notices. `access` is the topic a refusal lands on.
    const worst = Math.min(...sim.cities().map(c => c.happiness.access));
    expect(worst).toBeLessThan(0.5);
  });

  it("with trains running, people ride them — and the trip completes", () => {
    const world = buildCitizenWorld(twoTownLevel());
    const { port, waiting } = makePlatforms();
    const sim = createCitizenSim({ world, seed: 5, transit: port });
    const shuttle = makeShuttle(["2,1", "9,1"], 8, 12, waiting);
    run(sim, 400, dt => shuttle.tick(dt));
    const s = sim.stats();
    expect(s.modeShare.transit).toBeGreaterThan(0);
    expect(s.tripsCompleted).toBeGreaterThan(0);
    expect(s.tripsRefused).toBe(0);
  });

  it("a short trip inside one town is walked, not driven or ridden", () => {
    // One town, one works next door: everything is within a few tiles.
    const level: Level = {};
    col(level, 0, 0, 3, town);
    col(level, 1, 0, 3, works);
    const sim = createCitizenSim({ world: buildCitizenWorld(level), seed: 2 });
    run(sim, 400);
    expect(sim.stats().modeShare.walk).toBe(1);
  });

  it("a road that reaches both ends turns the walk into a drive", () => {
    // The same town, stretched past the walking maximum, with a street running
    // the whole way one tile below (ROAD_ACCESS_TILES = 1): now it is a drive.
    const level: Level = {};
    col(level, 0, 0, 1, town);
    col(level, 6, 0, 1, works);
    for (let x = 0; x <= 6; x++) {
      level[`${x},1`] = { connections: [], road: twoWay(Position.Left, Position.Right) };
    }
    const sim = createCitizenSim({ world: buildCitizenWorld(level), seed: 2 });
    run(sim, 400);
    const s = sim.stats();
    // Six tiles is walkable but a slog, so the drivers drive and the rest walk —
    // and nobody is stranded, because a road reaches both ends.
    expect(s.modeShare.car).toBeGreaterThan(0);
    expect(s.modeShare.walk).toBeGreaterThan(0);
    expect(s.tripsRefused).toBe(0);
  });

  it("two streets that do not join are not a road link", () => {
    // Same geometry, but the street has a gap in the middle: each town has a
    // road of its own and there is still no way to drive between them.
    const level: Level = {};
    col(level, 0, 0, 1, town);
    col(level, 8, 0, 1, works);
    for (const x of [0, 1, 7, 8]) {
      level[`${x},1`] = { connections: [], road: twoWay(Position.Left, Position.Right) };
    }
    const world = buildCitizenWorld(level);
    const west = world.plots.find(p => p.id === "0,0");
    const east = world.plots.find(p => p.id === "8,0");
    expect(west?.hasRoad).toBe(true);
    expect(east?.hasRoad).toBe(true);
    expect(west?.roadComponent).not.toBe(east?.roadComponent);

    const sim = createCitizenSim({ world, seed: 2 });
    run(sim, 400);
    expect(sim.stats().modeShare.car).toBe(0);
    expect(sim.stats().tripsRefused).toBeGreaterThan(0);
  });
});

describe("citizens: the feedback loop", () => {
  it("a town nobody can leave empties out, while the one that works fills up", () => {
    // The west town's every job is across the map and there is no way to get
    // there; the east town's work is next door. Same board, opposite fates —
    // which is the whole feedback loop in one assertion.
    const world = buildCitizenWorld(twoTownLevel());
    const sim = createCitizenSim({ world, seed: 5 });
    const [westBefore, eastBefore] = sim.cities().map(c => c.population);
    run(sim, 1200); // ten days of failing to get to work
    const [west, east] = sim.cities().map(c => c.population);
    expect(west).toBeLessThan(westBefore);
    expect(east).toBeGreaterThanOrEqual(eastBefore);
    expect(sim.cities()[0].happiness.overall).toBeLessThan(
      sim.cities()[1].happiness.overall
    );
  });

  it("a town that works grows — people move in and the buildings get bigger", () => {
    // A self-contained town: homes, shops in the middle, works next door, all
    // walkable. Nothing to get wrong, so it should thrive.
    const level: Level = {};
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) level[`${x},${y}`] = town();
    for (let y = 0; y < 4; y++) level[`4,${y}`] = works();
    const sim = createCitizenSim({ world: buildCitizenWorld(level), seed: 8 });
    const before = sim.stats().population;
    const startCapacity = sim.plots().reduce((n, p) => n + p.capacity, 0);
    run(sim, 1500);
    const city = sim.cities()[0];
    expect(city.happiness.overall).toBeGreaterThan(0.55);
    expect(sim.stats().population).toBeGreaterThan(before);
    // Growth is not just filling: plots upgraded, so the town holds more.
    expect(sim.plots().reduce((n, p) => n + p.capacity, 0)).toBeGreaterThan(startCapacity);
  });

  it("reports population, jobs, happiness and mode share per city", () => {
    const world = buildCitizenWorld(twoTownLevel());
    const sim = createCitizenSim({ world, seed: 5 });
    run(sim, 200);
    const cities = sim.cities();
    expect(cities).toHaveLength(2);
    for (const c of cities) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.jobs.total).toBeGreaterThanOrEqual(c.jobs.filled);
      for (const v of Object.values(c.happiness)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // Only the east town has workplaces on it.
    expect(cities.filter(c => c.jobs.total > 0)).toHaveLength(1);
  });
});
