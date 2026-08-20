import { describe, it, expect } from "vitest";
import { createGame } from "@/game";
import { citizensMode, citizensModeWith } from "@/modes/citizens";
import { workparking } from "@/levels/test/scenarios/workparking";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { threecities } from "@/levels/test/scenarios/threecities";
import {
  deriveWorkplaceParking,
  workplaceParkingTiles,
  STAFF_BAYS_PER_PLOT,
} from "@/tiles/workplaceParking";
import { levelBounds } from "@/tiles/bounds";
import { facilitiesOf, rowsOf, validateParking } from "@/tiles/parking";
import { plotsOf } from "@/tiles/cities";
import type { Level } from "@/tiles/model";

// WORKPLACE PARKING — the commuter's car has to stop somewhere.
//
// Two halves, and the tests are split the same way:
//  1. The DERIVATION (`tiles/workplaceParking.ts`): staff bays appear at a
//     works' gate because the map says "industry", not because anyone drew them.
//  2. The MECHANIC: a driving citizen takes one of those bays, HOLDS it for the
//     working day, and comes back for the same car.
//
// Design: docs/superpowers/specs/2026-08-04-workplace-parking-design.md

function newGame(scenario = workparking, tuning?: Parameters<typeof citizensModeWith>[0]) {
  return createGame(
    scenario.level,
    [],
    200,
    tuning ? citizensModeWith(tuning) : citizensMode,
    1,
    scenario.colors,
    scenario.traffic,
    scenario.id,
  );
}

function run(game: ReturnType<typeof createGame>, seconds: number, onTick?: () => void) {
  for (let t = 0; t < seconds; t += 0.2) {
    game.advance(0.2);
    onTick?.();
  }
}

function parkingIssues(level: Level) {
  const g = levelBounds(level);
  return validateParking(level, 200, { cols: g.cols, rows: g.rows });
}

describe("staff parking is derived from the map", () => {
  it("gives a works a rank at its gate and leaves the houses alone", () => {
    const tiles = workplaceParkingTiles(citizencars.level);
    expect(tiles.length).toBeGreaterThan(0);
    const next = deriveWorkplaceParking(citizencars.level);
    const plots = new Map(plotsOf(citizencars.level).map(p => [p.id, p.kind]));

    // Every rank faces a workplace. Nobody's house gets a car park outside it:
    // the resident's car is at WORK all day, which is the whole mode.
    for (const tileId of tiles) {
      const [x, y] = tileId.split(",").map(Number);
      const neighbours = [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`];
      const kinds = neighbours.map(id => plots.get(id)).filter(Boolean);
      expect(kinds.some(k => k === "work" || k === "shop")).toBe(true);
    }
    // Three bays per rank — a works that employs twelve to ninety-six. That
    // shortfall is the mechanic, so it is worth pinning.
    for (const tileId of tiles) {
      for (const row of rowsOf(next[tileId])) {
        expect(row.count).toBe(STAFF_BAYS_PER_PLOT);
      }
    }
  });

  it("ships nothing the parking validator would reject", () => {
    for (const level of [citizencars.level, threecities.level, workparking.level]) {
      expect(parkingIssues(deriveWorkplaceParking(level))).toEqual([]);
    }
  });

  it("is idempotent — running it twice lays no second rank", () => {
    const once = deriveWorkplaceParking(citizencars.level);
    const twice = deriveWorkplaceParking(once);
    const stalls = (l: Level) =>
      facilitiesOf(l).reduce((n, f) => n + f.stalls.length, 0);
    expect(stalls(twice)).toBe(stalls(once));
  });

  it("does nothing to a board with no roads", () => {
    // `threecities` is deliberately road-free — rail is the only way across it.
    // A pass that invented parking there would be inventing a street too.
    expect(workplaceParkingTiles(threecities.level)).toEqual([]);
  });

  it("paints the American street unmarked and keeps the bays underneath", () => {
    const marked = deriveWorkplaceParking(citizencars.level);
    const plain = deriveWorkplaceParking(citizencars.level, { marking: "none" });
    const tiles = workplaceParkingTiles(citizencars.level);
    for (const id of tiles) {
      const a = rowsOf(marked[id])[0];
      const b = rowsOf(plain[id])[0];
      // Same parking — same kind, same count, same approach. Only the paint.
      expect({ ...a, marking: undefined }).toEqual({ ...b, marking: undefined });
      expect(b.marking).toBe("none");
    }
    expect(parkingIssues(plain)).toEqual([]);
  });
});

describe("a commuter's car takes a space and holds it", () => {
  it("parks at the works and is still standing there while its owner works", () => {
    const game = newGame();
    let peakParked = 0;
    run(game, 900, () => {
      peakParked = Math.max(peakParked, game.citizenStats.carsParked);
    });
    // Somebody's car is in a real bay — not deleted on arrival, not a timer.
    //
    // NOTE WHICH OBSERVABLE. `game.parkingOccupancy` is a RENDER mirror, filled
    // in `frame()`, so it is empty for ever in a headless run and a test written
    // against it passes vacuously. `carsParked` is counted in `advance()`, which
    // is where model state belongs.
    expect(peakParked).toBeGreaterThan(0);
  });

  it("never holds more cars than there are bays", () => {
    const game = newGame();
    const capacity = facilitiesOf(workparking.level).reduce(
      (n, f) => n + f.stalls.length,
      0,
    );
    let peak = 0;
    run(game, 900, () => {
      peak = Math.max(peak, game.citizenStats.carsParked);
    });
    expect(peak).toBeLessThanOrEqual(capacity);
  });

  it("hands the bay back — a day's commuting is a CYCLE, not a sink", () => {
    // The failure this is really about: a car that parks and never leaves
    // silently converts every bay on the board into a permanent obstacle, and
    // the board still looks fine for the first few minutes. Watching the same
    // stall change hands is the only thing that tells the two apart.
    // COUNT THE CARS PARKED AWAY FROM HOME, not every parked car. `carsParked`
    // includes the one standing in its owner's own drive, and since life stages
    // landed there is no longer a moment when every household's car is out at
    // once — the shift worker's car is at home while the day worker's is at the
    // works, and then the other way round. Measured here: the total never falls
    // below 1, while the away-from-home count peaks at 9 and still returns to 0.
    // The bay cycle is intact; the old gauge just stopped being able to see it.
    const game = newGame(workparking, { secPerDay: 240 });
    let peak = 0;
    let everEmptiedAfterUse = false;
    run(game, 1600, () => {
      const held = game.citizenStats.carsParked - game.citizenStats.carsAtHome;
      peak = Math.max(peak, held);
      if (peak > 0 && held === 0) everEmptiedAfterUse = true;
    });
    expect(peak).toBeGreaterThan(0);
    expect(everEmptiedAfterUse).toBe(true);
    // And nobody was stranded by it: journeys still finish.
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(10);
  });

  it("still gets everyone to work when the bays run out", () => {
    // THE RULE THAT MATTERS: a saturated network SLOWS people, it never strands
    // them. Three bays against a works full of drivers means most arrivals find
    // nothing — and every one of them still completes the journey.
    const game = newGame();
    run(game, 900);
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(20);
    const share = game.citizenStats.modeShare;
    expect(share.car).toBeGreaterThan(0.3);
  });
});
