import { describe, it, expect } from "vitest";
import { createSimulation } from "@/sim/simulation";
import { LevelDefinition, Position } from "@/types";

function corridor(n: number): LevelDefinition {
  const lvl: LevelDefinition = {};
  for (let x = 0; x < n; x++) {
    lvl[`${x},0`] = { x, y: 0, component: "TileStraight", rotation: 1 };
  }
  return lvl;
}

describe("simulation movement", () => {
  it("advances a train tile by tile along a corridor", () => {
    const sim = createSimulation({
      level: corridor(3),
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1, // tiles per second
        },
      ],
    });

    expect(sim.trainTileId("t1")).toBe("0,0");
    sim.step(1);
    expect(sim.trainTileId("t1")).toBe("1,0");
    sim.step(1);
    expect(sim.trainTileId("t1")).toBe("2,0");
  });

  it("exposes fractional progress within the current tile", () => {
    const sim = createSimulation({
      level: corridor(3),
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
      ],
    });
    sim.step(0.5);
    expect(sim.trainTileId("t1")).toBe("0,0");
    expect(sim.trainProgress("t1")).toBeCloseTo(0.5, 5);
  });
});

describe("simulation body sampling", () => {
  it("samples the loco and wagons trailing along the recent path", () => {
    const sim = createSimulation({
      level: corridor(6),
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 2,
          speed: 1,
        },
      ],
    });
    for (let i = 0; i < 6; i++) sim.step(0.5); // ~3 tiles along

    const body = sim.sampleTrain("t1");
    expect(body).toHaveLength(3); // loco + 2 wagons
    const x = (u: { coord: { x: number } }) => u.coord.x;
    // Loco leads; each wagon trails behind the previous one.
    expect(x(body[0])).toBeGreaterThanOrEqual(x(body[1]));
    expect(x(body[1])).toBeGreaterThanOrEqual(x(body[2]));
    // The trailing wagon is at least one tile behind the loco.
    expect(x(body[0]) - x(body[2])).toBeGreaterThanOrEqual(1);
  });
});

describe("simulation occupancy / collisions", () => {
  it("never lets a train enter a tile occupied by another train", () => {
    const sim = createSimulation({
      level: corridor(3),
      trains: [
        {
          id: "lead",
          coord: { x: 2, y: 0 }, // last tile; will hold at the map edge
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
        {
          id: "follow",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "blue",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
      ],
    });

    for (let i = 0; i < 10; i++) sim.step(0.5);

    expect(sim.trainTileId("lead")).toBe("2,0");
    // follow must stop on tile 1 and never reach lead's tile 2.
    expect(sim.trainTileId("follow")).toBe("1,0");
  });
});

describe("simulation traffic signals", () => {
  it("never crosses a red signal, and proceeds once it turns green", () => {
    const signals: Record<string, "red" | "green"> = { "1,0:1": "red" }; // tile 1, exit Right
    const sim = createSimulation({
      level: corridor(3),
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
      ],
      getSignal: (coordId, exitPort) => signals[`${coordId}:${exitPort}`],
    });

    // While red, the train must reach tile 1 and never pass onto tile 2.
    for (let i = 0; i < 20; i++) {
      sim.step(0.5);
      expect(sim.trainTileId("t1")).not.toBe("2,0");
    }
    expect(sim.trainTileId("t1")).toBe("1,0");

    // Turn the signal green: the train resumes onto tile 2.
    signals["1,0:1"] = "green";
    for (let i = 0; i < 5; i++) sim.step(0.5);
    expect(sim.trainTileId("t1")).toBe("2,0");
  });
});

describe("simulation depots", () => {
  const depotLevel: LevelDefinition = {
    "0,0": { x: 0, y: 0, component: "TileStraight", rotation: 1 },
    "1,0": { x: 1, y: 0, component: "TileDepot", rotation: 3 }, // opening on the Left
  };

  it("parks and emits a delivery when a train reaches a matching depot", () => {
    const sim = createSimulation({
      level: depotLevel,
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
      ],
      depotColors: { "1,0": "red" },
    });

    const arrivals: any[] = [];
    for (let i = 0; i < 20; i++) {
      for (const e of sim.step(0.5)) if (e.type === "arrived") arrivals.push(e);
    }

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]).toMatchObject({
      trainId: "t1",
      tileId: "1,0",
      matched: true,
    });
    expect(sim.trainState("t1")).toBe("parked");
  });

  it("bounces a train back out of a non-matching depot", () => {
    const sim = createSimulation({
      level: depotLevel,
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "blue",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
      ],
      depotColors: { "1,0": "red" },
    });

    const arrivals: any[] = [];
    let reachedDepot = false;
    for (let i = 0; i < 12; i++) {
      for (const e of sim.step(0.5)) if (e.type === "arrived") arrivals.push(e);
      if (sim.trainTileId("t1") === "1,0") reachedDepot = true;
    }

    expect(reachedDepot).toBe(true);
    // A non-matching arrival was reported, and the train did not park...
    expect(arrivals.some(e => e.tileId === "1,0" && e.matched === false)).toBe(
      true
    );
    expect(sim.trainState("t1")).not.toBe("parked");
    // ...it bounced back out toward tile 0.
    expect(sim.trainTileId("t1")).toBe("0,0");
  });
});
