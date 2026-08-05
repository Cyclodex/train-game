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
