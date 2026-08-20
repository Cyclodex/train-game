import { describe, it, expect } from "vitest";
import { itSlow } from "./support/tier";
import { createGame } from "@/game";
import { citizensMode, citizensModeWith } from "@/modes/citizens";
import { homeparking } from "@/levels/test/scenarios/homeparking";
import { workparking } from "@/levels/test/scenarios/workparking";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { threecities } from "@/levels/test/scenarios/threecities";
import { deriveHomeParking, homeDriveTiles, DRIVE_SPACES } from "@/tiles/homeParking";
import { levelBounds } from "@/tiles/bounds";
import { facilitiesOf, rowsOf, validateParking, stallId } from "@/tiles/parking";
import { createParkingRegistry } from "@/sim/parking";
import { plotsOf } from "@/tiles/cities";
import type { Level } from "@/tiles/model";

// HOME PARKING — where the car sleeps.
//
// The other half of `workplaceParking.spec.ts`. That one pins the day: a
// commuter's car stops at the works and holds a bay while its owner is at their
// desk. This one pins the night, and the fact the model used to assume without
// modelling — that a house has a drive, that it is the household's own, and that
// it is not big enough for ever.
//
// Split the way the feature is:
//  1. The DERIVATION (`tiles/homeParking.ts`): a drive appears at a house
//     because the map says "somebody lives here", not because anyone drew it.
//  2. PRIVACY: it belongs to that address. This is the part that makes it a
//     drive rather than two more public spaces, and it is invisible from the
//     outside unless a test asks two different drivers the same question.
//  3. The MECHANIC: the car really stands on it overnight and really leaves in
//     the morning — a cycle, not a sink.
//
// Design: docs/superpowers/specs/2026-08-05-home-parking-design.md

function newGame(scenario = homeparking, tuning?: Parameters<typeof citizensModeWith>[0]) {
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

function stallCount(level: Level): number {
  return facilitiesOf(level).reduce((n, f) => n + f.stalls.length, 0);
}

describe("a drive is derived at every house", () => {
  it("gives houses a drive and workplaces none", () => {
    const drives = homeDriveTiles(citizencars.level);
    expect(Object.keys(drives).length).toBeGreaterThan(0);
    const kinds = new Map(plotsOf(citizencars.level).map(p => [p.id, p.kind]));
    // Every drive belongs to a HOME. A works gets a staff forecourt from the
    // other pass and a shop gets one too; neither gets somebody's hardstanding,
    // because a factory does not live anywhere.
    for (const address of Object.keys(drives)) {
      expect(kinds.get(address)).toBe("home");
    }
  });

  it("gives each house ONE drive, however many streets it fronts onto", () => {
    const level = deriveHomeParking(citizencars.level);
    const perAddress = new Map<string, number>();
    for (const tileId of Object.keys(level)) {
      for (const row of rowsOf(level[tileId])) {
        if (!row.resident) continue;
        perAddress.set(row.resident, (perAddress.get(row.resident) ?? 0) + 1);
      }
    }
    expect(perAddress.size).toBeGreaterThan(0);
    // A corner plot with a street on two sides is still one household. Laying a
    // rank on each frontage would quietly hand it four spaces while the house
    // next door got two.
    for (const [, n] of perAddress) expect(n).toBe(1);
  });

  it("makes the drive two spaces wide — the number the gradient hangs off", () => {
    const level = deriveHomeParking(citizencars.level);
    for (const tileId of Object.keys(level)) {
      for (const row of rowsOf(level[tileId])) {
        if (row.resident) expect(row.count).toBe(DRIVE_SPACES);
      }
    }
  });

  it("lets two houses share one road tile, each on its own kerb", () => {
    // The east run of `/test/homeparking` has a house either side of it. Both
    // get a drive on the same tile and they are not the same tarmac — which is
    // the case a facility-level permit could not have expressed, and the reason
    // ownership is a property of the ROW.
    const shared = Object.entries(homeparking.level).filter(
      ([, cell]) => rowsOf(cell).filter(r => r.resident).length > 1,
    );
    expect(shared.length).toBeGreaterThan(0);
    for (const [, cell] of shared) {
      const rows = rowsOf(cell).filter(r => r.resident);
      expect(new Set(rows.map(r => r.resident)).size).toBe(rows.length);
    }
  });

  it("ships nothing the parking validator would reject", () => {
    for (const level of [citizencars.level, workparking.level, homeparking.level]) {
      expect(parkingIssues(deriveHomeParking(level))).toEqual([]);
    }
  });

  it("is idempotent — running it twice lays no second drive", () => {
    const once = deriveHomeParking(citizencars.level);
    expect(stallCount(deriveHomeParking(once))).toBe(stallCount(once));
  });

  it("leaves a board with no roads alone", () => {
    // `threecities` is deliberately road-free. A drive there would be inventing
    // the street it runs onto.
    expect(homeDriveTiles(threecities.level)).toEqual({});
  });

  it("never takes a bank an earlier pass has already spent", () => {
    // The staff forecourts go down first on `/test/homeparking`. A drive that
    // overwrote one would silently delete a workplace's parking — and the two
    // passes have no idea the other exists, so only the bank check stops it.
    const rows = Object.values(homeparking.level).flatMap(c => rowsOf(c));
    expect(rows.some(r => r.resident)).toBe(true);
    expect(rows.some(r => !r.resident)).toBe(true);
    expect(parkingIssues(homeparking.level)).toEqual([]);
  });
});

describe("a drive belongs to its address and to nobody else", () => {
  const level = homeparking.level;
  const registry = () => createParkingRegistry(level, 0.19, 200);

  function aDrive(): { tileId: string; from: number; address: string } {
    for (const tileId of Object.keys(level).sort()) {
      for (const row of rowsOf(level[tileId])) {
        if (row.resident) return { tileId, from: row.from, address: row.resident };
      }
    }
    throw new Error("no drive on the board");
  }

  it("is invisible to a driver with no permit", () => {
    const { tileId, from } = aDrive();
    const p = registry();
    // A passing car sees a street it cannot stop on. This is the whole
    // difference between a drive and two more public bays, and nothing else in
    // the model would have said so — the space is empty, and it fits.
    expect(p.pickStallOn(tileId, from, "car", "stranger")).toBeNull();
  });

  it("opens to the household that owns it", () => {
    const { tileId, from, address } = aDrive();
    const p = registry();
    const ref = p.pickStallOn(tileId, from, "car", "resident", 0, address);
    expect(ref).not.toBeNull();
    expect(ref!.tileId).toBe(tileId);
  });

  it("stays shut to the NEIGHBOUR, who also has a permit", () => {
    // The sharper half of the same rule. "Has a permit" is not the question —
    // a town of drives would otherwise be one big car park for everybody who
    // lives in it.
    const { tileId, from, address } = aDrive();
    const other = Object.values(homeDriveTiles(homeparking.level));
    expect(other.length).toBeGreaterThan(1);
    const neighbour = Object.keys(homeDriveTiles(homeparking.level)).find(a => a !== address);
    const p = registry();
    expect(p.pickStallOn(tileId, from, "car", "resident", 0, neighbour)).toBeNull();
  });

  it("counts as capacity only for the household", () => {
    const { tileId, address } = aDrive();
    const p = registry();
    const facility = p.facilityOfTile(tileId)!;
    // Same facility, same tick, two answers — because a street of houses IS full
    // to a stranger and empty to the people who live there, and the router has
    // to be able to see both or it sends every passing car onto a drive.
    expect(p.freeCount(facility, "car", address)).toBeGreaterThan(
      p.freeCount(facility, "car"),
    );
  });

  it("hands a claimed drive back when the car goes", () => {
    const { tileId, from, address } = aDrive();
    const p = registry();
    const ref = p.pickStallOn(tileId, from, "car", "resident", 0, address)!;
    expect(p.claim(ref, "car1")).toBe(true);
    expect(p.claim(ref, "car2")).toBe(false);
    expect(p.occupancy()[stallId(ref)]).toBe("car1");
    p.release(ref);
    expect(p.pickStallOn(tileId, from, "car", "resident", 0, address)).not.toBeNull();
  });
});

describe("the car really sleeps at home", () => {
  itSlow("stands on its owner's own drive overnight", () => {
    const game = newGame(homeparking, { secPerDay: 240 });
    let peakAtHome = 0;
    run(game, 1200, () => {
      peakAtHome = Math.max(peakAtHome, game.citizenStats.carsAtHome);
    });
    // NOTE WHICH OBSERVABLE. `game.parkingOccupancy` is a RENDER mirror filled in
    // `frame()`, so it is empty for ever in a headless run and a test written
    // against it passes vacuously. `carsAtHome` is counted in `advance()`.
    expect(peakAtHome).toBeGreaterThan(0);
  });

  itSlow("swings between home and work across a day — the cycle, not a sink", () => {
    // THE FAILURE THIS IS REALLY ABOUT. A car that parks and never leaves turns
    // every space on the board into a permanent obstacle, and the board still
    // looks fine for the first few minutes. Only seeing the SAME population of
    // cars at both ends of the day tells the two apart: a town whose cars are on
    // its drives at 03:00 and at its workplaces at 11:00 is working, and one
    // where `carsAtHome` only ever climbs is the old bug wearing a new hat.
    const game = newGame(homeparking, { secPerDay: 240 });
    let mostlyHome = false;
    let mostlyAway = false;
    run(game, 1400, () => {
      const { carsParked, carsAtHome } = game.citizenStats;
      if (carsParked >= 4 && carsAtHome === carsParked) mostlyHome = true;
      if (carsParked >= 4 && carsAtHome * 2 < carsParked) mostlyAway = true;
    });
    expect(mostlyHome).toBe(true);
    expect(mostlyAway).toBe(true);
  });

  itSlow("never holds more cars than the board has spaces", () => {
    const game = newGame();
    const capacity = stallCount(homeparking.level);
    let peak = 0;
    run(game, 900, () => {
      peak = Math.max(peak, game.citizenStats.carsParked);
    });
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(capacity);
  });

  itSlow("still gets everybody home when the drives are full", () => {
    // THE RULE THAT MATTERS, and it is the same one the workplace half lives
    // under: a saturated network SLOWS people, it never strands them. A house
    // holds up to thirty-two people and its drive holds two, so most evenings
    // most drivers find it full — and every one of them still completes the
    // journey.
    const game = newGame();
    run(game, 900);
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(20);
    expect(game.citizenStats.modeShare.car).toBeGreaterThan(0.1);
  });

  itSlow("does not empty the workplace forecourts overnight", () => {
    // The regression fence. Letting residents park anywhere at night, on a board
    // whose only bays were a works' own forecourt, silently converted every
    // space on the map into permanent resident parking — measured at 12 of 12
    // held at 03:00, rising to the cap over four days, after which no commuter
    // could ever park again.
    //
    // What makes it safe now is not that residents keep off public bays — they
    // do use them, which is what a street with no drives really looks like — but
    // that they GIVE THEM BACK every morning. So the thing to pin is the trough:
    // there is a time of day when hardly anybody's car is at home, and the bays
    // are available to whoever wants them.
    const game = newGame(workparking, { secPerDay: 240 });
    let peakAtHome = 0;
    let troughAfterPeak = Number.POSITIVE_INFINITY;
    run(game, 1600, () => {
      const atHome = game.citizenStats.carsAtHome;
      peakAtHome = Math.max(peakAtHome, atHome);
      if (peakAtHome >= 4) troughAfterPeak = Math.min(troughAfterPeak, atHome);
    });
    expect(peakAtHome).toBeGreaterThanOrEqual(4);
    expect(troughAfterPeak).toBeLessThanOrEqual(1);
    // ...and the board kept working while it did it.
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(100);
  });
});
