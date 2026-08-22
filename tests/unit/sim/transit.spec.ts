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

// `from` is the journey's origin, carried into the seat since fares are priced
// against it (phase 2). Defaults to the boarding stop, which in these small
// fixtures is where the person was enqueued.
const seat = (final: string, off: string, from?: string): Rider => ({
  final,
  off,
  ...(from !== undefined ? { from } : {}),
});

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
    // Bound for C, set down at the interchange — origin A riding along for
    // the fare.
    expect(manifest).toEqual([seat(C, B, A)]);

    const change = t.exchange({ stopId: B, lineId: west.id, capacity: 4, manifest });
    expect(change.alighted).toBe(1);
    expect(change.changing).toBe(1);
    expect(manifest).toEqual([]);
    // Not an arrival — they are waiting at B for the service that finishes it.
    expect(t.delivered()).toBe(0);
    expect(t.waiting(B)).toEqual([C]);

    const second: Rider[] = [];
    t.exchange({ stopId: B, lineId: east.id, capacity: 4, manifest: second });
    // Still priced from A: the origin survives the change.
    expect(second).toEqual([seat(C, C, A)]);
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

// A WALK IS NOT A JOURNEY — the kerb outside the station.
//
// `walkLinks` puts a pseudo-service between a stop and the platform beside it,
// and that is what makes a bus-then-train trip ONE journey. But NOTHING RUNS
// IT: no vehicle ever calls at a walk. Two rules have to hold together or the
// network quietly seizes up —
//   · nobody is created whose whole journey is a walk. They would stand there
//     for ever (no vehicle can help them), fill the queue, and stop the stop
//     generating anyone who DOES need a service.
//   · anyone whose next STEP is a walk takes it, waiting or riding — otherwise
//     a journey that begins or ends on foot can never be made.
describe("the transit layer: a walk is not a journey", () => {
  const KERB = "kerb";
  const PLAT = "plat";
  const TOWN = "town";
  const OTHER = "other";
  const walk: [string, string][] = [[KERB, PLAT]];

  it("queues nobody for somewhere they can simply walk to", () => {
    const t = createTransit({
      demand: { [PLAT]: { intervalSec: 1, max: 4, initial: 4 } },
      walkLinks: walk,
    });
    // The kerb is the only thing the platform connects to, and it is a walk.
    // Nobody stands on a platform waiting for a ride they could take on foot.
    t.seed();
    expect(t.queueLength(PLAT)).toBe(0);
    t.advanceDemand(10);
    expect(t.queueLength(PLAT)).toBe(0);
    expect(t.addPassengers(PLAT, 3)).toBe(0);
  });

  it("still fills for the places that need a vehicle, and walks them to it", () => {
    const t = createTransit({
      demand: { [PLAT]: { intervalSec: 1, max: 4 } },
      walkLinks: walk,
    });
    // A bus runs from the kerb into town: reachable from the platform, but only
    // by walking out to the kerb first.
    t.createLine([KERB, TOWN], undefined, true);
    t.advanceDemand(10);
    expect(t.queueLength(PLAT)).toBeGreaterThan(0);
    expect(t.waiting(PLAT).every(d => d === TOWN)).toBe(true);

    // …and on the next tick they are at the kerb, where the bus calls. Left on
    // the platform they would wait for ever for a bus that never comes up the
    // stairs — and the full queue would stop anyone else setting out.
    t.advanceDemand(1);
    expect(t.queueLength(KERB)).toBe(4);
    expect(t.waiting(KERB).every(d => d === TOWN)).toBe(true);
    expect(t.queueLength(PLAT)).toBeLessThan(4);
  });

  it("leaves alone someone whose own service calls right here", () => {
    const t = createTransit({
      demand: { [PLAT]: { intervalSec: 1, max: 4 } },
      walkLinks: walk,
    });
    t.createLine([PLAT, OTHER], undefined, true);
    t.advanceDemand(10);
    t.advanceDemand(1);
    // A walk that does not get them closer is not a step, it is a stroll.
    expect(t.waiting(PLAT).every(d => d === OTHER)).toBe(true);
    expect(t.queueLength(KERB)).toBe(0);
  });

  it("counts a journey that finishes on foot as delivered", () => {
    const t = createTransit({ walkLinks: walk });
    const bus = t.createLine([TOWN, KERB], undefined, true);
    // Off the bus at the kerb, bound for the platform a few steps away. That is
    // an ARRIVAL: re-queueing them at their own destination is a state
    // `enqueue` itself forbids, and it would send them round the railway once
    // more before anyone counted them.
    const manifest: Rider[] = [seat(PLAT, KERB)];
    const r = t.exchange({ stopId: KERB, lineId: bus.id, capacity: 4, manifest });
    expect(r.alighted).toBe(1);
    expect(r.changing).toBe(0);
    expect(t.delivered()).toBe(1);
    expect(t.queueLength(PLAT)).toBe(0);
  });

  it("carries a named traveller bus, walk, train the whole way", () => {
    const t = createTransit({ walkLinks: walk });
    const bus = t.createLine([TOWN, KERB], undefined, true);
    const rail = t.createLine([PLAT, OTHER], undefined, true);
    expect(t.enqueue(TOWN, OTHER, "traveller")).toBe(true);

    // The bus takes them as far as the kerb — its line cannot reach OTHER, but
    // it can hand them on.
    const onBus: Rider[] = [];
    expect(
      t.exchange({ stopId: TOWN, lineId: bus.id, capacity: 4, manifest: onBus })
        .boardedTags
    ).toEqual(["traveller"]);
    const off = t.exchange({ stopId: KERB, lineId: bus.id, capacity: 4, manifest: onBus });
    expect(off.alightedTags).toEqual(["traveller"]);
    expect(off.changing).toBe(1);
    // The WALK: they are on the platform now, not standing at the kerb waiting
    // for a train that does not call at a road.
    expect(t.waiting(PLAT)).toEqual([OTHER]);

    const onTrain: Rider[] = [];
    t.exchange({ stopId: PLAT, lineId: rail.id, capacity: 4, manifest: onTrain });
    const arrive = t.exchange({
      stopId: OTHER,
      lineId: rail.id,
      capacity: 4,
      manifest: onTrain,
    });
    expect(arrive.alightedTags).toEqual(["traveller"]);
    expect(t.delivered()).toBe(1);
  });
});
