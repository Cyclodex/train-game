import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { twoWay, oneWayLanes } from "@/tiles/lanes";
import type { Level, TileCell } from "@/tiles/model";
import { deriveWorkplaceParking } from "@/tiles/workplaceParking";
import {
  deriveWorkplaceBikeRacks,
  workplaceBikeRackTiles,
  BIKE_STANDS_PER_PLOT,
  RACK_DWELL_SEC,
} from "@/tiles/workplaceBikeRacks";
import { levelBounds } from "@/tiles/bounds";
import { bankOf, facilitiesOf, rowsOf, validateParking } from "@/tiles/parking";
import { citizensMode } from "@/modes/citizens";

// WORKPLACE BIKE RACKS — the bike half of the forecourt ladder.
//
// The car pass (`workplaceParking.ts`) gives every works three staff bays that
// fill the gate kerb edge to edge; this pass gives it six bike stands, and the
// tests pin the four properties that make it a mechanic rather than scenery:
// the count (deliberately short of the workforce), the placement (it yields the
// gate kerb to the car bays and lands one tile along the same bank), the
// discipline (idempotent, and a row the validator rejects is dropped rather
// than shipped), and the ambient dwell that lets road-sim riders use it.
//
// Design: docs/superpowers/specs/2026-08-21-bike-destination-parking-design.md

const street = (): TileCell => ({
  connections: [],
  road: twoWay(Position.Left, Position.Right),
});
const works = (): TileCell => ({
  connections: [],
  terrain: "industry",
  city: "veloworks",
});

// One works on a plain 1+1 street: the reference gate. The works stands NORTH
// of "3,1", so its kerb is that tile's Top bank.
function gateBoard(): Level {
  const level: Level = {};
  for (let x = 0; x <= 6; x++) level[`${x},1`] = street();
  level["3,0"] = works();
  return level;
}

function parkingIssues(level: Level) {
  const g = levelBounds(level);
  return validateParking(level, 200, { cols: g.cols, rows: g.rows });
}

describe("a works grows a mini-rack at its gate", () => {
  it("derives six stands on the frontage kerb", () => {
    const base = gateBoard();
    expect(workplaceBikeRackTiles(base)).toEqual(["3,1"]);
    const next = deriveWorkplaceBikeRacks(base);
    const rack = rowsOf(next["3,1"]).find(r => r.kind === "bikerack");
    expect(rack).toBeDefined();
    // SIX, not the 16 a full rack tile holds: the gap to the workforce is the
    // mechanic, exactly as the three car bays are.
    expect(rack!.count).toBe(BIKE_STANDS_PER_PLOT);
    // On the kerb the works stands behind.
    expect(bankOf(rack!)).toBe(Position.Top);
    expect(parkingIssues(next)).toEqual([]);
  });

  it("yields the gate kerb to the staff car bays and lands one tile along", () => {
    // The car pass first — three parallel bays fill "3,1"'s Top bank edge to
    // edge — then the rack pass, which must NOT stack a second row on that
    // bank. It steps to the neighbouring tile of the same kerb run instead.
    const withCars = deriveWorkplaceParking(gateBoard());
    const next = deriveWorkplaceBikeRacks(withCars);
    expect(workplaceBikeRackTiles(withCars)).toEqual(["4,1"]);
    // The gate tile keeps exactly the car rank it had.
    const gateRows = rowsOf(next["3,1"]);
    expect(gateRows).toHaveLength(1);
    expect(gateRows[0].kind).toBe("parallel");
    // The rack stands on the next tile down the SAME kerb.
    const rack = rowsOf(next["4,1"]).find(r => r.kind === "bikerack");
    expect(rack).toBeDefined();
    expect(bankOf(rack!)).toBe(Position.Top);
    // No tile carries two rows on one bank, and the validator agrees.
    for (const id of Object.keys(next)) {
      const banks = rowsOf(next[id]).map(bankOf);
      expect(new Set(banks).size).toBe(banks.length);
    }
    expect(parkingIssues(next)).toEqual([]);
  });

  it("is idempotent — a second run adds nothing and returns the same level", () => {
    const once = deriveWorkplaceBikeRacks(deriveWorkplaceParking(gateBoard()));
    const twice = deriveWorkplaceBikeRacks(once);
    // Same OBJECT, not merely the same counts: the pass promises to hand back
    // the untouched level when there is nothing to lay.
    expect(twice).toBe(once);
    const stalls = (l: Level) => facilitiesOf(l).reduce((n, f) => n + f.stalls.length, 0);
    expect(stalls(twice)).toBe(stalls(once));
  });

  it("drops a row the validator rejects instead of shipping it", () => {
    // A 3+3 boulevard: the kerb sits 84px out, so a rack's stands (18px deep)
    // would overhang the tile — `validateParking` objects, and the pass must
    // back its row out rather than ship it.
    const boulevard = (): TileCell => ({
      connections: [],
      road: [
        ...oneWayLanes(Position.Left, Position.Right, 3),
        ...oneWayLanes(Position.Right, Position.Left, 3),
      ],
    });
    const level: Level = {};
    for (let x = 0; x <= 4; x++) level[`${x},1`] = boulevard();
    level["2,0"] = works();
    expect(workplaceBikeRackTiles(level)).toEqual([]);
    expect(deriveWorkplaceBikeRacks(level)).toBe(level);
  });

  it("sets an ambient dwell so road-sim riders use the stands too", () => {
    const next = deriveWorkplaceBikeRacks(gateBoard());
    expect(next["3,1"].parking?.dwellSec).toEqual(RACK_DWELL_SEC);
    expect(next["3,1"].parking?.label).toBe("Bike stands");
  });

  it("leaves boards with no works, or a works with no frontage, untouched", () => {
    const bare: Level = { "0,1": street(), "1,1": street() };
    expect(deriveWorkplaceBikeRacks(bare)).toBe(bare);
    const landlocked: Level = { "3,0": works() };
    expect(deriveWorkplaceBikeRacks(landlocked)).toBe(landlocked);
  });
});

describe("the citizens mode derives the ladder at setup", () => {
  it("hands /play a board with the staff bays AND the mini-rack", () => {
    const base = gateBoard();
    const setup = citizensMode.setup({ level: base, trains: [], levelId: "t" });
    // Car bays on the gate kerb, rack one tile along — the same ladder the
    // scenarios lay in their own data.
    expect(rowsOf(setup.level["3,1"]).some(r => r.kind === "parallel")).toBe(true);
    expect(rowsOf(setup.level["4,1"]).some(r => r.kind === "bikerack")).toBe(true);
    // Pure: the board the caller handed in is not mutated.
    expect(rowsOf(base["3,1"])).toEqual([]);
    expect(rowsOf(base["4,1"])).toEqual([]);
  });
});
