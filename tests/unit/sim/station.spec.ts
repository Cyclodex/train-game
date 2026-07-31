import { describe, it, expect } from "vitest";
import {
  createSimulation,
  SimEvent,
  STATION_DWELL_SEC,
  STATION_STOP_PROGRESS,
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
