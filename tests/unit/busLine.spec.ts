import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { networkMode } from "@/modes/network";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { twoWay } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";

// A BUS RUNS A LINE (#90). Planned exactly like a train: draw the line, buy a
// bus, assign it. What differs is only how it gets between stops — lanes and
// junctions rather than rails — so the movement is the road sim's and the
// passengers are the shared transit layer's, the same one the trains use.
//
// A straight street with a halt at each end, and towns beside them so the
// catchment gives each halt somebody to carry.
//   0,1 ─ HALT(1,1) ─ 2,1 ─ 3,1 ─ HALT(4,1) ─ 5,1
const WEST = "1,1";
const EAST = "4,1";

const halt = (from: Position): ParkingRow => ({ from, kind: "busstop", count: 1 });
const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });
const town = () => ({ connections: [], terrain: "urban" as const });

function busBoard(): Level {
  return {
    "0,1": street(),
    "1,1": {
      ...street(),
      parking: { facility: "halt", label: "West", dwellSec: [5, 9], rows: [halt(Position.Left)] },
    },
    "2,1": street(),
    "3,1": street(),
    "4,1": {
      ...street(),
      parking: { facility: "halt", label: "East", dwellSec: [5, 9], rows: [halt(Position.Left)] },
    },
    "5,1": street(),
    // The houses each halt serves. Demand is derived from these (D3).
    "0,0": town(),
    "1,0": town(),
    "2,0": town(),
    "4,0": town(),
    "5,0": town(),
  };
}

function gameFor(level: Level = busBoard(), trains: TrainDef[] = []) {
  return createGame(level, trains, 200, networkMode, 1, undefined, undefined, "busline");
}

const run = (g: ReturnType<typeof createGame>, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.1) g.advance(0.1);
};

describe("a bus runs a line", () => {
  it("appears at its line's first stop and works both ends", () => {
    const game = gameFor();
    const line = game.createLine([WEST, EAST]);
    const bus = game.buyBus(line);
    expect(game.busServices.map(b => b.id)).toEqual([bus]);
    // A line counts what runs it, whatever kind that is.
    expect(game.lines.find(l => l.id === line)?.buses).toEqual([bus]);

    run(game, 200);
    // People were carried between the two halts — no railway involved at all.
    expect(game.sim.passengersDelivered()).toBeGreaterThan(0);
  });

  it("carries nobody until it is assigned to a line", () => {
    const game = gameFor();
    const bus = game.buyBus();
    run(game, 120);
    expect(game.busServices[0]?.passengers ?? 0).toBe(0);
    // …and nobody is waiting either, because nothing serves the halts (D10).
    expect(game.sim.stationQueue(WEST)).toBe(0);

    const line = game.createLine([WEST, EAST]);
    expect(game.assignBus(bus, line)).toBe(true);
    run(game, 200);
    expect(game.sim.passengersDelivered()).toBeGreaterThan(0);
  });

  it("takes a bus off the road when it is taken off its line", () => {
    const game = gameFor();
    const line = game.createLine([WEST, EAST]);
    const bus = game.buyBus(line);
    run(game, 40);
    expect(game.busServices[0]?.tileId).toBeDefined();

    expect(game.assignBus(bus, null)).toBe(true);
    run(game, 5);
    // Off the board rather than wandering: a bus with no line has nowhere to be.
    expect(game.busServices[0]?.tileId).toBeUndefined();
  });

  it("keeps a line while a bus still runs it, though no train does", () => {
    const game = gameFor();
    const line = game.createLine([WEST, EAST]);
    const bus = game.buyBus(line);
    expect(game.lines.map(l => l.id)).toContain(line);

    expect(game.removeBus(bus)).toBe(true);
    // The line was drawn by the player, so it stands even with nothing on it
    // (D11) — and the board is rid of the vehicle.
    expect(game.lines.map(l => l.id)).toContain(line);
    expect(game.busServices).toEqual([]);
  });

  // WHAT CAN RUN A LINE, and why the panel needs to be told. A line drawn over
  // kerbs is a bus line; one drawn over platforms is a rail line; an empty one
  // has no kind until its first stop. The UI reads this to decide which stops
  // are clickable and which vehicles may be put on it — a mixed line is one no
  // vehicle can run (a bus asked to start at a platform never spawns at all).
  it("takes its kind from its stops, and an empty line has none", () => {
    const game = gameFor();
    const empty = game.createLine([]);
    expect(game.lines.find(l => l.id === empty)?.kind).toBeNull();

    game.setLineStops(empty, [WEST, EAST]);
    expect(game.lines.find(l => l.id === empty)?.kind).toBe("road");
  });

  it("tells the board which stops the open line could still take", () => {
    const game = gameFor();
    const line = game.createLine([WEST]);
    game.setLineOverlay({ lineId: line });
    // The overlay is what the tiles read. It must carry the kind, or every
    // platform offers itself while a bus line is being drawn.
    expect(game.lineOverlay.kind).toBe("road");
    expect(game.lineOverlay.order[WEST]).toBe(1);

    game.setLineOverlay(null);
    expect(game.lineOverlay.kind).toBeNull();
  });

  it("never sends anyone to a tile that is not a stop", () => {
    const game = gameFor();
    // A line the player drew through a plain road tile. It is a legal line —
    // but 3,1 is not a place anyone can wait, so nobody may be sent there.
    game.createLine([WEST, "3,1", EAST]);
    run(game, 60);
    expect(game.sim.stationWaiting(WEST)).not.toContain("3,1");
    expect(game.sim.stationQueue("3,1")).toBe(0);
  });
});

// The scenario the /test gallery shows, run headlessly. A journey NO single
// vehicle makes: the bus in to the interchange, the walk up to the platform,
// the train on. If bus and rail were two networks rather than one, nobody would
// ever set out — which is exactly what D10 would (correctly) enforce.
describe("bus and train are one network", () => {
  const ALT = "5,6"; // the halt out of walking reach of any platform
  const KERB = "2,3"; // the halt directly under Hauptbahnhof
  const HBF = "2,2";
  const OST = "2,1";

  async function board() {
    const { busrail } = await import("@/levels/test/scenarios/busrail");
    const defs: TrainDef[] = Object.values(busrail.trains ?? {}).map(t => ({
      id: t.id,
      x: t.x,
      y: t.y,
      type: t.type,
      wagonIds: (t.wagons ?? []).map(w => w.id),
      ...(t.line?.length ? { line: t.line } : {}),
    }));
    const game = createGame(
      busrail.level,
      defs,
      200,
      networkMode,
      1,
      busrail.colors,
      busrail.traffic,
      "busrail"
    );
    return { game, busrail };
  }

  it("keeps the two kinds of line apart on a board that has both", async () => {
    const { game } = await board();
    // The authored rail line, and a bus line over the kerbs. Each names what
    // can run it, so the panel can offer the right vehicle and the right stops.
    const rail = game.lines.find(l => l.stops.includes(HBF));
    expect(rail?.kind).toBe("rail");
    const bus = game.createLine([ALT, KERB]);
    expect(game.lines.find(l => l.id === bus)?.kind).toBe("road");
  });

  it("names a bus stop, so a line reads as places and not coordinates", async () => {
    const { game } = await board();
    // The kerb's label comes from the facility already authored on the tile —
    // the same name its sign shows on the board.
    expect(game.stationLabels[ALT]).toBe("Altstadt");
    expect(game.stationLabels[KERB]).toBe("Hauptbahnhof");
  });

  it("cannot get from Altstadt to the railway without a bus", async () => {
    const { game } = await board();
    // The train alone: Altstadt is out of walking reach of every platform, so
    // no chain of services connects it and nobody sets out (D10).
    expect(game.sim.serves(ALT, OST)).toBe(false);
    expect(game.sim.serves(ALT, HBF)).toBe(false);
  });

  it("joins the two the moment a bus line reaches the interchange", async () => {
    const { game } = await board();
    game.createLine([ALT, KERB]);
    // The kerb is a short walk from Hauptbahnhof, so the walk link closes the
    // gap and the whole railway becomes reachable from Altstadt.
    expect(game.sim.serves(ALT, HBF)).toBe(true);
    expect(game.sim.serves(ALT, OST)).toBe(true);
  });

  // A BUS DRIVES ITS LINE; IT NEVER JUMPS. The street is a ring so the cycle
  // needs no U-turn — and the tile it stands on must therefore only ever change
  // to a NEIGHBOUR. It used to drive off the end of a dead-end street and
  // re-spawn at the far stop, which looked like a bus teleporting across the
  // board (and, from the outside, like one that never left the halt).
  it("drives from stop to stop instead of jumping", async () => {
    const { game } = await board();
    const line = game.createLine([ALT, KERB]);
    game.buyBus(line);

    const at = () => game.busServices[0]?.tileId;
    const coord = (id: string) => id.split(",").map(Number);
    let last: string | undefined;
    const hops: string[] = [];
    for (let t = 0; t < 200; t += 0.1) {
      game.advance(0.1);
      const now = at();
      if (!now || now === last) continue;
      if (last) {
        const [ax, ay] = coord(last);
        const [bx, by] = coord(now);
        hops.push(`${last}->${now}`);
        // Chebyshev 1: the next tile along the street, never across the map.
        expect(Math.max(Math.abs(ax - bx), Math.abs(ay - by))).toBe(1);
      }
      last = now;
    }
    // It really did go round rather than standing still.
    expect(hops.length).toBeGreaterThan(8);
  });

  it("carries somebody the whole way: bus, walk, train", async () => {
    const { game } = await board();
    const busLine = game.createLine([ALT, KERB]);
    game.buyBus(busLine);
    // Somebody at Altstadt who wants Ostbahnhof — two vehicles and a walk away.
    expect(game.sim.enqueuePassenger(ALT, OST)).toBe(true);

    for (let t = 0; t < 400; t += 0.1) game.advance(0.1);

    expect(game.sim.passengersDelivered()).toBeGreaterThan(0);
    // Nobody is left stranded at the kerb: the walk moved them to the platform
    // rather than leaving them waiting for a train that never calls at a road.
    expect(game.sim.stationQueue(KERB)).toBeLessThan(4);
  });
});

// HOW FULL EVERY VEHICLE IS, in one book for trains and buses. The board draws a
// gauge from it and the panel prints "n/seats" from the same numbers, so the two
// can never disagree — and it is filled in the WORLD STEP, not the render frame,
// which is what makes it readable here at all (KNOWHOW → the hidden-tab trap).
describe("what a vehicle is carrying", () => {
  it("reports a bus by the id the board draws it under, with its line's colour", () => {
    const game = gameFor();
    const line = game.createLine([WEST, EAST]);
    game.buyBus(line);
    run(game, 120);

    // A bus on a DEAD-END street is off the board for one tick each time it
    // turns round at a terminus (it is despawned and re-spawned facing the other
    // way), so take a moment when it is actually driving rather than whichever
    // tick the loop above happened to stop on.
    let bus = game.busServices[0];
    for (let t = 0; t < 60 && !bus.carId; t += 0.1) {
      game.advance(0.1);
      bus = game.busServices[0];
    }
    expect(bus.seats).toBe(12);
    // The gauge hangs off the ROAD CAR, which is what the renderer holds — the
    // bus's own id is not on the board at all. (`game.roadCars` itself is a
    // RENDER mirror and stays empty headlessly, which is exactly why the bus
    // carries the join.)
    expect(bus.carId).toBeDefined();
    const load = game.vehicleLoads[bus.carId!];
    expect(load).toBeDefined();
    expect(load.seats).toBe(12);
    expect(load.aboard).toBe(bus.passengers);
    expect(load.colour).toBe(game.lines.find(l => l.id === line)?.colour);
  });

  it("gives a freight train no gauge at all", async () => {
    // Seats are what a gauge is a fraction OF. A goods train has none, and an
    // empty gauge on something that was never going to carry anybody is noise.
    const { busrail } = await import("@/levels/test/scenarios/busrail");
    const game = createGame(
      busrail.level,
      [{ id: "goods", x: 0, y: 2, type: "fraight", wagonIds: ["g1"] }],
      200,
      networkMode,
      1,
      busrail.colors,
      undefined,
      "busrail"
    );
    run(game, 30);
    expect(game.vehicleLoads["goods"]).toBeUndefined();
  });
});
