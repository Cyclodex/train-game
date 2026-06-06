import { describe, it, expect } from "vitest";
import {
  timeAttackMode,
  scheduleFor,
  createScheduleSpawner,
} from "@/modes/time-attack";
import { createObjectiveTracker, emptyObservation } from "@/sim/objectives";
import { TrainDef } from "@/game";
import { timeattack } from "@/levels/test/scenarios/timeattack";

function ctx() {
  const trains: TrainDef[] = Object.values(timeattack.trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
    spawnAtSec: t.spawnAtSec,
  }));
  return { level: timeattack.level, trains, levelId: "timeattack" };
}

describe("time attack mode", () => {
  it("enables dispatch controls only (no build, no crossing gate)", () => {
    expect(timeAttackMode.controls).toEqual({
      switches: true,
      signalHolds: true,
      crossingGate: false,
      build: false,
    });
  });

  it("requires delivering every train and seeds the init-active count", () => {
    const setup = timeAttackMode.setup(ctx());
    expect(setup.objective.deliveriesRequired).toBe(setup.trains.length);
    // Only t1 has no spawnAtSec → exactly one init-active train.
    expect(setup.objective.initialActiveTrains).toBe(1);
    expect(setup.objective.fail?.maxActiveTrains).toBeGreaterThan(0);
  });

  it("offers speedrun, free-flowing and perfect-colours stars", () => {
    const setup = timeAttackMode.setup(ctx());
    const ids = (setup.objective.stars ?? []).map(s => s.id).sort();
    expect(ids).toEqual(["no-overflow", "perfect-colours", "speedrun"]);
  });

  it("provides a spawner (Time Attack is a scheduled mode)", () => {
    expect(timeAttackMode.createSpawner).toBeDefined();
    const setup = timeAttackMode.setup(ctx());
    expect(timeAttackMode.createSpawner!(setup)).toBeDefined();
  });

  it("hud shows the full objective UI", () => {
    expect(timeAttackMode.hud).toEqual({
      deliveries: true,
      timer: true,
      stars: true,
      startOverlay: true,
      endOverlay: true,
    });
  });
});

describe("time attack schedule", () => {
  const defs: TrainDef[] = [
    { id: "a", x: 0, y: 0, type: "people", wagonIds: [] }, // init (no spawnAtSec)
    { id: "b", x: 0, y: 1, type: "people", wagonIds: [], spawnAtSec: 3 },
    { id: "c", x: 0, y: 2, type: "fraight", wagonIds: [], spawnAtSec: 6 },
  ];

  it("derives the schedule from scheduled trains only, sorted by time", () => {
    const sched = scheduleFor(defs);
    expect(sched.map(e => e.def.id)).toEqual(["b", "c"]); // "a" is an init train
    expect(sched.map(e => e.atSec)).toEqual([3, 6]);
  });

  it("releases each train once its atSec is reached, exactly once", () => {
    const spawner = createScheduleSpawner(scheduleFor(defs));
    const released: string[] = [];
    // Drive 1s ticks for 8s.
    for (let i = 0; i < 8; i++) {
      for (const d of spawner.step(1)) released.push(d.id);
    }
    expect(released).toEqual(["b", "c"]);
  });

  it("is deterministic: same schedule + same dt sequence → same releases", () => {
    const run = () => {
      const s = createScheduleSpawner(scheduleFor(defs));
      const out: Array<[number, string[]]> = [];
      let t = 0;
      for (let i = 0; i < 14; i++) {
        t += 0.5;
        out.push([t, s.step(0.5).map(d => d.id)]);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it("re-arms from the start after reset()", () => {
    const spawner = createScheduleSpawner(scheduleFor(defs));
    for (let i = 0; i < 8; i++) spawner.step(1); // exhaust the schedule
    expect(spawner.step(1)).toEqual([]); // nothing left
    spawner.reset();
    const released: string[] = [];
    for (let i = 0; i < 8; i++) {
      for (const d of spawner.step(1)) released.push(d.id);
    }
    expect(released).toEqual(["b", "c"]); // full schedule again
  });
});

describe("time attack overflow / win", () => {
  function tracker() {
    return createObjectiveTracker({
      deliveriesRequired: 3,
      initialActiveTrains: 1,
      fail: { maxActiveTrains: 2 },
    });
  }

  it("loses when too many trains are active at once", () => {
    const t = tracker();
    t.start();
    // init=1; spawn two more without delivering → active climbs to 3 > cap(2).
    t.observe({ ...emptyObservation, spawnedDelta: 1 }, 1);
    expect(t.state().phase).toBe("playing"); // active = 2, at the cap
    t.observe({ ...emptyObservation, spawnedDelta: 1 }, 1);
    const st = t.state();
    expect(st.phase).toBe("lost");
    expect(st.lostReason).toMatch(/backed up/i);
  });

  it("wins when every train is delivered before overflowing", () => {
    const t = tracker();
    t.start();
    // Spawn one (active=2), deliver it (active=1), spawn the next (active=2),
    // deliver both remaining → 3 delivered, never exceeding the cap.
    t.observe({ ...emptyObservation, spawnedDelta: 1, deliveredDelta: 1 }, 1);
    t.observe({ ...emptyObservation, spawnedDelta: 1, deliveredDelta: 1 }, 1);
    t.observe({ ...emptyObservation, deliveredDelta: 1 }, 1);
    expect(t.state().phase).toBe("won");
    expect(t.state().counters.delivered).toBe(3);
  });

  it("tracks the peak backlog for the free-flowing star", () => {
    const t = tracker();
    t.start();
    t.observe({ ...emptyObservation, spawnedDelta: 1 }, 1); // active 2
    t.observe({ ...emptyObservation, deliveredDelta: 2 }, 1); // active 0
    expect(t.state().counters.peakActive).toBe(2);
    expect(t.state().counters.active).toBe(0);
  });
});
