import { describe, it, expect } from "vitest";
import { createSimulation } from "@/sim/simulation";
import { LevelDefinition, Position, ActiveIntersection } from "@/types";

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

describe("simulation per-unit spacing", () => {
  // Position (in tiles) of a sampled unit centre along a straight corridor,
  // where x maps directly to along-track distance and t is the 0..1 progress
  // within the tile.
  const along = (u: { coord: { x: number }; t: number }) => u.coord.x + u.t;

  it("spaces consecutive units by half each length + coupling gap", () => {
    const lengthsLoco = 0.5; // loco half a tile
    const lengthsWagon = 0.4; // wagons shorter than the loco
    const coupling = 0.05;
    const sim = createSimulation({
      level: corridor(8),
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "fraight",
          wagonCount: 2,
          speed: 1,
          unitLengths: [lengthsLoco, lengthsWagon, lengthsWagon],
          coupling,
        },
      ],
    });
    for (let i = 0; i < 10; i++) sim.step(0.5); // well along the corridor

    const body = sim.sampleTrain("t1");
    expect(body).toHaveLength(3);

    // loco-center -> wagon1-center = half loco + gap + half wagon
    const d01 = along(body[0]) - along(body[1]);
    expect(d01).toBeCloseTo(lengthsLoco / 2 + coupling + lengthsWagon / 2, 5);
    // wagon1-center -> wagon2-center = half wagon + gap + half wagon
    const d12 = along(body[1]) - along(body[2]);
    expect(d12).toBeCloseTo(lengthsWagon / 2 + coupling + lengthsWagon / 2, 5);
  });

  it("reports a body footprint equal to the sum of unit lengths plus gaps", () => {
    const sim = createSimulation({
      level: corridor(8),
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "fraight",
          wagonCount: 3,
          speed: 1,
          unitLengths: [0.5, 0.4, 0.4, 0.4],
          coupling: 0.05,
        },
      ],
    });
    // 4 units, 3 gaps between them.
    const expected = 0.5 + 0.4 * 3 + 0.05 * 3;
    expect(sim.trains["t1"].bodyLength).toBeCloseTo(expected, 5);
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
      signalTiles: ["1,0"], // a signal so the block ahead is 1,0 -> 2,0
    });

    for (let i = 0; i < 10; i++) sim.step(0.5);

    expect(sim.trainTileId("lead")).toBe("2,0");
    // follow holds at the signal (1,0) — it can't reserve the block holding lead.
    expect(sim.trainTileId("follow")).toBe("1,0");
  });
});

describe("simulation manual signal hold", () => {
  it("holds a train at a signal and releases it when cleared", () => {
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
      signalTiles: ["1,0"],
    });
    sim.toggleHold("1,0", Position.Right); // force the signal at 1,0 to Stop

    // The train reaches the signal and never crosses it while held.
    for (let i = 0; i < 20; i++) {
      sim.step(0.5);
      expect(sim.trainTileId("t1")).not.toBe("2,0");
    }
    expect(sim.trainTileId("t1")).toBe("1,0");
    expect(sim.signalAspect("1,0", Position.Right)).toBe("stop");

    // Release the hold: it proceeds.
    sim.toggleHold("1,0", Position.Right);
    for (let i = 0; i < 6; i++) sim.step(0.5);
    expect(sim.trainTileId("t1")).toBe("2,0");
  });
});

describe("simulation path reservation at a junction", () => {
  // A + crossing: train "a" goes Top->Bottom, train "b" goes Left->Right, both
  // through the intersection 1,1. Their paths cross on that one tile.
  const crossLevel: LevelDefinition = {
    "1,0": { x: 1, y: 0, component: "TileStraight", rotation: 0 }, // a's signal
    "1,1": { x: 1, y: 1, component: "TileIntersectionComplete", rotation: 0 },
    "1,2": { x: 1, y: 2, component: "TileStraight", rotation: 0 },
    "0,1": { x: 0, y: 1, component: "TileStraight", rotation: 1 }, // b's signal
    "2,1": { x: 2, y: 1, component: "TileStraight", rotation: 1 },
  };
  // Intersection goes straight for both approaches.
  const getSwitch = (coordId: string, entryPort: Position) => {
    if (coordId !== "1,1") return undefined;
    return ActiveIntersection.Straight;
  };

  it("lets one train reserve the crossing while the other waits, never both on it", () => {
    const sim = createSimulation({
      level: crossLevel,
      getSwitch,
      signalTiles: ["1,0", "0,1"],
      trains: [
        {
          id: "a",
          coord: { x: 1, y: 0 },
          entryPort: Position.Top,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
        {
          id: "b",
          coord: { x: 0, y: 1 },
          entryPort: Position.Left,
          color: "blue",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
      ],
    });

    let bothOnCrossingEver = false;
    const aVisited = { v: false };
    const bVisited = { v: false };
    for (let i = 0; i < 40; i++) {
      sim.step(0.25);
      const aOn = sim.trainTileId("a") === "1,1";
      const bOn = sim.trainTileId("b") === "1,1";
      if (aOn && bOn) bothOnCrossingEver = true;
      if (aOn) aVisited.v = true;
      if (bOn) bVisited.v = true;
    }

    expect(bothOnCrossingEver).toBe(false); // never crossing paths at once
    expect(aVisited.v).toBe(true); // both trains do get through
    expect(bVisited.v).toBe(true);
  });
});

describe("simulation signal aspect", () => {
  it("shows stop when the block ahead is occupied, proceed when free", () => {
    const sim = createSimulation({
      level: corridor(3),
      signalTiles: ["1,0"],
      trains: [
        {
          id: "blocker",
          coord: { x: 2, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
      ],
    });
    // 'blocker' sits on 2,0 (the block beyond the 1,0 signal, heading Right).
    sim.step(0); // settle
    expect(sim.signalAspect("1,0", Position.Right)).toBe("stop");
    // The opposite direction's block (toward 0,0) is free.
    expect(sim.signalAspect("1,0", Position.Left)).toBe("proceed");
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

  it("glides the whole body into the depot, freeing the approach tile", () => {
    // A corridor 0,0..2,0 leading into a Left-opening depot at 3,0. The train is
    // long enough (loco + 2 wagons => bodyLength 1.5) that, parked with the loco
    // at the depot centre, its tail would otherwise sit on the approach tile.
    const level: LevelDefinition = {
      "0,0": { x: 0, y: 0, component: "TileStraight", rotation: 1 },
      "1,0": { x: 1, y: 0, component: "TileStraight", rotation: 1 },
      "2,0": { x: 2, y: 0, component: "TileStraight", rotation: 1 },
      "3,0": { x: 3, y: 0, component: "TileDepot", rotation: 3 },
    };
    const sim = createSimulation({
      level,
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 2,
          unitLengths: [0.5, 0.5, 0.5],
          speed: 1,
        },
      ],
      depotColors: { "3,0": "red" },
    });

    const states = new Set<string>();
    for (let i = 0; i < 40; i++) {
      sim.step(0.25);
      states.add(sim.trainState("t1"));
    }

    // It went through the transient glide, not straight to a dead stop.
    expect(states.has("parking")).toBe(true);
    expect(sim.trainState("t1")).toBe("parked");
    // Once fully parked the body is inside the depot only; the tile in front of
    // the depot is free for the next train.
    expect(sim.occupiedBy("3,0")).toBe("t1");
    expect(sim.occupiedBy("2,0")).toBeUndefined();
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

describe("simulation manual force-proceed (force green) override", () => {
  // A two-train standoff: 'lead' occupies 2,0; 'follow' is held at the 1,0
  // signal because the block 1,0->2,0 is occupied by lead. Forcing 1,0 green
  // should let follow advance up TO the signal tile boundary, but the occupancy
  // backstop must still stop it from entering 2,0 while lead sits on it.
  function standoff() {
    return createSimulation({
      level: corridor(4),
      signalTiles: ["1,0"],
      trains: [
        {
          id: "lead",
          coord: { x: 2, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 0, // sits still on 2,0
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
  }

  it("reports proceed when a signal is forced green even if the block is reserved", () => {
    const sim = standoff();
    // Settle: lead reserves/occupies its block; follow reaches 1,0 and holds.
    for (let i = 0; i < 8; i++) sim.step(0.5);
    expect(sim.signalAspect("1,0", Position.Right)).toBe("stop");

    sim.forceProceed("1,0", Position.Right);
    expect(sim.isProceedForced("1,0", Position.Right)).toBe(true);
    expect(sim.signalAspect("1,0", Position.Right)).toBe("proceed");
  });

  it("force green never lets a train enter a tile physically occupied by another", () => {
    const sim = standoff();
    for (let i = 0; i < 8; i++) sim.step(0.5);
    sim.forceProceed("1,0", Position.Right);
    // Even forced green, follow must not climb onto 2,0 while lead is there.
    for (let i = 0; i < 20; i++) {
      sim.step(0.5);
      expect(sim.trainTileId("follow")).not.toBe("2,0");
    }
    expect(sim.trainTileId("follow")).toBe("1,0");
  });

  it("force green overrides a manual stop hold and pushes the train past the signal", () => {
    // A train is held at the 1,0 signal by a manual stop hold. Force-green is
    // mutually exclusive with the hold, so applying it clears the hold and the
    // train proceeds past the signal into the (free) block ahead.
    const sim = createSimulation({
      level: corridor(5),
      signalTiles: ["1,0", "3,0"],
      trains: [
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
    sim.toggleHold("1,0", Position.Right); // start blocked at 1,0
    for (let i = 0; i < 8; i++) sim.step(0.5);
    expect(sim.trainTileId("follow")).toBe("1,0");

    // Force green: this is mutually exclusive with the hold, so it overrides it.
    sim.forceProceed("1,0", Position.Right);
    expect(sim.isHeld("1,0", Position.Right)).toBe(false);
    for (let i = 0; i < 4; i++) sim.step(0.5);
    // Forcing green released the hold: it advanced past the 1,0 signal.
    expect(["0,0", "1,0"]).not.toContain(sim.trainTileId("follow"));
  });

  it("toggling force-green twice returns to auto", () => {
    const sim = standoff();
    sim.forceProceed("1,0", Position.Right);
    expect(sim.isProceedForced("1,0", Position.Right)).toBe(true);
    sim.forceProceed("1,0", Position.Right);
    expect(sim.isProceedForced("1,0", Position.Right)).toBe(false);
  });
});

describe("simulation re-evaluates a blocked train when a switch changes", () => {
  // Intersection at 1,1. Train t1 approaches from the Top (signal at 1,0).
  //   switch arm Straight: Top -> Bottom -> tile 1,2 (we block this with a
  //                        stationary train sitting on 1,2)
  //   switch arm Right:    Top -> Left  -> tile 0,1 (free)
  // With the switch on Straight the route ahead is occupied, so t1 holds at its
  // signal. Flipping the switch to Right opens a free path; t1 must re-evaluate
  // and proceed without being commanded again.
  const junctionLevel: LevelDefinition = {
    "1,0": { x: 1, y: 0, component: "TileStraight", rotation: 0 }, // t1 signal
    "1,1": { x: 1, y: 1, component: "TileIntersectionComplete", rotation: 0 },
    "1,2": { x: 1, y: 2, component: "TileStraight", rotation: 0 }, // blocked branch
    "0,1": { x: 0, y: 1, component: "TileStraight", rotation: 1 }, // free branch
  };

  function makeJunctionSim(arm: { value: ActiveIntersection }) {
    return createSimulation({
      level: junctionLevel,
      signalTiles: ["1,0"],
      getSwitch: (coordId) => (coordId === "1,1" ? arm.value : undefined),
      trains: [
        {
          id: "t1",
          coord: { x: 1, y: 0 },
          entryPort: Position.Top,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
        {
          id: "blocker",
          coord: { x: 1, y: 2 }, // parked on the Straight branch
          entryPort: Position.Top,
          color: "blue",
          type: "people",
          wagonCount: 0,
          speed: 0,
        },
      ],
    });
  }

  it("a train held at a red signal proceeds after a switch opens a free path", () => {
    const arm = { value: ActiveIntersection.Straight };
    const sim = makeJunctionSim(arm);

    // t1 holds at its signal: the Straight branch (1,2) is occupied by blocker.
    for (let i = 0; i < 10; i++) sim.step(0.5);
    expect(sim.trainTileId("t1")).toBe("1,0");
    expect(sim.signalAspect("1,0", Position.Bottom)).toBe("stop");

    // Flip the switch to Right -> path Top->Left->0,1 is free.
    arm.value = ActiveIntersection.Right;
    // The signal aspect must recompute against the new switch state.
    expect(sim.signalAspect("1,0", Position.Bottom)).toBe("proceed");

    // And the train must re-evaluate and actually move onto the junction/branch.
    for (let i = 0; i < 10; i++) sim.step(0.5);
    expect(sim.trainTileId("t1")).not.toBe("1,0");
  });

  it("a train that already reserved a block must not drive onto foreign reserved track when a switch is flipped mid-block", () => {
    // t1 reserves Top->Straight->1,2 (free at reservation time, blocker has
    // speed 0 but sits OFF this branch). Once t1 has committed and is partway
    // through the junction, flip the switch to Right so live traverse() would
    // send it to 0,1 instead — a tile reserved/occupied by another train. The
    // safety invariant: t1 must never end up on a tile occupied by another train.
    const lvl: LevelDefinition = {
      "1,0": { x: 1, y: 0, component: "TileStraight", rotation: 0 },
      "1,1": { x: 1, y: 1, component: "TileIntersectionComplete", rotation: 0 },
      "1,2": { x: 1, y: 2, component: "TileStraight", rotation: 0 }, // straight branch (free)
      "0,1": { x: 0, y: 1, component: "TileStraight", rotation: 1 }, // right branch (occupied)
    };
    const arm = { value: ActiveIntersection.Straight };
    const sim = createSimulation({
      level: lvl,
      signalTiles: ["1,0"],
      getSwitch: (coordId) => (coordId === "1,1" ? arm.value : undefined),
      trains: [
        {
          id: "t1",
          coord: { x: 1, y: 0 },
          entryPort: Position.Top,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
        {
          id: "squatter",
          coord: { x: 0, y: 1 }, // permanently occupies the Right branch
          entryPort: Position.Left,
          color: "blue",
          type: "people",
          wagonCount: 0,
          speed: 0,
        },
      ],
    });

    // Let t1 reserve the Straight block and roll onto the junction tile.
    let flipped = false;
    for (let i = 0; i < 30; i++) {
      sim.step(0.1);
      // The instant t1 is on the junction, flip the switch toward the occupied
      // branch. A correct sim must not let it climb onto 0,1.
      if (!flipped && sim.trainTileId("t1") === "1,1") {
        arm.value = ActiveIntersection.Right;
        flipped = true;
      }
      // INVARIANT: t1 never shares a tile with the squatter.
      expect(sim.trainTileId("t1")).not.toBe("0,1");
    }
  });

  it("the held signal aspect and a held train both react to a switch that re-blocks the path", () => {
    // Inverse direction: start on the free branch (Right -> 0,1 free), train
    // proceeds; then flip to the Straight branch which is occupied. The aspect
    // must flip to stop. This guards that aspect() reads the switch live in BOTH
    // directions, not just from blocked->free.
    const lvl: LevelDefinition = {
      "1,0": { x: 1, y: 0, component: "TileStraight", rotation: 0 },
      "1,1": { x: 1, y: 1, component: "TileIntersectionComplete", rotation: 0 },
      "1,2": { x: 1, y: 2, component: "TileStraight", rotation: 0 }, // straight branch (occupied)
      "0,1": { x: 0, y: 1, component: "TileStraight", rotation: 1 }, // right branch (free)
    };
    const arm = { value: ActiveIntersection.Right }; // free branch first
    const sim = createSimulation({
      level: lvl,
      signalTiles: ["1,0"],
      getSwitch: (coordId) => (coordId === "1,1" ? arm.value : undefined),
      trains: [
        {
          id: "t1",
          coord: { x: 1, y: 0 },
          entryPort: Position.Top,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
        {
          id: "blocker",
          coord: { x: 1, y: 2 },
          entryPort: Position.Top,
          color: "blue",
          type: "people",
          wagonCount: 0,
          speed: 0,
        },
      ],
    });
    sim.step(0);
    expect(sim.signalAspect("1,0", Position.Bottom)).toBe("proceed");
    arm.value = ActiveIntersection.Straight; // now points at the occupied branch
    expect(sim.signalAspect("1,0", Position.Bottom)).toBe("stop");
  });

  it("a held train is not permanently stuck after a switch frees an alternate path (liveness)", () => {
    // Both onward branches start blocked; the train holds at its signal. Free
    // one branch by flipping the switch and confirm it actually clears the
    // signal tile within a bounded number of ticks (no permanent deadlock).
    const lvl: LevelDefinition = {
      "1,0": { x: 1, y: 0, component: "TileStraight", rotation: 0 },
      "1,1": { x: 1, y: 1, component: "TileIntersectionComplete", rotation: 0 },
      "1,2": { x: 1, y: 2, component: "TileStraight", rotation: 0 }, // straight branch
      "0,1": { x: 0, y: 1, component: "TileStraight", rotation: 1 }, // right branch (free)
    };
    const arm = { value: ActiveIntersection.Straight };
    const sim = createSimulation({
      level: lvl,
      signalTiles: ["1,0"],
      getSwitch: (coordId) => (coordId === "1,1" ? arm.value : undefined),
      trains: [
        {
          id: "t1",
          coord: { x: 1, y: 0 },
          entryPort: Position.Top,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
        {
          id: "blocker",
          coord: { x: 1, y: 2 }, // occupies the straight branch only
          entryPort: Position.Top,
          color: "blue",
          type: "people",
          wagonCount: 0,
          speed: 0,
        },
      ],
    });
    for (let i = 0; i < 10; i++) sim.step(0.5);
    expect(sim.trainTileId("t1")).toBe("1,0"); // stuck at the signal

    arm.value = ActiveIntersection.Right; // open the free branch
    let cleared = false;
    for (let i = 0; i < 20 && !cleared; i++) {
      sim.step(0.5);
      if (sim.trainTileId("t1") !== "1,0") cleared = true;
    }
    expect(cleared).toBe(true);
  });
});

describe("simulation reservation visibility (drives the switch-lock UI)", () => {
  // The switch-lock feature in the renderer keys off game.reservations, which is
  // fed from sim.reservedBy. This guards that an intersection tile a train is
  // committed through is reported as reserved (so the UI can lock its switch),
  // and is released again once the train clears it.
  const lvl: LevelDefinition = {
    "1,0": { x: 1, y: 0, component: "TileStraight", rotation: 0 },
    "1,1": { x: 1, y: 1, component: "TileIntersectionComplete", rotation: 0 },
    "1,2": { x: 1, y: 2, component: "TileStraight", rotation: 0 },
  };

  it("reports an intersection tile as reserved while a train is committed through it", () => {
    const sim = createSimulation({
      level: lvl,
      getSwitch: (coordId) =>
        coordId === "1,1" ? ActiveIntersection.Straight : undefined,
      trains: [
        {
          id: "t1",
          coord: { x: 1, y: 0 },
          entryPort: Position.Top,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
      ],
    });

    let everReserved = false;
    for (let i = 0; i < 12; i++) {
      sim.step(0.25);
      if (sim.reservedBy("1,1") === "t1") everReserved = true;
    }
    expect(everReserved).toBe(true);
  });

  it("reports a tile as occupied only while the train's body is physically on it (occupied ⊆ reserved)", () => {
    const sim = createSimulation({
      level: lvl,
      getSwitch: (coordId) =>
        coordId === "1,1" ? ActiveIntersection.Straight : undefined,
      trains: [
        {
          id: "t1",
          coord: { x: 1, y: 0 },
          entryPort: Position.Top,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 1,
        },
      ],
    });

    let everOccupied = false;
    // A train reserves the whole block ahead at once, so a tile further down the
    // route ("1,2") is reserved before the body ever reaches it — that is the
    // window the "occupied" lock mode leaves throwable while "reserved" locks it.
    let reservedNotYetOccupiedAhead = false;
    for (let i = 0; i < 12; i++) {
      sim.step(0.25);
      for (const id of ["1,1", "1,2"]) {
        const reserved = sim.reservedBy(id) === "t1";
        const occupied = sim.occupiedBy(id) === "t1";
        // Occupancy must imply reservation — a train can't be physically on a
        // tile it hasn't reserved. This is the invariant the lock modes rely on.
        if (occupied) expect(reserved).toBe(true);
      }
      if (sim.occupiedBy("1,2") === "t1") everOccupied = true;
      if (
        sim.reservedBy("1,2") === "t1" &&
        sim.occupiedBy("1,2") !== "t1" &&
        !everOccupied
      ) {
        reservedNotYetOccupiedAhead = true;
      }
    }
    expect(everOccupied).toBe(true);
    expect(reservedNotYetOccupiedAhead).toBe(true);
  });
});
