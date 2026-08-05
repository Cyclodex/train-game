import { describe, it, expect } from "vitest";
import { createSimulation, SimEvent, DwellEvent } from "@/sim/simulation";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";

// ONE ring with four platforms, and two lines that overlap at exactly one of
// them. Deliberately a ring rather than a cross of shuttles: two shuttles on
// single track meet head-on and the board deadlocks, which tests the
// interlocking rather than the transfer. Here both trains run the same way
// round and simply follow each other.
//
//   1,0 ── A(2,0) ── B(3,0) ── 4,0 ── 5,0
//    │                                   │
//   1,1                                 5,1
//    │                                   │
//   1,2 ── D(2,2) ── 3,2 ── C(4,2) ── 5,2
//
//   Line W: A — B      Line E: B — C
//   So B is the interchange, and A → C cannot be ridden without changing.
//   The ring is deliberately roomy: two trains on a tight one spend the test
//   blocking each other, which measures the interlocking and not transfers.
const A = "2,0";
const B = "3,0";
const C = "4,2";
const D = "2,2";

function ring(): Level {
  const stn = () => ({
    connections: [[Position.Left, Position.Right]] as [Position, Position][],
    role: "station" as const,
  });
  return {
    "1,0": expandKind("curve", 1),
    "2,0": stn(),
    "3,0": stn(),
    "4,0": expandKind("straight", 1),
    "5,0": expandKind("curve", 2),
    "1,1": expandKind("straight", 0),
    "5,1": expandKind("straight", 0),
    "1,2": expandKind("curve", 0),
    "2,2": stn(),
    "3,2": expandKind("straight", 1),
    "4,2": stn(),
    "5,2": expandKind("curve", 3),
  };
}

const mkTrain = (
  id: string,
  x: number,
  y: number,
  line?: string[],
  entryPort: Position = Position.Left
) => ({
  id,
  coord: { x, y },
  entryPort,
  color: "green",
  type: "people" as const,
  wagonCount: 1,
  speed: 1.4,
  ...(line ? { line } : {}),
});

function run(sim: ReturnType<typeof createSimulation>, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < seconds; t += 0.05) events.push(...sim.step(0.05));
  return events;
}

const dwells = (events: SimEvent[]) =>
  events.filter((e): e is DwellEvent => e.type === "dwell");

describe("changing trains", () => {
  // The bug phase 8 created: boarding asked only whether THIS line calls at the
  // passenger's destination, so on a network of two lines meeting at an
  // interchange, someone bound for the other line's territory never boarded
  // anything at all. They waited until the platform cap and counted against the
  // player — making two lines strictly worse than one enormous one.
  const twoLines = () => [
    mkTrain("w", 2, 0, [A, B]),
    mkTrain("e", 4, 2, [B, C], Position.Right),
  ];

  it("carries someone to the interchange and hands them on", () => {
    const sim = createSimulation({ level: ring(), trains: twoLines() });
    // One person at A, who wants to get to C. No single line goes there.
    expect(sim.enqueuePassenger(A, C)).toBe(true);
    expect(sim.stationWaiting(A)).toEqual([C]);

    const events = run(sim, 300);
    // Somebody got off at the interchange to change — and it was NOT counted
    // as an arrival.
    const atB = dwells(events).filter(d => d.tileId === B);
    expect(atB.some(d => (d.changing ?? 0) > 0)).toBe(true);
    // …and the journey finished at C, once.
    const arrivedAtC = dwells(events)
      .filter(d => d.tileId === C)
      .reduce((n, d) => n + (d.alighted - (d.changing ?? 0)), 0);
    expect(arrivedAtC).toBe(1);
    expect(sim.passengersDelivered()).toBe(1);
    expect(sim.stationQueue(A)).toBe(0);
    expect(sim.stationQueue(B)).toBe(0);
  });

  it("a delivery is counted once, at the destination — not at every change", () => {
    const sim = createSimulation({ level: ring(), trains: twoLines() });
    for (let i = 0; i < 3; i++) sim.enqueuePassenger(A, C);
    run(sim, 400);
    // Three people, three arrivals — however many trains they each rode.
    expect(sim.passengersDelivered()).toBe(3);
  });

  it("does not change anyone when one line already goes there", () => {
    const sim = createSimulation({
      level: ring(),
      // ONE line covering both ends: nobody should ever get off early.
      trains: [mkTrain("thru", 2, 0, [A, B, C])],
    });
    sim.enqueuePassenger(A, C);
    sim.enqueuePassenger(A, C);
    const events = run(sim, 300);
    expect(dwells(events).every(d => (d.changing ?? 0) === 0)).toBe(true);
    expect(sim.passengersDelivered()).toBe(2);
  });

  it("keeps a rider aboard past an interchange that is not their stop", () => {
    const sim = createSimulation({
      level: ring(),
      trains: [mkTrain("thru", 2, 0, [A, B, C])],
    });
    sim.enqueuePassenger(A, C);
    const events = run(sim, 300);
    // The train calls at B on the way, but the passenger asked for C and rides
    // straight through.
    const atB = dwells(events).filter(d => d.tileId === B);
    expect(atB.length).toBeGreaterThan(0);
    expect(atB.every(d => d.alighted === 0)).toBe(true);
  });

  it("leaves someone on the platform when nothing can take them", () => {
    const sim = createSimulation({
      level: ring(),
      // A line running the far side of the ring only — no use to anyone at A.
      trains: [mkTrain("far", 4, 2, [C, D], Position.Right)],
    });
    sim.enqueuePassenger(A, C);
    const before = sim.stationWaiting(A);
    run(sim, 300);
    // They are never carried, and never deleted either.
    expect(sim.stationWaiting(A)).toEqual(before);
    expect(sim.passengersDelivered()).toBe(0);
  });

  // D8: a change must never be refused. Deleting someone mid-journey because a
  // platform is full would be a loss the player cannot even see happen.
  it("lets a change onto a platform that is already at its cap", () => {
    const sim = createSimulation({
      level: ring(),
      trains: twoLines(),
      // The interchange fills to its cap and stays there, so a change would be
      // refused if the cap applied to it.
      stationDemand: { [B]: { intervalSec: 0.5, max: 2, initial: 2 } },
    });
    sim.enqueuePassenger(A, C);
    sim.enqueuePassenger(A, C);
    const events = run(sim, 400);
    const changed = dwells(events).reduce((n, d) => n + (d.changing ?? 0), 0);
    expect(changed).toBeGreaterThanOrEqual(2);
  });

  it("a train with no line still runs the classic one-hop service", () => {
    const sim = createSimulation({
      level: ring(),
      trains: [mkTrain("stopper", 2, 0)],
    });
    sim.enqueuePassenger(A, C);
    sim.enqueuePassenger(A, C);
    const events = run(sim, 200);
    // Nobody "changes": a lineless train sets its riders down at the next call
    // and that has always counted as their arrival.
    expect(dwells(events).every(d => (d.changing ?? 0) === 0)).toBe(true);
    expect(sim.passengersDelivered()).toBeGreaterThan(0);
  });
});

// D10: nobody goes to a station that cannot take them. Phase 8 drew a
// passenger's destination from the stations the METALS reach, which put people
// on a platform for a journey no service could make. They stood there for ever,
// coloured the crowd and drove the overcrowd predicate — a punishment for
// demand the player was never given the chance to serve.
describe("who turns up on the platform", () => {
  it("sends nobody anywhere until a line has been drawn", () => {
    const sim = createSimulation({
      level: ring(),
      // Trains exist, but none of them is running a service yet.
      trains: [],
      stationDemand: { [A]: { intervalSec: 0.5, max: 8, initial: 4 } },
    });
    expect(sim.stationQueue(A)).toBe(0);
    run(sim, 60);
    expect(sim.stationQueue(A)).toBe(0);
  });

  it("fills the platform the moment a service reaches somewhere", () => {
    const sim = createSimulation({
      level: ring(),
      trains: [mkTrain("w", 2, 0, [A, B])],
      stationDemand: { [A]: { intervalSec: 0.5, max: 8, initial: 3 } },
    });
    // Three people at A, and every one of them asked for the only place the
    // service goes.
    expect(sim.stationWaiting(A)).toEqual([B, B, B]);
  });

  it("only ever offers destinations a service actually reaches", () => {
    const sim = createSimulation({
      level: ring(),
      // The line misses D entirely.
      trains: [mkTrain("w", 2, 0, [A, B, C])],
      stationDemand: { [A]: { intervalSec: 0.5, max: 12, initial: 8 } },
    });
    run(sim, 40);
    expect(sim.stationWaiting(A).length).toBeGreaterThan(0);
    expect(sim.stationWaiting(A)).not.toContain(D);
  });

  it("counts a train with no line as a service over all it can reach", () => {
    const sim = createSimulation({
      level: ring(),
      // A stopper calls everywhere it passes, so it IS the network on a board
      // where nobody has drawn anything — which is what keeps every classic
      // board working under this rule.
      trains: [mkTrain("stopper", 2, 0)],
      stationDemand: { [A]: { intervalSec: 0.5, max: 8, initial: 4 } },
    });
    expect(sim.stationQueue(A)).toBe(4);
    expect(new Set(sim.stationWaiting(A))).toEqual(new Set([B, C, D]));
  });

  // The queue that remains says ONE thing now, and it is a fixable thing: the
  // service is too thin. Before D10 it mixed that with "no service goes there",
  // which nothing the queue suggests could ever fix.
  it("still lets a crowd build when the line exists but is under-served", () => {
    const sim = createSimulation({
      level: ring(),
      // A line is drawn and nothing runs it — the platform fills, and that is
      // the honest complaint the player is meant to answer with a train.
      trains: [mkTrain("elsewhere", 4, 2, [C, D], Position.Right)],
      stationDemand: { [C]: { intervalSec: 0.5, max: 8, initial: 0 } },
    });
    run(sim, 20);
    expect(sim.stationQueue(C)).toBeGreaterThan(0);
  });
});

// The scenario the /test gallery shows, run headless: the mechanic has to work
// on the actual board a reader will open, not only on the fixture above.
describe("the transfer scenario", () => {
  it("runs both lines clockwise and hands passengers over at Kreuzplatz", async () => {
    const { transfer: board } = await import("@/levels/test/scenarios/transfer");
    const sim = createSimulation({
      level: board.level,
      trains: Object.values(board.trains).map(t => ({
        id: t.id,
        coord: { x: t.x, y: t.y },
        entryPort: Position.Center,
        color: board.colors?.trainColors?.[t.id] ?? "green",
        type: t.type,
        wagonCount: t.wagons?.length ?? 1,
        speed: 1.4,
        ...(t.line ? { line: t.line } : {}),
      })),
      depotColors: board.colors?.depotColors,
    });
    // Nordstadt is on the west line only, Südhafen on the east line only.
    expect(sim.enqueuePassenger("2,1", "3,4")).toBe(true);

    const events = run(sim, 400);
    const changed = dwells(events)
      .filter(d => d.tileId === "4,1")
      .reduce((n, d) => n + (d.changing ?? 0), 0);
    expect(changed).toBeGreaterThan(0);
    expect(sim.passengersDelivered()).toBe(1);
    // And the board never gridlocked: both trains kept calling.
    const byTrain = new Set(dwells(events).map(d => d.trainId));
    expect(byTrain).toEqual(new Set(["west", "east"]));
  });
});
