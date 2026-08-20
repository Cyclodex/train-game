import { describe, it, expect } from "vitest";
import { Level, TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { buildCitizenWorld } from "@/tiles/cities";
import {
  createCitizenSim,
  CitizenSim,
  CitizenTuning,
  LifeStage,
  LIFE_STAGES,
} from "@/sim/citizens";
import { createGame, TrainDef } from "@/game";
import { citizensModeWith } from "@/modes/citizens";
import { citizenday } from "@/levels/test/scenarios/citizenday";

// LIFE STAGES AND ROUTINES — when people travel, as opposed to how.
//
// The feature this spec guards is a NEGATIVE one and it is easy to lose by
// accident: a board must not be empty between the peaks. Everything else here
// (which stage gets which day, where a call-out goes) exists to make that
// property hold for a reason rather than by luck.
//
// Design: docs/superpowers/specs/2026-08-04-life-stages-and-daily-routines-design.md

const town = (): TileCell => ({ connections: [], terrain: "urban" });
const works = (): TileCell => ({ connections: [], terrain: "industry" });
const zoned = (kind: "school" | "leisure" | "shop"): TileCell => ({
  connections: [],
  terrain: "urban",
  zone: kind,
});

// A single village with one of everything: houses, a yard, a shop, a school and
// a café, all within walking reach. Everything succeeds here, so anything that
// fails is the ROUTINE failing rather than the network.
function villageLevel(withSchool = true): Level {
  const level: Level = {};
  for (let y = 0; y < 3; y++) {
    level[`0,${y}`] = town();
    level[`1,${y}`] = town();
    level[`4,${y}`] = works();
  }
  level["2,0"] = zoned("shop");
  level["2,1"] = zoned("leisure");
  level["2,2"] = withSchool ? zoned("school") : town();
  level["3,1"] = expandKind("station", 1);
  return level;
}

// Everybody the same stage, so a test can look at one life at a time.
function onlyStage(stage: LifeStage): Partial<CitizenTuning> {
  const mix = Object.fromEntries(LIFE_STAGES.map(s => [s, s === stage ? 1 : 0]));
  return { stageMix: mix as Record<LifeStage, number> };
}

function simOf(tuning: Partial<CitizenTuning>, withSchool = true, seed = 4): CitizenSim {
  return createCitizenSim({ world: buildCitizenWorld(villageLevel(withSchool)), seed, tuning });
}

function run(sim: CitizenSim, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.25) sim.step(0.25);
}

describe("life stages", () => {
  it("gives each stage the day its name promises", () => {
    // Read as a table: what each life is FOR, expressed as where it goes.
    const expected: Record<LifeStage, string[]> = {
      child: ["school", "home", "leisure", "home"],
      worker: ["work", "home", "shop"],
      shiftWorker: ["shop", "work", "home"],
      tradesperson: ["work", "callout", "work", "callout", "work", "home"],
      retired: ["leisure", "home", "shop", "home"],
    };
    for (const stage of LIFE_STAGES) {
      const sim = simOf(onlyStage(stage));
      const c = sim.citizens()[0];
      expect(c.stage).toBe(stage);
      expect(c.routine.map(a => a.target)).toEqual(expected[stage]);
      // A trip home is never anchored: wherever the day left somebody, they can
      // always get back. Everything else starts somewhere specific.
      for (const a of c.routine) {
        if (a.target === "home") expect(a.from).toBeUndefined();
      }
    }
  });

  it("only employs the stages that hold down a job", () => {
    for (const stage of LIFE_STAGES) {
      const sim = simOf(onlyStage(stage));
      const employed = sim.citizens().filter(c => c.work !== null).length;
      const total = sim.citizens().length;
      expect(total).toBeGreaterThan(0);
      if (stage === "child" || stage === "retired") expect(employed).toBe(0);
      else expect(employed).toBe(total);
    }
  });

  it("gives every tradesperson the van and no child a car", () => {
    expect(simOf(onlyStage("tradesperson")).citizens().every(c => c.profile.carOwner)).toBe(true);
    expect(simOf(onlyStage("child")).citizens().some(c => c.profile.carOwner)).toBe(false);
  });

  it("rolls the same town twice for the same seed", () => {
    const a = simOf({}, true, 9).citizens();
    const b = simOf({}, true, 9).citizens();
    expect(a.length).toBe(b.length);
    expect(a.map(c => `${c.stage}:${c.routine.map(r => r.hour.toFixed(3)).join(",")}`)).toEqual(
      b.map(c => `${c.stage}:${c.routine.map(r => r.hour.toFixed(3)).join(",")}`)
    );
  });
});

describe("the tradesperson's round", () => {
  it("sends the van somewhere that is not their own yard, and somewhere new each day", () => {
    // 600s a day, not 60: a walk across this village takes ~26 board seconds,
    // so on a one-minute day a single trip would eat ten in-game hours and the
    // round would never get past its first call. The compressed day still has to
    // be long enough to hold the journeys in it.
    const sim = simOf({ ...onlyStage("tradesperson"), secPerDay: 600 });
    const seen = new Map<string, Set<string>>();
    // Three days. Every call-out that fires is recorded against the person who
    // made it, so a van that only ever visits one address would show up as a
    // set of size one.
    for (let t = 0; t < 1800; t += 0.25) {
      sim.step(0.25);
      for (const c of sim.citizens()) {
        if (c.trip?.purpose !== "callout") continue;
        expect(c.trip.to).not.toBe(c.work);
        expect(c.trip.to).not.toBe(c.home);
        const set = seen.get(c.id) ?? new Set<string>();
        set.add(c.trip.to);
        seen.set(c.id, set);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    // At least somebody's round moved. (Not everybody's: on a one-village board
    // the reachable pool is small, so two days can legitimately collide.)
    expect([...seen.values()].some(s => s.size > 1)).toBe(true);
  });
});

describe("a board with no school", () => {
  it("skips the school run instead of refusing it over and over", () => {
    const sim = simOf({ ...onlyStage("child"), secPerDay: 600 }, false);
    run(sim, 1800); // three days
    const s = sim.stats();
    // The children still have an afternoon — the café is reachable — so the
    // board is not idle. What must NOT happen is a refusal every morning: a
    // school that does not exist is not a network failure, and scoring it as one
    // would empty the town over a missing building.
    expect(s.tripsCompleted).toBeGreaterThan(0);
    expect(s.tripsRefused).toBe(0);
  });
});

describe("the day is not empty between the peaks", () => {
  // THE POINT OF THE WHOLE FEATURE, as a number.
  //
  // `/test/citizenday` is sampled every in-game hour for a full day and asked
  // one question: is anybody out? Before life stages this board had two spikes
  // and a middle that flatlined, because every resident had the same three
  // hours and a quarter of them had almost nothing to do at all.
  function dayProfile(): number[] {
    const defs = Object.values(citizenday.trains).map<TrainDef>(t => ({
      id: t.id,
      x: t.x,
      y: t.y,
      type: t.type,
      wagonIds: (t.wagons ?? []).map(w => w.id),
    }));
    // A compressed day, said out loud: the shipped 1800s day would make this a
    // half-hour of simulation for one board.
    const secPerDay = 600;
    const game = createGame(
      citizenday.level,
      defs,
      200,
      citizensModeWith({ secPerDay }),
      1,
      citizenday.colors,
      undefined,
      "citizenday"
    );
    // Warm up a day first: day 0 opens at 07:00, so its small hours never happen.
    for (let t = 0; t < secPerDay; t += 0.25) game.advance(0.25);

    const busiestPerHour = new Array<number>(24).fill(0);
    for (let t = 0; t < secPerDay; t += 0.25) {
      game.advance(0.25);
      const hour = Math.floor(Number(game.citizenStats.clock.slice(0, 2)));
      busiestPerHour[hour] = Math.max(busiestPerHour[hour], game.citizenStats.travelling);
    }
    return busiestPerHour;
  }

  it("has somebody travelling in every waking hour", () => {
    const profile = dayProfile();
    const waking = profile.slice(6, 22);
    const quietest = Math.min(...waking);
    const busiest = Math.max(...waking);
    expect(busiest).toBeGreaterThan(4);
    // Not "somebody happened to be out" — the quietest daylight hour carries a
    // real share of the busiest. A board that spikes twice and flatlines fails
    // here long before it fails the >0 check.
    expect(quietest).toBeGreaterThan(0);
    expect(quietest / busiest).toBeGreaterThan(0.15);
  });

  it("puts the school run and the trades round in the middle of the day", () => {
    // The midday hours specifically — 10:00 to 15:00, which is exactly the
    // stretch the old all-commuter board left empty.
    const midday = dayProfile().slice(10, 15);
    expect(Math.min(...midday)).toBeGreaterThan(0);
  });
});
