import { describe, it, expect } from "vitest";
import { createTransit, Rider } from "@/sim/transit";

// The transit layer on its own, with no sim around it. Everything here used to
// be private to `createSimulation`; it is out because a BUS is planned exactly
// like a train (#90) and a bus-then-train journey is one journey, which means
// one set of queues and one line registry — not one per sim.
//
// A, B, C are just stop ids. That is the point: this layer never learns whether
// a stop is a platform or a kerb.
const A = "a";
const B = "b";
const C = "c";

const seat = (final: string, off: string): Rider => ({ final, off });

describe("the transit layer: lines", () => {
  it("draws a line with nothing running it, and keeps it", () => {
    const t = createTransit();
    const line = t.createLine([A, B], "Küstenbahn", true);
    expect(t.lines().map(l => l.id)).toEqual([line.id]);
    expect(t.line(line.id)?.name).toBe("Küstenbahn");
    // Pinned: the player drew it, so sweeping does not touch it (D11).
    t.pruneLine(line.id);
    expect(t.lines()).toHaveLength(1);
  });

  it("sweeps up a line nobody drew on purpose", () => {
    const t = createTransit();
    const inferred = t.createLine([A, B]);
    t.pruneLine(inferred.id);
    expect(t.lines()).toHaveLength(0);
  });

  it("gives the same stops the same line", () => {
    const t = createTransit();
    const first = t.createLine([A, B]);
    const second = t.createLine([A, B]);
    expect(second.id).toBe(first.id);
    expect(t.lines()).toHaveLength(1);
  });
});

describe("the transit layer: the network", () => {
  it("routes a change across two lines that meet", () => {
    const t = createTransit();
    const west = t.createLine([A, B], undefined, true);
    t.createLine([B, C], undefined, true);
    expect(t.serves(A, C)).toBe(true);
    // On the west line at A, bound for C: get off at the interchange.
    expect(t.offFor(west.id, A, C)).toBe(B);
  });

  it("counts an unassigned vehicle as a service over what it reaches", () => {
    const t = createTransit();
    expect(t.serves(A, B)).toBe(false);
    // A sim contributes its lineless vehicles; the layer never asks what kind
    // of vehicle it is, nor how "reaches" was worked out.
    t.setStoppers("rail", () => [{ id: "stopper:t1", stops: [A, B, C] }]);
    expect(t.serves(A, C)).toBe(true);
    expect(t.servedFrom(A).sort()).toEqual([B, C]);
  });

  it("lets two sims contribute stoppers independently", () => {
    const t = createTransit();
    t.setStoppers("rail", () => [{ id: "s:rail", stops: [B, C] }]);
    t.setStoppers("road", () => [{ id: "s:road", stops: [A, B] }]);
    // A rides the road stopper to B and the rail one onward — one network.
    expect(t.serves(A, C)).toBe(true);
    t.setStoppers("road", () => []);
    expect(t.serves(A, C)).toBe(false);
  });
});

describe("the transit layer: the exchange", () => {
  const twoLines = () => {
    const t = createTransit({ demand: { [A]: { intervalSec: 1, max: 8 } } });
    const west = t.createLine([A, B], undefined, true);
    const east = t.createLine([B, C], undefined, true);
    return { t, west, east };
  };

  it("boards someone the line can hand on, and calls it a change", () => {
    const { t, west, east } = twoLines();
    expect(t.enqueue(A, C)).toBe(true);

    const manifest: Rider[] = [];
    const onboard = t.exchange({ stopId: A, lineId: west.id, capacity: 4, manifest });
    expect(onboard.boarded).toBe(1);
    // Bound for C, set down at the interchange.
    expect(manifest).toEqual([seat(C, B)]);

    const change = t.exchange({ stopId: B, lineId: west.id, capacity: 4, manifest });
    expect(change.alighted).toBe(1);
    expect(change.changing).toBe(1);
    expect(manifest).toEqual([]);
    // Not an arrival — they are waiting at B for the service that finishes it.
    expect(t.delivered()).toBe(0);
    expect(t.waiting(B)).toEqual([C]);

    const second: Rider[] = [];
    t.exchange({ stopId: B, lineId: east.id, capacity: 4, manifest: second });
    expect(second).toEqual([seat(C, C)]);
    const arrive = t.exchange({ stopId: C, lineId: east.id, capacity: 4, manifest: second });
    expect(arrive.alighted).toBe(1);
    expect(arrive.changing).toBe(0);
    expect(t.delivered()).toBe(1);
  });

  it("refuses to board someone this line cannot help", () => {
    const t = createTransit();
    const north = t.createLine([A, B], undefined, true);
    t.createLine([B, C], undefined, true);
    // Standing at B on the north line, bound for C: it goes the other way and
    // reaches nothing closer, so they wait.
    expect(t.enqueue(B, C)).toBe(true);
    const manifest: Rider[] = [];
    const r = t.exchange({ stopId: B, lineId: north.id, capacity: 4, manifest });
    expect(r.boarded).toBe(0);
    expect(t.waiting(B)).toEqual([C]);
  });

  it("lets a change past the platform cap", () => {
    const t = createTransit({ demand: { [B]: { intervalSec: 1e6, max: 1 } } });
    const west = t.createLine([A, B], undefined, true);
    t.createLine([B, C], undefined, true);
    // B is full to its cap of one.
    expect(t.enqueue(B, C)).toBe(true);
    expect(t.enqueue(B, C)).toBe(false);
    // A rider changing there gets on anyway — deleting someone mid-journey
    // would be a loss the player cannot see happen (D8).
    const manifest: Rider[] = [seat(C, B)];
    const r = t.exchange({ stopId: B, lineId: west.id, capacity: 4, manifest });
    expect(r.changing).toBe(1);
    expect(t.queueLength(B)).toBe(2);
  });

  it("stops boarding at capacity", () => {
    const t = createTransit();
    const line = t.createLine([A, B], undefined, true);
    for (let i = 0; i < 5; i++) t.enqueue(A, B);
    const manifest: Rider[] = [];
    const r = t.exchange({ stopId: A, lineId: line.id, capacity: 2, manifest });
    expect(r.boarded).toBe(2);
    expect(t.queueLength(A)).toBe(3);
  });

  it("takes nobody new when the vehicle is being withdrawn", () => {
    const t = createTransit();
    const line = t.createLine([A, B], undefined, true);
    t.enqueue(A, B);
    const manifest: Rider[] = [];
    const r = t.exchange({
      stopId: A,
      lineId: line.id,
      capacity: 4,
      manifest,
      dumpAll: true,
    });
    expect(r.boarded).toBe(0);
    expect(t.queueLength(A)).toBe(1);
  });

  it("carries the tag through, so a named person can be followed", () => {
    const t = createTransit();
    const line = t.createLine([A, B], undefined, true);
    t.enqueue(A, B, "citizen-7");
    const manifest: Rider[] = [];
    const on = t.exchange({ stopId: A, lineId: line.id, capacity: 4, manifest });
    expect(on.boardedTags).toEqual(["citizen-7"]);
    const off = t.exchange({ stopId: B, lineId: line.id, capacity: 4, manifest });
    expect(off.alightedTags).toEqual(["citizen-7"]);
  });
});

describe("the transit layer: who turns up (D10)", () => {
  it("queues nobody while nothing is served", () => {
    const t = createTransit({ demand: { [A]: { intervalSec: 1, max: 8, initial: 4 } } });
    t.seed();
    expect(t.queueLength(A)).toBe(0);
    t.advanceDemand(10);
    expect(t.queueLength(A)).toBe(0);
    expect(t.addPassengers(A, 3)).toBe(0);
  });

  it("fills the moment a line reaches somewhere", () => {
    const t = createTransit({ demand: { [A]: { intervalSec: 1, max: 8, initial: 3 } } });
    t.createLine([A, B], undefined, true);
    t.seed();
    expect(t.waiting(A)).toEqual([B, B, B]);
  });

  it("only ever offers destinations a service reaches", () => {
    const t = createTransit({ demand: { [A]: { intervalSec: 1, max: 8 } } });
    t.createLine([A, B], undefined, true);
    t.advanceDemand(5);
    expect(t.queueLength(A)).toBeGreaterThan(0);
    expect(t.waiting(A)).not.toContain(C);
  });
});
