import { describe, it, expect } from "vitest";
import { createSimulation, SimEvent } from "@/sim/simulation";
import { Position, ActiveIntersection } from "@/types";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";

// ONE depot, two stations, and a line. This is the network-mode shape: the
// depot is where the train comes FROM, never where it is going.
//   0,0 depot — 1,0 — 2,0 station — 3,0 — 4,0 station — 5,0 (dead end)
function shuttleLine(): Level {
  return {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("station", 1),
    "3,0": expandKind("straight", 1),
    "4,0": expandKind("station", 1),
    "5,0": expandKind("depot", 3),
  };
}

const train = (line?: string[]) => ({
  id: "t1",
  coord: { x: 0, y: 0 },
  entryPort: Position.Center,
  color: "green",
  type: "people" as const,
  wagonCount: 2,
  speed: 1,
  ...(line ? { line } : {}),
});

function run(sim: ReturnType<typeof createSimulation>, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < seconds; t += 0.05) events.push(...sim.step(0.05));
  return events;
}

const dwellsAt = (events: SimEvent[]) =>
  events.filter(e => e.type === "dwell").map(e => (e as { tileId: string }).tileId);

describe("a train on a line drives itself", () => {
  it("leaves the depot, calls at each stop in turn, and keeps going round", () => {
    const sim = createSimulation({
      level: shuttleLine(),
      trains: [train(["2,0", "4,0"])],
      // Colours that WOULD match — proving the line, not the colour, decides.
      depotColors: { "0,0": "green", "5,0": "green" },
    });
    const events = run(sim, 90);
    const calls = dwellsAt(events);
    // Out to the far stop, then back, in STRICT line order — the Transport-
    // Fever rule: a train calls only at the stop it is bound for, and runs
    // past every other platform (the turn-back pass through 4,0 included). A
    // service that should call somewhere in BOTH directions names that stop
    // twice on the line (A→X→B→X) — which is exactly what repeated stops are
    // for, and the next describe block pins it.
    expect(calls.slice(0, 4)).toEqual(["2,0", "4,0", "2,0", "4,0"]);
    expect(calls.length).toBeGreaterThan(4); // still running, not a one-off
    // Never terminated: it is still in service at the end.
    expect(sim.trainState("t1")).not.toBe("parked");
  });

  // The OTHER line shape the mode supports, and the tidier one: a ring needs
  // no turn-back at all, so a board can have exactly one depot — the place
  // trains are ordered from — and nothing else but track and platforms.
  it("runs a ring for ever, calling at each station once per lap", () => {
    //  0,0 ── 1,0(station) ── 2,0
    //   │                      │
    //  0,1                    2,1
    //   │                      │
    //  0,2 ── 1,2(station) ── 2,2
    const ring: Level = {
      "0,0": expandKind("curve", 1),
      "1,0": { connections: [[Position.Left, Position.Right]], role: "station" },
      "2,0": expandKind("curve", 2),
      "0,1": expandKind("straight", 0),
      "2,1": expandKind("straight", 0),
      "0,2": expandKind("curve", 0),
      "1,2": { connections: [[Position.Left, Position.Right]], role: "station" },
      "2,2": expandKind("curve", 3),
    };
    const sim = createSimulation({
      level: ring,
      trains: [
        {
          ...train(["1,0", "1,2"]),
          coord: { x: 1, y: 2 },
          entryPort: Position.Left,
        },
      ],
    });
    const calls = dwellsAt(run(sim, 120));
    expect(calls.length).toBeGreaterThanOrEqual(4);
    // Strict alternation: on a ring each platform comes round once a lap, with
    // no doubled call, because the train never has to turn round.
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).not.toBe(calls[i - 1]);
    }
    expect(sim.trainState("t1")).not.toBe("parked");
  });

  it("does NOT park at a colour-matched depot while it is in service", () => {
    const sim = createSimulation({
      level: shuttleLine(),
      trains: [train(["2,0", "4,0"])],
      depotColors: { "0,0": "green", "5,0": "green" },
    });
    const events = run(sim, 90);
    // It may reach a depot at the end of the line and turn back out, but it
    // must never treat one as a destination.
    expect(events.some(e => e.type === "arrived" && e.matched)).toBe(false);
    expect(sim.trainState("t1")).not.toBe("parked");
  });

  it("still parks on a colour match when it has NO line (nothing else changed)", () => {
    const sim = createSimulation({
      level: shuttleLine(),
      trains: [train()],
      depotColors: { "0,0": "blue", "5,0": "green" },
    });
    run(sim, 90);
    expect(sim.trainState("t1")).toBe("parked");
    expect(sim.trainTileId("t1")).toBe("5,0");
  });

  it("reports the line and the stop it is heading for", () => {
    const sim = createSimulation({
      level: shuttleLine(),
      trains: [train(["2,0", "4,0"])],
    });
    expect(sim.trainLine("t1")).toEqual(["2,0", "4,0"]);
    expect(sim.trainNextStop("t1")).toBe("2,0");
    // Step until it has actually made its first call, then the target moves on.
    for (let t = 0; t < 40; t += 0.05) {
      const called = sim.step(0.05).some(e => e.type === "dwell");
      if (called) break;
    }
    expect(sim.trainNextStop("t1")).toBe("4,0");
  });
});

describe("assignLine — the verb an 'assign to line' UI calls", () => {
  it("puts an idle train into service, and takes it out again", () => {
    const sim = createSimulation({
      level: shuttleLine(),
      trains: [train()],
      depotColors: { "0,0": "blue", "5,0": "green" },
    });
    expect(sim.assignLine("t1", ["2,0", "4,0"])).toBe(true);
    expect(sim.trainLine("t1")).toEqual(["2,0", "4,0"]);
    const events = run(sim, 60);
    expect(dwellsAt(events).length).toBeGreaterThan(1);

    sim.assignLine("t1", []);
    expect(sim.trainLine("t1")).toEqual([]);
    expect(sim.trainNextStop("t1")).toBeUndefined();
    expect(sim.assignLine("nope", ["2,0"])).toBe(false);
  });
});

describe("the route sets the points", () => {
  // A junction board: the line's stop sits up the BRANCH, while the switch's
  // default arm points straight on. A routed train must take the branch.
  //
  //            2,0  station (up the branch)
  //  0,1 — 1,1 — 2,1(T) — 3,1 — 4,1 station
  //  depot
  function branchLevel(): Level {
    return {
      "0,1": expandKind("depot", 1),
      "1,1": expandKind("straight", 1),
      "2,1": {
        connections: [
          [Position.Left, Position.Right],
          [Position.Left, Position.Top],
          [Position.Right, Position.Top],
        ],
        // The points stand STRAIGHT ON — away from the branch.
        defaultArms: { [Position.Left]: ActiveIntersection.Straight },
      },
      "2,0": { connections: [[Position.Bottom, Position.Top]], role: "station" },
      "3,1": expandKind("straight", 1),
      "4,1": { connections: [[Position.Left, Position.Right]], role: "station" },
      "1,0": expandKind("straight", 0),
    };
  }

  it("takes the branch its line needs, against the standing points", () => {
    const level = branchLevel();
    // 2,0's station needs a way in from below and a stub above it; give it one.
    level["2,0"] = { connections: [[Position.Bottom, Position.Top]], role: "station" };
    level["2,-1" as string] = expandKind("depot", 2); // cap the branch
    const sim = createSimulation({
      level,
      trains: [
        {
          ...train(["2,0"]),
          coord: { x: 0, y: 1 },
        },
      ],
      getSwitch: (coordId, entry) =>
        level[coordId]?.defaultArms?.[entry as Position],
    });
    const events = run(sim, 60);
    // It called at the branch station, which the standing points would never
    // have taken it to.
    expect(dwellsAt(events)).toContain("2,0");
  });
});

// AN EXPRESS: a line names WHICH stations a train serves, not merely the order
// it visits everything in. Without this a line is only a suggestion and every
// train is a stopper — which is what the first cut did.
describe("a line says which stations a train serves", () => {
  // Four platforms on one ring, so a two-stop line has two to run past.
  //   1,0 ── 2,0(A) ── 3,0(B) ── 4,0
  //    │                          │
  //   1,1                        4,1
  //    │                          │
  //   1,2 ── 2,2(C) ── 3,2(D) ── 4,2
  function fourStationRing(): Level {
    const stn = () => ({
      connections: [[Position.Left, Position.Right]] as [Position, Position][],
      role: "station" as const,
    });
    return {
      "1,0": expandKind("curve", 1),
      "2,0": stn(),
      "3,0": stn(),
      "4,0": expandKind("curve", 2),
      "1,1": expandKind("straight", 0),
      "4,1": expandKind("straight", 0),
      "1,2": expandKind("curve", 0),
      "2,2": stn(),
      "3,2": stn(),
      "4,2": expandKind("curve", 3),
    };
  }

  const ringTrain = (line?: string[]) => ({
    ...train(line),
    coord: { x: 2, y: 2 },
    entryPort: Position.Left,
  });

  it("runs an EXPRESS straight past the stations that are not its stops", () => {
    const sim = createSimulation({
      level: fourStationRing(),
      // Serves C and B only: A and D must be run through without stopping.
      trains: [ringTrain(["2,2", "3,0"])],
    });
    const calls = dwellsAt(run(sim, 150));
    expect(calls.length).toBeGreaterThan(3);
    expect(new Set(calls)).toEqual(new Set(["2,2", "3,0"]));
    // …and it alternates between exactly those two, lap after lap.
    expect(calls.slice(0, 4)).toEqual(["2,2", "3,0", "2,2", "3,0"]);
  });

  it("a STOPPER with every platform on its line still calls at them all", () => {
    const sim = createSimulation({
      level: fourStationRing(),
      trains: [ringTrain(["2,2", "3,2", "2,0", "3,0"])],
    });
    const calls = dwellsAt(run(sim, 150));
    expect(new Set(calls)).toEqual(new Set(["2,2", "3,2", "2,0", "3,0"]));
  });

  it("a train with NO line stops everywhere, as it always did", () => {
    const sim = createSimulation({
      level: fourStationRing(),
      trains: [ringTrain()],
    });
    const calls = dwellsAt(run(sim, 150));
    expect(new Set(calls)).toEqual(new Set(["2,2", "3,2", "2,0", "3,0"]));
  });
});

// D11: a line is a PLAN with an identity, and a plan outlives the vehicles
// running it. Before this, the stops hung off the train, so "I have planned a
// service here" and "a vehicle is running it" were the same fact — you could
// not draw a line before buying a train, and withdrawing the last train
// silently deleted the service everyone had planned around.
// THE ORDER IS THE CONTRACT, and a stop may appear twice (Transport Fever's
// shape). Both facts fell out of one bug: the old rule called at ANY of the
// line's stops when passing, and advanced the cursor by indexOf — so on a ring
// where the route to A led past the other platforms, every en-route stop
// hijacked the cursor and A was NEVER served; and a second C on the line was
// swallowed by indexOf finding the first.
describe("a line is served in its own order, repeats included", () => {
  //   1,0 ── 2,0(A) ── 3,0(B) ── 4,0
  //    │                          │
  //   1,1                        4,1
  //    │                          │
  //   1,2 ── 2,2(C) ── 3,2(D) ── 4,2
  // Ring travel order from C, eastbound: C, D, B, A, (round again).
  function ring(): Level {
    const stn = () => ({
      connections: [[Position.Left, Position.Right]] as [Position, Position][],
      role: "station" as const,
    });
    return {
      "1,0": expandKind("curve", 1),
      "2,0": stn(),
      "3,0": stn(),
      "4,0": expandKind("curve", 2),
      "1,1": expandKind("straight", 0),
      "4,1": expandKind("straight", 0),
      "1,2": expandKind("curve", 0),
      "2,2": stn(),
      "3,2": stn(),
      "4,2": expandKind("curve", 3),
    };
  }
  const ringTrain = (line: string[]) => ({
    ...train(line),
    coord: { x: 2, y: 2 },
    entryPort: Position.Left,
  });

  it("reaches a stop whose route leads past the others (the never-visits-A bug)", () => {
    // Line A → C → B, against a ring whose travel order is C, D, B, A: every
    // leg to A runs past other stops of the SAME line. Under the old
    // call-anywhere rule the cursor never survived the journey and A was
    // never served.
    const sim = createSimulation({
      level: ring(),
      trains: [ringTrain(["2,0", "2,2", "3,0"])],
    });
    const calls = dwellsAt(run(sim, 240));
    expect(calls.length).toBeGreaterThanOrEqual(6);
    // Every stop served — A included — and in exactly the line's own order.
    for (let i = 0; i < calls.length; i++) {
      expect(calls[i]).toBe(["2,0", "2,2", "3,0"][i % 3]);
    }
  });

  it("calls twice a lap at a stop the line names twice (A→C→B→C)", () => {
    const sim = createSimulation({
      level: ring(),
      // A → C → B → C: out via C, back via C — the revisit the line editor
      // can now draw.
      trains: [ringTrain(["2,0", "2,2", "3,0", "2,2"])],
    });
    const calls = dwellsAt(run(sim, 300));
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < calls.length; i++) {
      expect(calls[i]).toBe(["2,0", "2,2", "3,0", "2,2"][i % 4]);
    }
    // ...which really is C twice per lap, never twice in a row.
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).not.toBe(calls[i - 1]);
    }
  });

  it("normalises a doubled call away — consecutive, and across the wrap", () => {
    const sim = createSimulation({ level: ring(), trains: [] });
    const stopsOf = (id: string) => sim.lines().find(l => l.id === id)?.stops;
    // C, C, B: the vehicle would already be standing there.
    expect(stopsOf(sim.createLine(["2,2", "2,2", "3,0"]))).toEqual(["2,2", "3,0"]);
    // C, B, C: a cycle, so last → first is a consecutive pair too.
    expect(stopsOf(sim.createLine(["2,2", "3,0", "2,2"]))).toEqual(["2,2", "3,0"]);
    // A, C, B, C is legal: the repeats are never adjacent, wrap included.
    expect(stopsOf(sim.createLine(["2,0", "2,2", "3,0", "2,2"]))).toEqual([
      "2,0",
      "2,2",
      "3,0",
      "2,2",
    ]);
    // ...and re-stopping an existing line goes through the same door.
    const id = sim.createLine(["2,0", "3,0"]);
    sim.setLineStops(id, ["2,0", "3,0", "3,0", "2,2", "2,0"]);
    expect(stopsOf(id)).toEqual(["2,0", "3,0", "2,2"]);
  });
});

describe("a line exists without a train on it", () => {
  it("can be drawn with nothing running it, and stays when a train leaves", () => {
    const sim = createSimulation({
      level: shuttleLine(),
      trains: [train()],
    });
    const id = sim.createLine(["2,0", "4,0"], "Küstenbahn");
    expect(sim.lines().map(l => l.id)).toContain(id);
    expect(sim.trainsOnLine(id)).toEqual([]);

    sim.assignTrain("t1", id);
    expect(sim.trainsOnLine(id)).toEqual(["t1"]);
    expect(sim.trainLine("t1")).toEqual(["2,0", "4,0"]);

    sim.assignTrain("t1", null);
    // The service is still there — that is the whole point.
    expect(sim.lines().map(l => l.id)).toContain(id);
    expect(sim.trainLine("t1")).toEqual([]);
  });

  it("survives the withdrawal of the last train running it", () => {
    const sim = createSimulation({
      level: shuttleLine(),
      trains: [train(["2,0", "4,0"])],
    });
    const id = sim.createLine(["2,0", "4,0"]);
    run(sim, 20);
    expect(sim.retireTrain("t1")).toBe(true);
    expect(sim.lines().find(l => l.id === id)?.stops).toEqual(["2,0", "4,0"]);
  });

  it("puts two trains given the same stops onto ONE line", () => {
    const sim = createSimulation({
      level: shuttleLine(),
      trains: [
        train(["2,0", "4,0"]),
        { ...train(["2,0", "4,0"]), id: "t2", coord: { x: 5, y: 0 } },
      ],
    });
    expect(sim.lines()).toHaveLength(1);
    expect(sim.trainsOnLine(sim.lines()[0].id).sort()).toEqual(["t1", "t2"]);
  });

  it("re-stopping a line moves every train running it", () => {
    const sim = createSimulation({
      level: shuttleLine(),
      trains: [train(["2,0", "4,0"])],
    });
    const id = sim.lineOf("t1") as string;
    expect(sim.setLineStops(id, ["4,0"])).toBe(true);
    expect(sim.trainLine("t1")).toEqual(["4,0"]);
    expect(sim.trainNextStop("t1")).toBe("4,0");
  });

  it("deleting a line leaves its trains running as classic services", () => {
    const sim = createSimulation({
      level: shuttleLine(),
      // An express past 2,0 — until the line it is running is deleted.
      trains: [train(["4,0"])],
    });
    const id = sim.lineOf("t1") as string;
    expect(sim.deleteLine(id)).toBe(true);
    expect(sim.lineOf("t1")).toBeUndefined();
    expect(sim.lines()).toHaveLength(0);
    // No line = the classic train, which stops at every platform it passes.
    const calls = dwellsAt(run(sim, 120));
    expect(new Set(calls)).toEqual(new Set(["2,0", "4,0"]));
  });
});
