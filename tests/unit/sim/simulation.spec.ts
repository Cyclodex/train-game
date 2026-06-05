import { describe, it, expect } from "vitest";
import { createSimulation, BOGIE_INSET_FRAC } from "@/sim/simulation";
import { Position, ActiveIntersection } from "@/types";
import { Level } from "@/tiles/model";
import { AuthorKind, expandKind } from "@/tiles/kinds";

// Legacy component names used in these fixtures -> new authoring kinds.
const KIND: Record<string, AuthorKind> = {
  TileStraight: "straight",
  TileCurve: "curve",
  TileDepot: "depot",
  TileIntersectionComplete: "cross",
};
const cell = (component: string, rotation = 0) =>
  expandKind(KIND[component], rotation);

function corridor(n: number): Level {
  const lvl: Level = {};
  for (let x = 0; x < n; x++) {
    lvl[`${x},0`] = cell("TileStraight", 1);
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
          speed: 1, // cruise speed (tiles/sec); the train ramps up to it
        },
      ],
    });

    expect(sim.trainTileId("t1")).toBe("0,0");
    // Drive it along the corridor; it ramps up but still passes through the
    // tiles in order and ends held at the far map edge.
    const visited: string[] = [];
    for (let i = 0; i < 12; i++) {
      sim.step(0.5);
      const tile = sim.trainTileId("t1");
      if (visited[visited.length - 1] !== tile) visited.push(tile);
    }
    expect(visited).toEqual(["0,0", "1,0", "2,0"]); // strictly in order
    expect(sim.trainTileId("t1")).toBe("2,0");
  });

  it("exposes fractional progress within the current tile as it ramps up", () => {
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
    const p = sim.trainProgress("t1");
    // Accelerating from rest, so it has moved but covered less than the
    // constant-speed distance (1 tile/sec * 0.5s = 0.5).
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.5);
  });
});

describe("simulation body sampling", () => {
  // Along-track position (in tiles) of a sampled coupler point on a straight
  // corridor, where x maps directly to along-track distance and t is the 0..1
  // progress within the tile.
  const along = (u: { coord: { x: number }; t: number }) => u.coord.x + u.t;

  it("samples each unit as a front/rear coupler pair trailing along the path", () => {
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
    // Each unit has a front (toward the head) and a rear coupler point.
    for (const u of body) {
      expect(u.front).toBeDefined();
      expect(u.rear).toBeDefined();
      expect(along(u.front)).toBeGreaterThanOrEqual(along(u.rear)); // front leads
    }
    // Units are ordered head -> tail: each unit's front is behind the previous
    // unit's rear (or equal, when coupled with no gap).
    for (let i = 1; i < body.length; i++) {
      expect(along(body[i].front)).toBeLessThanOrEqual(along(body[i - 1].rear));
    }
    // The trailing wagon's rear is at least one tile behind the loco's front.
    expect(along(body[0].front) - along(body[2].rear)).toBeGreaterThanOrEqual(1);
  });

  it("anchors the loco's front bogie set back from the head (like real wheels)", () => {
    const sim = createSimulation({
      level: corridor(6),
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 1,
          speed: 1,
        },
      ],
    });
    for (let i = 0; i < 5; i++) sim.step(0.5);
    const head = sim.trains["t1"].headIndex + sim.trains["t1"].headProgress;
    const front = sim.sampleTrain("t1")[0].front;
    // The front anchor is inset from the leading tip by inset = locoLen * frac.
    const inset = 0.5 * BOGIE_INSET_FRAC; // default loco length 0.5 tile
    expect(along(front)).toBeCloseTo(head - inset, 5);
    expect(along(front)).toBeLessThan(head); // set back from the very tip
  });
});

describe("simulation per-unit spacing", () => {
  const along = (u: { coord: { x: number }; t: number }) => u.coord.x + u.t;

  it("anchors each car on bogies inset from its ends", () => {
    const lengthsLoco = 0.5;
    const lengthsWagon = 0.4;
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
    for (let i = 0; i < 10; i++) sim.step(0.5);

    const body = sim.sampleTrain("t1");
    expect(body).toHaveLength(3);

    // Each unit's two bogies span (length − 2*inset) of its length.
    const span = (len: number) => len * (1 - 2 * BOGIE_INSET_FRAC);
    expect(along(body[0].front) - along(body[0].rear)).toBeCloseTo(span(lengthsLoco), 5);
    expect(along(body[1].front) - along(body[1].rear)).toBeCloseTo(span(lengthsWagon), 5);
    // Gap between adjacent bogies = coupling + the two cars' insets (the ends
    // overhang the bogies, so there is always some bogie gap).
    const gap = coupling + lengthsLoco * BOGIE_INSET_FRAC + lengthsWagon * BOGIE_INSET_FRAC;
    expect(along(body[0].rear) - along(body[1].front)).toBeCloseTo(gap, 5);
  });

  it("leaves a bogie overhang gap between cars even with zero coupling", () => {
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
          unitLengths: [0.5, 0.4, 0.4],
          coupling: 0,
        },
      ],
    });
    for (let i = 0; i < 10; i++) sim.step(0.5);
    const body = sim.sampleTrain("t1");
    // With no coupling the bogies are still apart by the two cars' insets.
    const gap01 = 0.5 * BOGIE_INSET_FRAC + 0.4 * BOGIE_INSET_FRAC;
    expect(along(body[0].rear) - along(body[1].front)).toBeCloseTo(gap01, 5);
    expect(along(body[0].rear) - along(body[1].front)).toBeGreaterThan(0);
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

describe("simulation spaces cars by true arc length across curves", () => {
  // A straight, a curve, then a straight. A curve tile's path is only ~0.81x as
  // long as a straight, so spacing measured in normalised per-tile progress would
  // bunch cars up (and overlap them) on curves. The sim must instead space them by
  // real arc length: a coupler 0.5 tile of *arc* behind the head must sit further
  // back (smaller t) on a curve segment than a normalised 0.5 would.
  const curveLevel: Level = {
    "0,0": cell("TileStraight", 0), // vertical Top<->Bottom
    "0,1": cell("TileCurve", 0), // Top<->Right
    "1,1": cell("TileStraight", 1), // horizontal Left<->Right
    "2,1": cell("TileStraight", 1),
  };

  it("samples a coupler at its true arc distance behind the head, even over a curve", () => {
    const sim = createSimulation({
      level: curveLevel,
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Top,
          color: "red",
          type: "people",
          wagonCount: 0, // loco only, length 0.5 tile, coupling 0
          speed: 2,
        },
      ],
    });

    // Build the path through the curve onto the second straight (1,1).
    for (let i = 0; i < 60 && sim.trains["t1"].path.length < 3; i++) sim.step(0.25);
    expect(sim.trains["t1"].path.length).toBeGreaterThanOrEqual(3);

    // Park the head deterministically 0.2 into the straight at (1,1).
    sim.trains["t1"].headIndex = 2;
    sim.trains["t1"].headProgress = 0.2;

    const [loco] = sim.sampleTrain("t1");
    const inset = 0.5 * BOGIE_INSET_FRAC; // loco length 0.5
    // Front bogie is inset back from the head, still on the straight (1,1).
    expect(loco.front.coord).toEqual({ x: 1, y: 1 });
    expect(loco.front.t).toBeCloseTo(0.2 - inset, 5);

    // Rear bogie is (0.5 − inset) tile of ARC behind the head: 0.2 of that is on
    // the straight, the remainder falls on the curve (length ~0.8116). The point
    // is measured in real arc length, so it sits further back (smaller t) than the
    // wrong normalised-per-tile answer (0.8) that bunched the cars up.
    const curveLen = 0.8116;
    const onCurve = 0.5 - inset - 0.2; // arc beyond the straight portion
    expect(loco.rear.coord).toEqual({ x: 0, y: 1 });
    expect(loco.rear.t).toBeCloseTo(1 - onCurve / curveLen, 2);
    expect(loco.rear.t).toBeLessThan(0.8); // arc-correct, further back than normalised
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
  const crossLevel: Level = {
    "1,0": cell("TileStraight", 0), // a's signal
    "1,1": cell("TileIntersectionComplete", 0),
    "1,2": cell("TileStraight", 0),
    "0,1": cell("TileStraight", 1), // b's signal
    "2,1": cell("TileStraight", 1),
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
  const depotLevel: Level = {
    "0,0": cell("TileStraight", 1),
    "1,0": cell("TileDepot", 3), // opening on the Left
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
    const level: Level = {
      "0,0": cell("TileStraight", 1),
      "1,0": cell("TileStraight", 1),
      "2,0": cell("TileStraight", 1),
      "3,0": cell("TileDepot", 3),
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
  const junctionLevel: Level = {
    "1,0": cell("TileStraight", 0), // t1 signal
    "1,1": cell("TileIntersectionComplete", 0),
    "1,2": cell("TileStraight", 0), // blocked branch
    "0,1": cell("TileStraight", 1), // free branch
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
    const lvl: Level = {
      "1,0": cell("TileStraight", 0),
      "1,1": cell("TileIntersectionComplete", 0),
      "1,2": cell("TileStraight", 0), // straight branch (free)
      "0,1": cell("TileStraight", 1), // right branch (occupied)
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
    const lvl: Level = {
      "1,0": cell("TileStraight", 0),
      "1,1": cell("TileIntersectionComplete", 0),
      "1,2": cell("TileStraight", 0), // straight branch (occupied)
      "0,1": cell("TileStraight", 1), // right branch (free)
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
    const lvl: Level = {
      "1,0": cell("TileStraight", 0),
      "1,1": cell("TileIntersectionComplete", 0),
      "1,2": cell("TileStraight", 0), // straight branch
      "0,1": cell("TileStraight", 1), // right branch (free)
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
  const lvl: Level = {
    "1,0": cell("TileStraight", 0),
    "1,1": cell("TileIntersectionComplete", 0),
    "1,2": cell("TileStraight", 0),
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

describe("simulation event log (decision-level events)", () => {
  function drain(sim: ReturnType<typeof createSimulation>, ticks: number, dt = 0.5) {
    const events: any[] = [];
    for (let i = 0; i < ticks; i++) for (const e of sim.step(dt)) events.push(e);
    return events;
  }

  it("emits a reserved event listing the block a train claims", () => {
    const sim = createSimulation({
      level: corridor(3),
      signalTiles: ["1,0"],
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

    const reserved = drain(sim, 8).filter(
      e => e.type === "reserved" && e.trainId === "t1"
    );
    expect(reserved.length).toBeGreaterThan(0);
    // Every reserved event carries a non-empty list of tile ids.
    for (const e of reserved) {
      expect(Array.isArray(e.tiles)).toBe(true);
      expect(e.tiles.length).toBeGreaterThan(0);
    }
  });

  it("emits a single blocked event (reason signal-hold) when a train stops at a held signal, not one per tick", () => {
    const sim = createSimulation({
      level: corridor(3),
      signalTiles: ["1,0"],
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
    sim.toggleHold("1,0", Position.Right);

    const blocked = drain(sim, 20).filter(
      e => e.type === "blocked" && e.trainId === "t1"
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0].reason).toBe("signal-hold");
    expect(blocked[0].tileId).toBe("1,0");
  });

  it("emits a proceeding event when a held train is released", () => {
    const sim = createSimulation({
      level: corridor(3),
      signalTiles: ["1,0"],
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
    sim.toggleHold("1,0", Position.Right);
    drain(sim, 10); // settle at the held signal
    sim.toggleHold("1,0", Position.Right); // release

    const after = drain(sim, 6);
    expect(
      after.some(e => e.type === "proceeding" && e.trainId === "t1")
    ).toBe(true);
  });

  it("emits a blocked event with reason reservation when the block ahead is taken by another train", () => {
    const sim = createSimulation({
      level: corridor(3),
      signalTiles: ["1,0"],
      trains: [
        {
          id: "lead",
          coord: { x: 2, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 0, // sits on 2,0, holding the block beyond the 1,0 signal
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

    const blocked = drain(sim, 12).filter(
      e => e.type === "blocked" && e.trainId === "follow"
    );
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].reason).toBe("reservation");
    expect(blocked[0].blockedBy).toBe("lead");
  });
});

describe("simulation momentum (acceleration / braking)", () => {
  it("accelerates from rest instead of snapping to full speed", () => {
    const sim = createSimulation({
      level: corridor(30),
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 2, // cruise (tiles/sec)
          accel: 1, // tiles/sec²
          brake: 2, // tiles/sec²
        },
      ],
    });

    expect(sim.trainVelocity("t1")).toBe(0);

    sim.step(0.5);
    const v1 = sim.trainVelocity("t1");
    // After 0.5s of accel=1 it is moving but nowhere near cruise (2).
    expect(v1).toBeGreaterThan(0);
    expect(v1).toBeLessThan(2);
    // The first half-second covered far less than constant-cruise (2*0.5 = 1).
    expect(sim.trainProgress("t1")).toBeLessThan(0.5);

    sim.step(0.5);
    expect(sim.trainVelocity("t1")).toBeGreaterThan(v1); // still ramping up

    // Given enough open track it saturates at maxSpeed and holds there.
    for (let i = 0; i < 6; i++) sim.step(0.5);
    expect(sim.trainVelocity("t1")).toBeCloseTo(2, 5);
  });

  it("brakes smoothly to a stop at a red signal rather than halting in one tick", () => {
    const sim = createSimulation({
      level: corridor(12),
      signalTiles: ["6,0"],
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 2,
          accel: 1,
          brake: 2,
        },
      ],
    });
    sim.toggleHold("6,0", Position.Right); // hold the signal at 6,0 to Stop

    const velocities: number[] = [];
    for (let i = 0; i < 120; i++) {
      sim.step(0.25);
      velocities.push(sim.trainVelocity("t1"));
      if (i > 5 && sim.trainVelocity("t1") === 0) break;
    }

    // It comes to rest held at the signal tile (never crosses into 7,0).
    expect(sim.trainTileId("t1")).toBe("6,0");
    expect(sim.trainVelocity("t1")).toBe(0);

    // It actually cruised first...
    expect(Math.max(...velocities)).toBeGreaterThan(1);
    // ...then decelerated over several ticks while still rolling (smooth stop,
    // not a single-tick clamp from cruise to zero).
    let decelTicks = 0;
    for (let i = 1; i < velocities.length; i++) {
      if (velocities[i] < velocities[i - 1] && velocities[i] > 0) decelTicks++;
    }
    expect(decelTicks).toBeGreaterThanOrEqual(3);
  });

  it("coasts to rest into a depot and still registers the arrival", () => {
    const depotLevel: Level = {
      "0,0": cell("TileStraight", 1),
      "1,0": cell("TileDepot", 3), // opening Left
    };
    const sim = createSimulation({
      level: depotLevel,
      depotColors: { "1,0": "red" },
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 2,
          accel: 1,
          brake: 2,
        },
      ],
    });

    const arrivals: any[] = [];
    for (let i = 0; i < 60; i++) {
      for (const e of sim.step(0.25)) if (e.type === "arrived") arrivals.push(e);
      if (sim.trainState("t1") === "parked") break;
    }

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]).toMatchObject({ tileId: "1,0", matched: true });
    expect(sim.trainState("t1")).toBe("parked");
    expect(sim.trainVelocity("t1")).toBe(0);
  });

  it("decelerates smoothly to a stop with no final position jump at 60fps dt", () => {
    // Regression: a too-large arrival snap teleported the train onto the stop
    // line in one frame while it still carried speed. It only shows at small
    // (real 60fps) dt — large-dt tests mask it via the move>clear clamp.
    const dt = 1 / 60;
    const sim = createSimulation({
      level: corridor(10),
      signalTiles: ["6,0"],
      trains: [
        {
          id: "t1",
          coord: { x: 0, y: 0 },
          entryPort: Position.Left,
          color: "red",
          type: "people",
          wagonCount: 0,
          speed: 0.5,
          accel: 0.8,
          brake: 0.5,
        },
      ],
    });
    sim.toggleHold("6,0", Position.Right);

    const moves: number[] = [];
    const hd = () => sim.trains.t1.headIndex + sim.trains.t1.headProgress;
    let prev = hd();
    for (let i = 0; i < 3000; i++) {
      sim.step(dt);
      const h = hd();
      moves.push(h - prev);
      prev = h;
      if (sim.trainVelocity("t1") === 0 && sim.trainTileId("t1") === "6,0") break;
    }

    expect(sim.trainTileId("t1")).toBe("6,0"); // came to rest at the signal

    // The train never advances more in a single frame than it would at full
    // cruise speed (speed * dt). Acceleration and braking frames are all <=
    // that; an arrival snap teleports a fixed distance regardless of speed and
    // so exceeds it — that is the visible end-of-stop jump.
    const cruiseStep = 0.5 * dt;
    expect(Math.max(...moves)).toBeLessThanOrEqual(cruiseStep + 1e-9);
  });

  it("a heavier (lower-accel) train pulls away more slowly than a light one", () => {
    const make = (id: string, accel: number) =>
      createSimulation({
        level: corridor(30),
        trains: [
          {
            id,
            coord: { x: 0, y: 0 },
            entryPort: Position.Left,
            color: "red",
            type: "people",
            wagonCount: 0,
            speed: 3,
            accel,
            brake: 2,
          },
        ],
      });
    const light = make("light", 1.2);
    const heavy = make("heavy", 0.4);

    for (let i = 0; i < 4; i++) {
      light.step(0.25);
      heavy.step(0.25);
    }
    // Same elapsed time, same cruise cap: the lighter train is further along.
    expect(light.trainVelocity("light")).toBeGreaterThan(
      heavy.trainVelocity("heavy")
    );
  });
});
