import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { networkMode } from "@/modes/network";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { twoWay } from "@/tiles/lanes";
import { facilitiesOf, type ParkingRow } from "@/tiles/parking";
import { itSlow } from "./support/tier";

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
      // Its OWN facility id. Two stops sharing one id are ONE facility to the
      // parking layer — see "two halts are two facilities" below.
      parking: {
        facility: "halt-west",
        label: "West",
        dwellSec: [5, 9],
        rows: [halt(Position.Left)],
      },
    },
    "2,1": street(),
    "3,1": street(),
    "4,1": {
      ...street(),
      parking: {
        facility: "halt-east",
        label: "East",
        dwellSec: [5, 9],
        rows: [halt(Position.Left)],
      },
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

  // A WITHDRAWN BUS DOES NOT TAKE ITS PASSENGERS WITH IT. The train's retiring
  // path has always set its riders down (`dumpAll`) — they are better off at a
  // stop than in a shed — and a manifest that simply vanishes is people the
  // player was carrying, lost with nothing in the count to explain it.
  const carried = (g: ReturnType<typeof createGame>) =>
    g.sim.stationQueue(WEST) + g.sim.stationQueue(EAST) + g.sim.passengersDelivered();

  it("sets a scrapped bus's riders down instead of deleting them", () => {
    const game = gameFor();
    const line = game.createLine([WEST, EAST]);
    const bus = game.buyBus(line);
    run(game, 60);
    const aboard = game.busServices[0]?.passengers ?? 0;
    expect(aboard).toBeGreaterThan(0);

    const before = carried(game);
    expect(game.removeBus(bus)).toBe(true);
    // Everyone aboard is either back at a stop or counted as arrived.
    expect(carried(game)).toBe(before + aboard);
  });

  it("sets its riders down when it is taken off its line", () => {
    const game = gameFor();
    const line = game.createLine([WEST, EAST]);
    const bus = game.buyBus(line);
    run(game, 60);
    const aboard = game.busServices[0]?.passengers ?? 0;
    expect(aboard).toBeGreaterThan(0);

    const before = carried(game);
    expect(game.assignBus(bus, null)).toBe(true);
    expect(carried(game)).toBe(before + aboard);
    expect(game.busServices[0]?.passengers).toBe(0);
  });

  // A stop can stop being reachable — a road edited away, a one-way reversed,
  // or (here) a line redrawn through somewhere no road goes. `retarget` says so
  // rather than teleporting the bus, and that answer has to be acted on: the
  // trip stays "arrived" with the dwell run out, so a bus that ignored it
  // re-ran the exchange at the same kerb every BUS_DWELL_SEC — boarding the
  // queue again and again, and logging calls that never happened.
  it("holds at the kerb when its next stop cannot be reached", () => {
    const game = gameFor();
    const line = game.createLine([WEST, EAST]);
    const bus = game.buyBus(line);
    run(game, 60);
    // 0,0 is a town tile: no road on it at all, so no route can ever be planned.
    game.setLineStops(line, [WEST, "0,0"]);
    run(game, 120);

    const aboard = game.busServices[0]?.passengers ?? 0;
    const held = game.eventLog.filter(e => e.trainId === bus);
    expect(held).toHaveLength(1);
    expect(held[0].text).toContain("no route");

    run(game, 60);
    // The doors stayed shut: no second exchange, no second helping of the queue,
    // and the hold is reported once rather than every tick it retries.
    expect(game.busServices[0]?.passengers).toBe(aboard);
    expect(game.eventLog.filter(e => e.trainId === bus)).toHaveLength(1);
  });

  // TWO STOPS MUST NOT SHARE A `facility` ID. The parking layer treats one id
  // as one facility: the stalls pool, the sign shows a single count, and a car
  // park's "am I full" is answered for the pair. Two halts at opposite ends of a
  // street are not one car park — the first cut of this board and of `busrail`
  // both had it, and the board read "H 2/2" once instead of a halt at each end.
  it("makes two halts two facilities, not one pooled stop", () => {
    const board = busBoard();
    const split = facilitiesOf(board);
    expect(split.map(f => f.id)).toEqual(["halt-east", "halt-west"]);
    expect(split.map(f => f.label)).toEqual(["East", "West"]);
    expect(split.every(f => f.stalls.length === 1)).toBe(true);

    // The trap, spelled out: give them one id and the layer sees ONE stop with
    // two bays, spread over both ends of the street.
    const shared: Level = {
      ...board,
      "1,1": { ...board["1,1"], parking: { ...board["1,1"].parking!, facility: "halt" } },
      "4,1": { ...board["4,1"], parking: { ...board["4,1"].parking!, facility: "halt" } },
    };
    const pooled = facilitiesOf(shared);
    expect(pooled).toHaveLength(1);
    expect(pooled[0].stalls).toHaveLength(2);
    expect([...pooled[0].tileIds].sort()).toEqual([WEST, EAST].sort());
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

  // A line with nobody running it is the CONTROL for the test below: the
  // journey exists on paper, no vehicle makes it, and Altstadt fills to its cap
  // and stays there. Every delivery the next test counts over and above this
  // one is a journey the bus made.
  it("strands Altstadt while nothing runs the line", async () => {
    const { game } = await board();
    game.createLine([ALT, KERB]);
    for (let t = 0; t < 400; t += 0.1) game.advance(0.1);
    expect(game.sim.stationQueue(ALT)).toBeGreaterThan(0);
    // Nobody there has moved: no bus, no journey.
    expect(game.sim.stationWaiting(ALT).length).toBe(game.sim.stationQueue(ALT));
  });

  it("carries somebody the whole way: bus, walk, train", async () => {
    const control = (await board()).game;
    control.createLine([ALT, KERB]);
    for (let t = 0; t < 400; t += 0.1) control.advance(0.1);
    const withoutABus = control.sim.passengersDelivered();
    const strandedAtAltstadt = control.sim.stationQueue(ALT);

    const { game } = await board();
    const busLine = game.createLine([ALT, KERB]);
    game.buyBus(busLine);
    // Somebody at Altstadt who wants Ostbahnhof — two vehicles and a walk away.
    expect(game.sim.enqueuePassenger(ALT, OST)).toBe(true);

    for (let t = 0; t < 400; t += 0.1) game.advance(0.1);

    // The SAME board and the same 400 seconds, the only difference being a bus
    // on the line. Every extra arrival is therefore a journey through Altstadt
    // — nothing else on this board changed — and Altstadt itself is worked
    // clear rather than stuck at the cap it sits at with no bus.
    expect(game.sim.passengersDelivered()).toBeGreaterThan(withoutABus);
    expect(game.sim.stationQueue(ALT)).toBeLessThan(strandedAtAltstadt);
    // And the interchange works as an interchange: whoever the bus set down at
    // the kerb bound for the railway walked up to the platform and left on a
    // train, so Hauptbahnhof is not sitting on the cap that would stop it
    // generating anyone at all.
    expect(game.sim.stationQueue(HBF)).toBeLessThan(8);
  });

  // THE INVARIANT ITEM 1 IS ABOUT: a stop must never fill with people no
  // mechanism can move. `advanceDemand` stops generating at the cap, so ONE
  // unmovable passenger class is enough to kill a stop's traffic for the rest
  // of the run — which is what a kerb two tiles from the platform used to do to
  // Hauptbahnhof, every other passenger, on the board as the gallery ships it.
  itSlow("keeps every stop generating over a long run", async () => {
    const { game } = await board();
    const line = game.createLine([ALT, KERB]);
    game.buyBus(line);

    const marks: number[] = [];
    let worstHbf = 0;
    for (let window = 0; window < 3; window++) {
      for (let t = 0; t < 300; t += 0.1) {
        game.advance(0.1);
        worstHbf = Math.max(worstHbf, game.sim.stationQueue(HBF));
      }
      marks.push(game.sim.passengersDelivered());
    }
    // Deliveries keep coming in every window, not just the first.
    expect(marks[1] - marks[0]).toBeGreaterThan(0);
    expect(marks[2] - marks[1]).toBeGreaterThan(0);
    // …and Hauptbahnhof never sat at its cap: a saturated platform stops
    // generating, and a platform that stops generating is a dead board.
    expect(worstHbf).toBeLessThan(8);
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
