import { describe, it, expect } from "vitest";
import {
  createSimulation,
  SimEvent,
  STATION_DWELL_SEC,
  PLATFORM_CENTRE_PROGRESS,
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

// Run until the named train opens its doors (or give up).
function runToDwell(
  sim: ReturnType<typeof createSimulation>,
  id: string,
  limit = 20
): void {
  const dt = 0.05;
  let elapsed = 0;
  while (sim.trainState(id) !== "dwelling" && elapsed < limit) {
    sim.step(dt);
    elapsed += dt;
  }
}

describe("station dwell", () => {
  it("brakes to a stand with its CARRIAGE at the platform, dwells, then continues to its depot", () => {
    const sim = createSimulation({
      level: stationLine(),
      trains: [TRAIN],
      depotColors: { "0,0": "blue", "4,0": "green" },
    });

    // Step until the train is dwelling. A platform is one tile long and a train
    // is longer, so drawing up puts the CARRIAGE beside the slab and takes the
    // loco past the far end of it — onto 3,0.
    runToDwell(sim, "t1");
    expect(sim.trainState("t1")).toBe("dwelling");
    expect(sim.trainTileId("t1")).toBe("3,0");
    expect(sim.trainVelocity("t1")).toBe(0);

    // The wagon (unit 1) is the one at the platform, centred on it.
    const units = sim.sampleTrain("t1");
    const wagon = units[1];
    expect(wagon.front.coord).toEqual({ x: 2, y: 0 });
    expect(wagon.rear.coord).toEqual({ x: 2, y: 0 });
    const wagonMiddle = (wagon.front.t + wagon.rear.t) / 2;
    expect(wagonMiddle).toBeCloseTo(PLATFORM_CENTRE_PROGRESS, 2);

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

  it("bounds the reserved block at the station: nothing beyond it is claimed on the approach", () => {
    const sim = createSimulation({
      level: stationLine(),
      trains: [TRAIN],
      depotColors: { "0,0": "blue", "4,0": "green" },
    });
    // Drive up to the platform. While the train is still short of the station
    // the tiles beyond it must never be reserved — a station is a block
    // boundary, so the approach claims at most up to 2,0. Only when the train
    // actually draws up (the loco crosses onto 3,0) does it claim onward.
    const dt = 0.05;
    let elapsed = 0;
    while (sim.trainState("t1") !== "dwelling" && elapsed < 20) {
      sim.step(dt);
      if (sim.trainTileId("t1") !== "3,0") {
        expect(sim.reservedBy("3,0")).toBeUndefined();
        expect(sim.reservedBy("4,0")).toBeUndefined();
      }
      elapsed += dt;
    }
    expect(sim.trainState("t1")).toBe("dwelling");
  });

  it("serves a platform at the buffers, where there is nowhere to draw up to", () => {
    // depot → station → nothing. The stop line lies past the end of the metals,
    // so the train can never align; it must still open its doors, or a terminus
    // platform would be a station no service ever calls at.
    const sim = createSimulation({
      level: {
        "0,0": expandKind("depot", 1),
        "1,0": expandKind("station", 1),
      },
      trains: [TRAIN],
      depotColors: { "0,0": "blue" },
      stationDemand: { "1,0": { intervalSec: 100, max: 8, initial: 2 } },
    });
    runToDwell(sim, "t1");
    expect(sim.trainState("t1")).toBe("dwelling");
    expect(sim.trainTileId("t1")).toBe("1,0");
    // It stopped at the buffers, not half a tile short of them.
    expect(sim.trainProgress("t1")).toBeCloseTo(1, 5);
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
      // TWO stations: a passenger asks for somewhere, so a board with only
      // one platform is a board nobody travels from.
      level: {
        "0,0": expandKind("depot", 1),
        "1,0": expandKind("station", 1),
        "2,0": expandKind("straight", 1),
        "3,0": expandKind("station", 1),
        "4,0": expandKind("depot", 3),
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
      level: {
        "1,0": expandKind("station", 1),
        "2,0": expandKind("straight", 1),
        "3,0": expandKind("station", 1),
      },
      trains: [],
    });
    expect(sim.addStationPassengers("1,0", 99)).toBe(STATION_QUEUE_HARD_CAP);
    expect(sim.stationQueue("1,0")).toBe(STATION_QUEUE_HARD_CAP);
  });
});

// PHASE 6: passengers ask for a DESTINATION. This is what makes the shape of a
// line matter — before it, any train going anywhere satisfied everyone.
describe("station passengers with destinations", () => {
  // A ring with three platforms, so a line can serve some and miss others.
  //   1,0 ── 2,0(A) ── 3,0
  //    │                │
  //   1,1              3,1(B)
  //    │                │
  //   1,2 ── 2,2(C) ── 3,2
  function ring(): Level {
    const stationEW = () => ({
      connections: [[Position.Left, Position.Right]] as [Position, Position][],
      role: "station" as const,
    });
    return {
      "1,0": expandKind("curve", 1),
      "2,0": stationEW(),
      "3,0": expandKind("curve", 2),
      "1,1": expandKind("straight", 0),
      "3,1": {
        connections: [[Position.Top, Position.Bottom]] as [Position, Position][],
        role: "station" as const,
      },
      "1,2": expandKind("curve", 0),
      "2,2": stationEW(),
      "3,2": expandKind("curve", 3),
    };
  }

  const riderTrain = (line: string[], capacity = 10) => ({
    ...TRAIN,
    coord: { x: 2, y: 2 },
    entryPort: Position.Left,
    wagonCount: 2,
    capacity,
    line,
  });

  it("only lets people on a train whose line calls where they are going", () => {
    const sim = createSimulation({
      level: ring(),
      // A line that serves C and A — but NOT B.
      trains: [riderTrain(["2,2", "2,0"])],
      // Everyone at C is sent round the ring in turn: A, B, A, B…
      stationDemand: { "2,2": { intervalSec: 100, max: 10, initial: 4 } },
    });
    // Of the four waiting, the ones bound for B must be left behind.
    const before = sim.stationWaiting("2,2");
    expect(before).toContain("2,0");
    expect(before).toContain("3,1");

    run(sim, 40);
    const left = sim.stationWaiting("2,2");
    // Nobody bound for A is still standing there…
    expect(left).not.toContain("2,0");
    // …and everybody bound for B is, because no service takes them.
    expect(left.filter(d => d === "3,1").length).toBe(
      before.filter(d => d === "3,1").length
    );
  });

  it("carries a rider PAST an intermediate stop to the one they asked for", () => {
    const sim = createSimulation({
      level: ring(),
      // The line calls at C, then A, then B: someone at C bound for B must
      // stay aboard through the call at A.
      trains: [riderTrain(["2,2", "2,0", "3,1"])],
      stationDemand: { "2,2": { intervalSec: 100, max: 10, initial: 4 } },
    });
    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t += 0.05) events.push(...sim.step(0.05));

    const calls = events.filter(
      (e): e is Extract<SimEvent, { type: "dwell" }> => e.type === "dwell"
    );
    const atA = calls.find(c => c.tileId === "2,0");
    const atB = calls.find(c => c.tileId === "3,1");
    // Someone got off at each — they were carried to what they asked for, not
    // dumped at the first stop.
    expect(atA?.alighted ?? 0).toBeGreaterThan(0);
    expect(atB?.alighted ?? 0).toBeGreaterThan(0);
    // And the platform they left is empty of both destinations by the end.
    expect(sim.stationWaiting("2,2")).toEqual([]);
  });

  it("never sends anyone somewhere the railway cannot reach", () => {
    const level: Level = {
      ...ring(),
      // An island platform, joined to nothing.
      "9,9": {
        connections: [[Position.Left, Position.Right]],
        role: "station",
      },
    };
    const sim = createSimulation({
      level,
      trains: [],
      stationDemand: { "2,2": { intervalSec: 1, max: 20, initial: 0 } },
    });
    run(sim, 40);
    expect(sim.stationQueue("2,2")).toBeGreaterThan(0);
    expect(sim.stationWaiting("2,2")).not.toContain("9,9");
  });

  it("a train with NO line still runs the old one-hop service", () => {
    const sim = createSimulation({
      level: ring(),
      trains: [{ ...riderTrain([]), line: undefined }],
      stationDemand: { "2,2": { intervalSec: 100, max: 10, initial: 4 } },
    });
    const events: SimEvent[] = [];
    for (let t = 0; t < 60; t += 0.05) events.push(...sim.step(0.05));
    const calls = events.filter(
      (e): e is Extract<SimEvent, { type: "dwell" }> => e.type === "dwell"
    );
    // It took people at C…
    expect(calls[0]?.boarded ?? 0).toBeGreaterThan(0);
    // …and set them all down at the very next call, wherever that was.
    expect(calls[1]?.alighted ?? 0).toBe(calls[0]?.boarded ?? 0);
  });
});
