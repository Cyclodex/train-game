import { describe, it, expect } from "vitest";
import { itSlow } from "./support/tier";
import { createRoadSim } from "@/sim/road";
import { homeparking } from "@/levels/test/scenarios/homeparking";
import { workparking } from "@/levels/test/scenarios/workparking";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { cyclelane } from "@/levels/test/scenarios/cyclelane";
import { cycleoneway } from "@/levels/test/scenarios/cycleoneway";
import { widestreet } from "@/levels/test/scenarios/widestreet";
import { deriveKerbOverflow, kerbOverflowTiles, KERB_SPACES } from "@/tiles/kerbOverflow";
import { levelBounds } from "@/tiles/bounds";
import {
  rowsOf,
  validateParking,
  facilitiesOf,
  bankOf,
  rowFor,
  stallPose,
  stallDepthPx,
  type ParkingRow,
} from "@/tiles/parking";
import { createParkingRegistry, stallFits } from "@/sim/parking";
import { pavementOffsetEndsFor, pavementPaths, roadThrough } from "@/tiles/footway";
import { twoWay } from "@/tiles/lanes";
import { buildCitizenWorld, plotsOf } from "@/tiles/cities";
import { parkingApronPath, stallOutlinePath, parkingKerbPath } from "@/tiles/parkingGeometry";
import { Position } from "@/types";
import type { Level } from "@/tiles/model";

// THE EDGE OF THE ROAD — what happens to the driver who finds everything full.
//
// The behaviour this replaces was the worst kind of bug: not wrong numbers, but
// a car POPPING OUT OF EXISTENCE in the middle of the street. A commuter with
// nowhere to park was dispatched to the address as an ordinary trip and
// `settleRequestedTrips` retired it half a tile in.
//
// Measured on a saturated `/test/homeparking`, dispatching commuters at every
// house toward the works:
//
//     cars dispatched      8      15      30
//     vanished, before     1       2      12
//     vanished, after      0       0       1   (+4 never dispatched at all)
//
// The three tiers of the fix are the three groups below: the kerb exists, it is
// invisible to anyone with an alternative, and a driver with no alternative at
// all does not set off.

function parkingIssues(level: Level) {
  const g = levelBounds(level);
  return validateParking(level, 200, { cols: g.cols, rows: g.rows });
}

function informalRows(level: Level) {
  return Object.entries(level).flatMap(([id, cell]) =>
    rowsOf(cell)
      .filter(r => r.informal)
      .map(r => ({ id, row: r })),
  );
}

const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });

// A street in from the left map edge that STOPS inside the map — the shape
// `openingInsideLot` (sim/road.ts) mistakes for the end of a car-park aisle.
function stubStreet(): Level {
  return { "0,1": street(), "1,1": street(), "2,1": street(), "3,1": street() };
}
const STUB_W = 6;
const STUB_H = 3;

// The tiles cars are actually seen appearing on, which is the only honest way to
// ask what the sim's spawn pool ended up containing: `roadEntries` is the raw
// list BEFORE `createRoadSim` filters it, so asking it about parking can only
// ever answer "unchanged".
function spawnTiles(level: Level): string[] {
  const s = createRoadSim({ level, width: STUB_W, height: STUB_H, seed: 5 });
  const seen = new Set<string>();
  const known = new Set<string>();
  for (let t = 0; t < 120; t += 0.2) {
    s.step(0.2, () => false);
    for (const c of s.cars()) {
      if (known.has(c.id)) continue;
      known.add(c.id);
      seen.add(c.tileId);
    }
  }
  return [...seen].sort();
}

describe("the kerb is derived from the street", () => {
  it("lays space on ordinary straights and nowhere else", () => {
    const tiles = kerbOverflowTiles(citizencars.level);
    expect(tiles.length).toBeGreaterThan(0);
    const next = deriveKerbOverflow(citizencars.level);
    for (const { row } of informalRows(next)) {
      // Kerbside, two spaces, no paint. Anything else is a bay, which this is
      // deliberately not.
      expect(row.kind).toBe("parallel");
      expect(row.count).toBe(KERB_SPACES);
      expect(row.marking).toBe("none");
    }
  });

  it("ships nothing the parking validator would reject", () => {
    for (const level of [citizencars.level, workparking.level, homeparking.level]) {
      expect(parkingIssues(deriveKerbOverflow(level))).toEqual([]);
    }
  });

  it("is idempotent — running it twice lays no second stretch", () => {
    const once = deriveKerbOverflow(citizencars.level);
    expect(informalRows(deriveKerbOverflow(once)).length).toBe(informalRows(once).length);
  });

  it("never puts two rows on one kerb", () => {
    // It runs LAST, after the forecourts and the drives, and takes only the
    // banks they left. Two rows on one bank is the aliasing bug that paints two
    // sets of spaces onto one strip of tarmac and counts every car space twice —
    // and with this pass touching nearly every street, it is the failure mode
    // with the most chances to happen.
    for (const [tileId, cell] of Object.entries(homeparking.level)) {
      const banks = rowsOf(cell).map(r => bankOf(r));
      expect(new Set(banks).size, `two rows share a kerb on ${tileId}`).toBe(banks.length);
    }
    // ...and a drive laid before it is still there afterwards.
    const drives = Object.values(homeparking.level).flatMap(c =>
      rowsOf(c).filter(r => r.resident),
    );
    expect(drives.length).toBeGreaterThan(0);
  });

  it("keeps off the bike's kerb — a cycle lane's bank grows no informal space", () => {
    // #87 paints a half-width cycle strip on the kerb side of its stream and
    // rides its bikes there; a car left on that bank would stand ON the cycle
    // lane, and a car pulling in would cut across it. The `cyclelane` street
    // has a green strip both ways, so BOTH banks are the bikes' and the pass
    // changes the scenario not at all.
    expect(kerbOverflowTiles(cyclelane.level)).toEqual([]);
    expect(deriveKerbOverflow(cyclelane.level)).toEqual(cyclelane.level);
    // A wide street's unmarked SHOULDER (#106) is ridden exactly like a cycle
    // lane — `bikeLaneIndices` covers both — so a widestreet grows no informal
    // space either. Guarding only kind "cycle" was the gap the review flagged
    // once wide streets landed: a car on the shoulder is a car on the bikes.
    expect(kerbOverflowTiles(widestreet.level)).toEqual([]);
    // Per BANK, not per tile: the one-way's kerb side (right of travel,
    // Bottom) is green, but its far bank is legitimate kerb and keeps its
    // spaces — blanket-skipping the tile would have thrown that kerb away.
    const next = deriveKerbOverflow(cycleoneway.level);
    const laid = informalRows(next);
    expect(laid.length).toBeGreaterThan(0);
    for (const { id, row } of laid) {
      expect(bankOf(row), `informal kerb on the cycle lane's bank at ${id}`).toBe(Position.Top);
    }
  });

  it("stands an informal car HALF ON THE KERB, never out in a phantom bay", () => {
    // A painted parallel bay is a widening of the street: its stall centres
    // depth/2 beyond the kerb, and the pavement moves out behind it. Informal
    // kerb paints nothing and moves nothing — centring its car a bay-depth out
    // stood it squarely ON the pavement band (the report). It now centres on
    // the kerb line itself: half on the kerb, half in the lane, like a real
    // car left on an unmarked street. Moving traffic eases around the
    // protruding half (game.ts's squeeze, capped at the centreline).
    const base: ParkingRow = {
      from: Position.Left,
      side: "right",
      kind: "parallel",
      count: 2,
      marking: "none",
    };
    const kerb = 28;
    const informal = stallPose({ ...base, informal: true }, 0, 200, kerb);
    const bay = stallPose(base, 0, 200, kerb);
    // Right of eastbound travel is the Bottom bank: lateral is +y from mid.
    expect(informal.y).toBeCloseTo(100 + kerb, 6);
    expect(bay.y).toBeCloseTo(100 + kerb + stallDepthPx("parallel", 200) / 2, 6);
  });

  it("keeps off a road opening that stops inside the map, so it still spawns", () => {
    // `openingInsideLot` (sim/road.ts) treats any opening on a parking tile as
    // being INSIDE a car park rather than a way off the map, and refuses to
    // spawn or despawn there. This pass touches nearly every street, so a stub
    // it parked on would silently go quiet — and on a board whose traffic
    // enters at a stub, that is the whole board's traffic.
    //
    // ASKED THROUGH THE SIM, because that is where the filter lives. Comparing
    // `roadEntries` before and after is no test at all: it never reads parking,
    // so it returns the same list whatever this pass does.
    const base = stubStreet();
    const withKerb = deriveKerbOverflow(base);
    // The stub tile is the one the pass has to leave alone...
    expect(rowsOf(withKerb["3,1"]).length).toBe(0);
    // ...and the rest of the street is not, or the guard would be vacuous.
    expect(informalRows(withKerb).length).toBeGreaterThan(0);
    // ...so cars still enter the map there.
    const tiles = spawnTiles(withKerb);
    expect(tiles).toContain("3,1");
    expect(tiles).toEqual(spawnTiles(base));
  });
});

describe("the kerb is invisible to anyone with an alternative", () => {
  const level = homeparking.level;

  it("is not paint — it draws no apron, no lines, no kerb", () => {
    // The reason this matters beyond looks: the pass touches nearly every
    // street, so a row that painted itself would make every road on every board
    // appear to have been widened.
    const [{ row }] = informalRows(level);
    expect(parkingApronPath(row, 200, 28)).toBe("");
    expect(stallOutlinePath(row, 0, 200, 28)).toBe("");
    expect(parkingKerbPath(row, 200, 28)).toBe("");
  });

  it("is closed to a driver who has not asked for it", () => {
    const [{ row }] = informalRows(level);
    expect(stallFits("car", row, 0.19, 200)).toBe(false);
    expect(stallFits("car", row, 0.19, 200, null, true)).toBe(true);
  });

  it("moves no pavement — the band still hugs the same kerb", () => {
    // A REAL bay pushes its bank's pavement out behind it, so people walk
    // behind the parked cars instead of over them (`parkingOutsetUnits` in
    // tiles/footway.ts). Bare kerb must do NOTHING of the sort: this pass
    // touches nearly every street, so counting it detached the pavement from
    // the carriageway BOARD-WIDE — grey ribbons floating a car's width out in
    // the verge, on streets with no visible parking on them at all.
    //
    // Both callers are asked, because paint and people disagreeing is people
    // walking beside the pavement rather than on it.
    const base = citizencars.level;
    const withKerb = deriveKerbOverflow(base);
    expect(informalRows(withKerb).length).toBeGreaterThan(0);
    for (const id of Object.keys(base)) {
      const through = roadThrough(base[id]);
      if (!through) continue;
      for (const side of [1, -1] as const) {
        // Both ends, because the walkers now taper between the seam-agreed
        // values — bare kerb must move neither of them.
        expect(
          pavementOffsetEndsFor(withKerb, id, side, through.from, through.to),
          `the walkers' pavement on ${id} moved`,
        ).toEqual(pavementOffsetEndsFor(base, id, side, through.from, through.to));
      }
      expect(pavementPaths(withKerb, id), `the painted pavement on ${id} moved`).toBe(
        pavementPaths(base, id),
      );
    }
  });

  it("counts as no capacity at all, so nothing signs it", () => {
    const p = createParkingRegistry(level, 0.19, 200);
    const [{ id }] = informalRows(level);
    const facility = p.facilityOfTile(id)!;
    // A tile of bare kerb reports zero — which is what stops `parkingStatus`
    // signing it "P VOLL", and what keeps it out of the router's first choice.
    expect(p.capacity(facility, "car")).toBe(0);
    expect(p.freeCount(facility, "car", null, true)).toBeGreaterThan(0);
  });

  it("is never what ambient traffic aims at", () => {
    // Ambient cars park at `PARKING.fraction`, and they plan through
    // `planParkingTrip`, which never passes the informal flag. If that ever
    // changed, every street on every board would fill with parked traffic.
    //
    // ASKED ON A BOARD WHERE AMBIENT CARS ACTUALLY SPAWN AND ACTUALLY PARK:
    // an open street with one small car park, `parkFraction: 1` so every car
    // that enters is looking for a space, and bare kerb laid down the rest of
    // it. Run on the closed ring instead, this compared nothing to nothing.
    const base: Level = {
      "0,1": street(),
      "1,1": street(),
      "2,1": street(),
      "3,1": {
        ...street(),
        parking: {
          facility: "P",
          rows: [
            { from: Position.Left, side: "right", kind: "perpendicular", count: 2 },
          ],
        },
      },
      "4,1": street(),
      "5,1": street(),
      "6,1": street(),
    };
    const level = deriveKerbOverflow(base);
    expect(informalRows(level).length).toBeGreaterThan(0);
    const s = createRoadSim({ level, width: 7, height: 3, seed: 3, parkFraction: 1 });
    let everParked = 0;
    for (let t = 0; t < 300; t += 0.2) {
      s.step(0.2, () => false);
      for (const key of Object.keys(s.parkingOccupancy())) {
        const [tileId, from, side, index] = key.split("|");
        const row = rowFor(level[tileId], {
          tileId,
          from: Number(from) as Position,
          side: side as "right" | "left",
          index: Number(index),
        });
        expect(row, `no such stall as ${key}`).toBeDefined();
        // THE HEADLINE: a car that nobody asked to leave at the roadside never
        // ends up there.
        expect(row!.informal ?? false, `an ambient car parked on bare kerb (${key})`).toBe(
          false,
        );
        everParked++;
      }
    }
    // ...and it really did park somewhere, so the loop above is not vacuous.
    expect(everParked).toBeGreaterThan(0);
  });
});

describe("a car with nowhere to go does not vanish", () => {
  const LEVEL = homeparking.level;
  const W = homeparking.size!.cols;
  const H = homeparking.size!.rows;
  const world = buildCitizenWorld(LEVEL);
  const roadTileOf = (id: string) => world.plots.find(p => p.id === id)?.roadTile ?? null;

  // Everybody drives to the works at once — far more cars than it has bays.
  function rush(rounds: number) {
    const s = createRoadSim({ level: LEVEL, width: W, height: H, seed: 1 });
    const plots = plotsOf(LEVEL, 1);
    const homes = plots.filter(p => p.kind === "home").map(p => p.id);
    const worksTile = roadTileOf(plots.find(p => p.kind === "work")!.id)!;
    const ids: string[] = [];
    let refused = 0;
    for (let round = 0; round < rounds; round++) {
      for (const h of homes) {
        const from = roadTileOf(h);
        if (!from || from === worksTile) continue;
        const id = s.requestTrip(from, worksTile, "car", { park: true });
        if (id) ids.push(id);
        else refused++;
        for (let k = 0; k < 15; k++) s.step(0.2, () => false);
      }
    }
    for (let t = 0; t < 600; t += 0.2) s.step(0.2, () => false);
    let parked = 0;
    let vanished = 0;
    for (const id of ids) {
      const st = s.tripStatus(id);
      if (st === "parked") parked++;
      else if (st === "arrived") vanished++;
    }
    return { sim: s, ids, refused, parked, vanished, worksTile };
  }

  itSlow("parks every commuter at an ordinary rush, none deleted", () => {
    const { ids, parked, vanished } = rush(2);
    expect(ids.length).toBeGreaterThan(10);
    expect(parked).toBe(ids.length);
    // THE HEADLINE. Before the kerb existed this was 2 of 15.
    expect(vanished).toBe(0);
  });

  itSlow("charges the shortfall as a WALK, not as a disappearance", () => {
    // What the fallback buys is a real cost in place of a vanishing car: the
    // first arrivals take the gate, everybody else is further and further out,
    // and the distance is measured from where the car actually stopped.
    const { sim, ids, worksTile } = rush(2);
    const [wx, wy] = worksTile.split(",").map(Number);
    const walks = ids
      .map(id => sim.tripParkedAt(id))
      .filter((t): t is string => !!t)
      .map(t => {
        const [x, y] = t.split(",").map(Number);
        return Math.max(Math.abs(x - wx), Math.abs(y - wy));
      });
    expect(walks.length).toBeGreaterThan(10);
    // Somebody got the gate, and somebody had to walk — a flat penalty could
    // never have told those two apart.
    expect(Math.min(...walks)).toBeLessThanOrEqual(1);
    expect(Math.max(...walks)).toBeGreaterThan(Math.min(...walks));
  });

  itSlow("refuses the trip rather than delete the car when the town is full", () => {
    // The end of the ladder. Over-saturated, some drivers have nowhere at all —
    // and the honest answer is that they do not set off by car. `requestTrip`
    // returning null is the long-standing "no car could be dispatched" path, so
    // the citizen layer still makes the journey on a timer; there is simply no
    // vehicle. Before, all of these were dispatched and then deleted on arrival.
    const { ids, refused, vanished } = rush(4);
    expect(refused).toBeGreaterThan(0);
    // 12 of 30 vanished before; at most a couple may still lose a race between
    // planning a space and reaching it.
    expect(vanished).toBeLessThanOrEqual(2);
    expect(vanished * 4).toBeLessThan(ids.length);
  });

  itSlow("never parks two cars in the same stretch of kerb", () => {
    const { sim } = rush(4);
    const occ = sim.parkingOccupancy();
    const stalls = Object.keys(occ);
    expect(stalls.length).toBeGreaterThan(0);
    expect(new Set(stalls).size).toBe(stalls.length);
    expect(new Set(Object.values(occ)).size).toBe(stalls.length);
  });

  itSlow("hands the kerb back — it is a cycle here too", () => {
    const { sim, ids } = rush(2);
    const parkedIds = ids.filter(id => sim.tripStatus(id) === "parked");
    expect(parkedIds.length).toBeGreaterThan(0);
    const before = Object.keys(sim.parkingOccupancy()).length;
    for (const id of parkedIds) sim.releaseTrip(id, sim.tripParkedAt(id) ?? "");
    for (let t = 0; t < 400; t += 0.2) sim.step(0.2, () => false);
    expect(Object.keys(sim.parkingOccupancy()).length).toBeLessThan(before);
  });
});

describe("the board's other parking still works", () => {
  it("leaves the count of REAL spaces untouched", () => {
    // The pass adds places to stop; it must not add, move or remove a single
    // proper bay, or every balance number in the parking specs shifts under it.
    const real = (l: Level) =>
      Object.values(l)
        .flatMap(c => rowsOf(c))
        .filter(r => !r.informal)
        .reduce((n, r) => n + r.count, 0);
    // Applied to a board that has NOT had it yet, so this measures the pass
    // rather than re-measuring a board it has already run on.
    const base = citizencars.level;
    expect(real(base)).toBe(real(deriveKerbOverflow(base)));
    // ...and it really did add something, so the equality above is not vacuous.
    expect(informalRows(deriveKerbOverflow(base)).length).toBeGreaterThan(0);
    expect(facilitiesOf(workparking.level).length).toBeGreaterThan(0);
  });
});
