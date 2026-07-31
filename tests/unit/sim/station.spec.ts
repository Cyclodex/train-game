import { describe, it, expect } from "vitest";
import {
  createSimulation,
  SimEvent,
  STATION_DWELL_SEC,
  STATION_STOP_PROGRESS,
  STATION_QUEUE_HARD_CAP,
} from "@/sim/simulation";
import { Position } from "@/types";
import type { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";

// depot → straight → station → straight → depot, all in a row. The train
// leaves 0,0 heading right and the far depot matches its colour.
function stationLine(): Level {
  return {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("station", 1),
    "3,0": expandKind("straight", 1),
    "4,0": expandKind("depot", 3),
  };
}

const TRAIN = {
  id: "t1",
  coord: { x: 0, y: 0 },
  entryPort: Position.Center,
  color: "green",
  type: "people" as const,
  wagonCount: 1,
  speed: 1,
};

function run(sim: ReturnType<typeof createSimulation>, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  const dt = 0.05;
  for (let t = 0; t < seconds; t += dt) events.push(...sim.step(dt));
  return events;
}

describe("station dwell", () => {
  it("brakes to a stand at the platform, dwells, then continues to its depot", () => {
    const sim = createSimulation({
      level: stationLine(),
      trains: [TRAIN],
      depotColors: { "0,0": "blue", "4,0": "green" },
    });

    // Step until the train is dwelling; it must stop ON the station tile at
    // the platform's stop line.
    const dt = 0.05;
    let elapsed = 0;
    while (sim.trainState("t1") !== "dwelling" && elapsed < 20) {
      sim.step(dt);
      elapsed += dt;
    }
    expect(sim.trainState("t1")).toBe("dwelling");
    expect(sim.trainTileId("t1")).toBe("2,0");
    expect(sim.trainProgress("t1")).toBeCloseTo(STATION_STOP_PROGRESS, 5);
    expect(sim.trainVelocity("t1")).toBe(0);

    // It stays put for the dwell, then pulls away and parks at the far depot.
    const midDwell = sim.step(STATION_DWELL_SEC / 2);
    expect(sim.trainState("t1")).toBe("dwelling");
    expect(midDwell.some(e => e.type === "departed")).toBe(false);

    const rest = run(sim, 20);
    expect(rest.some(e => e.type === "departed")).toBe(true);
    expect(
      rest.some(e => e.type === "arrived" && e.tileId === "4,0" && e.matched)
    ).toBe(true);
    expect(sim.trainState("t1")).toBe("parked");
  });

  it("emits dwell and departed events, in order, for the station tile", () => {
    const sim = createSimulation({
      level: stationLine(),
      trains: [TRAIN],
      depotColors: { "0,0": "blue", "4,0": "green" },
    });
    const events = run(sim, 30);
    const kinds = events
      .filter(e => e.type === "dwell" || e.type === "departed")
      .map(e => `${e.type}@${(e as { tileId: string }).tileId}`);
    expect(kinds).toEqual(["dwell@2,0", "departed@2,0"]);
  });

  it("bounds the reserved block at the station: nothing beyond it is claimed on approach", () => {
    const sim = createSimulation({
      level: stationLine(),
      trains: [TRAIN],
      depotColors: { "0,0": "blue", "4,0": "green" },
    });
    // Drive up to the dwell. At every tick on the way, the tiles BEYOND the
    // station must never be reserved — the station is a block boundary, so the
    // approach claims at most up to 2,0.
    const dt = 0.05;
    let elapsed = 0;
    while (sim.trainState("t1") !== "dwelling" && elapsed < 20) {
      sim.step(dt);
      expect(sim.reservedBy("3,0")).toBeUndefined();
      expect(sim.reservedBy("4,0")).toBeUndefined();
      elapsed += dt;
    }
    expect(sim.trainState("t1")).toBe("dwelling");
  });

  it("holds a following train behind the platform and releases it after the dwell", () => {
    // Two trains on one line: t2 starts a tile ahead on plain track and dwells
    // first; t1 leaves the depot behind it and must queue while t2 stands.
    const sim = createSimulation({
      level: stationLine(),
      trains: [
        { ...TRAIN, speed: 1 },
        {
          ...TRAIN,
          id: "t2",
          coord: { x: 1, y: 0 },
          entryPort: Position.Left,
          speed: 1,
        },
      ],
      depotColors: { "0,0": "blue", "4,0": "green" },
    });

    // t2 (ahead) dwells first; t1 leaves the depot behind it. While t2 stands
    // at the platform, t1 must not enter the station tile.
    const dt = 0.05;
    let elapsed = 0;
    while (sim.trainState("t2") !== "dwelling" && elapsed < 20) {
      sim.step(dt);
      elapsed += dt;
    }
    expect(sim.trainState("t2")).toBe("dwelling");
    expect(sim.trainTileId("t1")).not.toBe("2,0");

    // After the dwell clears, both eventually park at the destination — the
    // follower was held, not deadlocked. (t1 bounces off nothing: one matches,
    // the other bounces home; either way both come to rest.)
    run(sim, 60);
    expect(sim.trainState("t2")).toBe("parked");
    expect(["parked", "running", "dwelling"]).toContain(sim.trainState("t1"));
  });

  it("dwells once per pass, not once per station forever", () => {
    // A train that bounces off a mismatched far depot passes the station again
    // on the way back — and must stop again.
    const sim = createSimulation({
      level: stationLine(),
      trains: [{ ...TRAIN, color: "green" }],
      // Far depot mismatches → bounce → second pass; home depot matches.
      depotColors: { "0,0": "green", "4,0": "red" },
    });
    const events = run(sim, 60);
    const dwells = events.filter(e => e.type === "dwell");
    expect(dwells.length).toBe(2);
    expect(sim.trainState("t1")).toBe("parked");
    expect(sim.trainTileId("t1")).toBe("0,0");
  });
});

describe("station passengers (phase 2)", () => {
  // depot → straight → station A → straight → station B → straight → depot.
  function twoStationLine(): Level {
    return {
      "0,0": expandKind("depot", 1),
      "1,0": expandKind("straight", 1),
      "2,0": expandKind("station", 1),
      "3,0": expandKind("straight", 1),
      "4,0": expandKind("station", 1),
      "5,0": expandKind("straight", 1),
      "6,0": expandKind("depot", 3),
    };
  }

  it("spawns passengers on the schedule and caps the queue at max", () => {
    const sim = createSimulation({
      level: twoStationLine(),
      trains: [],
      stationDemand: { "2,0": { intervalSec: 1, max: 4, initial: 0 } },
    });
    for (let i = 0; i < 5; i++) sim.step(0.5); // 2.5 s → 2 spawns
    expect(sim.stationQueue("2,0")).toBe(2);
    for (let i = 0; i < 40; i++) sim.step(0.5); // far past max
    expect(sim.stationQueue("2,0")).toBe(4);
    expect(sim.stationQueue("4,0")).toBe(0); // no schedule → nobody
  });

  it("boards up to capacity, extends the dwell, and alights one hop later", () => {
    const sim = createSimulation({
      level: twoStationLine(),
      trains: [{ ...TRAIN, wagonCount: 1, capacity: 2 }],
      depotColors: { "0,0": "blue", "6,0": "green" },
      stationDemand: { "2,0": { intervalSec: 100, max: 8, initial: 5 } },
    });
    const events: SimEvent[] = [];
    const dt = 0.05;
    for (let t = 0; t < 60; t += dt) events.push(...sim.step(dt));

    const dwells = events.filter((e): e is Extract<SimEvent, { type: "dwell" }> => e.type === "dwell");
    expect(dwells.length).toBe(2);
    // First call: 2 of the 5 waiting board (capacity), nobody alights.
    expect(dwells[0]).toMatchObject({ tileId: "2,0", boarded: 2, alighted: 0 });
    // Second call: the 2 riders end their hop; the empty platform boards none.
    expect(dwells[1]).toMatchObject({ tileId: "4,0", boarded: 0, alighted: 2 });
    expect(sim.stationQueue("2,0")).toBe(3);
    expect(sim.passengersDelivered()).toBe(2);

    // Boarding stretched the first stop: departure from A came later than the
    // base dwell after the doors opened.
    const times: number[] = [];
    {
      const sim2 = createSimulation({
        level: twoStationLine(),
        trains: [{ ...TRAIN, wagonCount: 1, capacity: 2 }],
        depotColors: { "0,0": "blue", "6,0": "green" },
        stationDemand: { "2,0": { intervalSec: 100, max: 8, initial: 5 } },
      });
      let clock = 0;
      let dwellAt: number | null = null;
      for (let t = 0; t < 60 && times.length === 0; t += dt) {
        for (const e of sim2.step(dt)) {
          if (e.type === "dwell" && e.tileId === "2,0") dwellAt = clock;
          if (e.type === "departed" && e.tileId === "2,0" && dwellAt !== null) {
            times.push(clock - dwellAt);
          }
        }
        clock += dt;
      }
      expect(times[0]).toBeGreaterThan(STATION_DWELL_SEC);
    }
  });

  it("delivers the riders at a matched depot and reports them on the arrival", () => {
    const sim = createSimulation({
      level: twoStationLine(),
      trains: [{ ...TRAIN, wagonCount: 1, capacity: 3 }],
      depotColors: { "0,0": "blue", "6,0": "green" },
      // Only station B has demand, so the riders' next stop is the depot.
      stationDemand: { "4,0": { intervalSec: 100, max: 8, initial: 3 } },
    });
    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t += 0.05) events.push(...sim.step(0.05));
    const arrived = events.find(
      (e): e is Extract<SimEvent, { type: "arrived" }> =>
        e.type === "arrived" && e.tileId === "6,0"
    );
    expect(arrived?.matched).toBe(true);
    expect(arrived?.alighted).toBe(3);
    expect(sim.passengersDelivered()).toBe(3);
  });

  it("gives a fraight train no seats: it calls but boards nobody", () => {
    const sim = createSimulation({
      level: twoStationLine(),
      trains: [{ ...TRAIN, type: "fraight", wagonCount: 2 }],
      depotColors: { "0,0": "blue", "6,0": "green" },
      stationDemand: { "2,0": { intervalSec: 100, max: 8, initial: 5 } },
    });
    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t += 0.05) events.push(...sim.step(0.05));
    const dwellA = events.find(
      (e): e is Extract<SimEvent, { type: "dwell" }> =>
        e.type === "dwell" && e.tileId === "2,0"
    );
    expect(dwellA?.boarded).toBe(0);
    expect(sim.stationQueue("2,0")).toBe(5);
  });
});

describe("addStationPassengers (park & ride injection)", () => {
  it("adds to a station's queue up to its cap and refuses non-stations", () => {
    const sim = createSimulation({
      level: {
        "0,0": expandKind("depot", 1),
        "1,0": expandKind("station", 1),
        "2,0": expandKind("depot", 3),
      },
      trains: [],
      stationDemand: { "1,0": { intervalSec: 1000, max: 3, initial: 0 } },
    });
    expect(sim.addStationPassengers("1,0", 2)).toBe(2);
    expect(sim.stationQueue("1,0")).toBe(2);
    // The platform cap turns the rest away.
    expect(sim.addStationPassengers("1,0", 5)).toBe(1);
    expect(sim.stationQueue("1,0")).toBe(3);
    // Not a station → nobody joins anything.
    expect(sim.addStationPassengers("0,0", 3)).toBe(0);
    expect(sim.addStationPassengers("9,9", 3)).toBe(0);
  });

  it("uses the hard cap for a station with no schedule of its own", () => {
    const sim = createSimulation({
      level: { "1,0": expandKind("station", 1) },
      trains: [],
    });
    expect(sim.addStationPassengers("1,0", 99)).toBe(STATION_QUEUE_HARD_CAP);
    expect(sim.stationQueue("1,0")).toBe(STATION_QUEUE_HARD_CAP);
  });
});
