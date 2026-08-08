import { describe, it, expect } from "vitest";
import { itSlow } from "./support/tier";
import { createRoadSim } from "@/sim/road";
import { homeparking } from "@/levels/test/scenarios/homeparking";
import { workparking } from "@/levels/test/scenarios/workparking";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { deriveKerbOverflow, kerbOverflowTiles, KERB_SPACES } from "@/tiles/kerbOverflow";
import { levelBounds } from "@/tiles/bounds";
import { rowsOf, validateParking, facilitiesOf, bankOf } from "@/tiles/parking";
import { createParkingRegistry, stallFits } from "@/sim/parking";
import { roadEntries } from "@/sim/road";
import { buildCitizenWorld, plotsOf } from "@/tiles/cities";
import { parkingApronPath, stallOutlinePath, parkingKerbPath } from "@/tiles/parkingGeometry";
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

  it("keeps off a road opening that stops inside the map", () => {
    // `openingInsideLot` (sim/road.ts) treats any opening on a parking tile as
    // being INSIDE a car park rather than a way off the map, and refuses to
    // spawn or despawn there. This pass touches nearly every street, so a stub
    // it parked on would silently go quiet — and on a board whose traffic
    // enters at a stub, that is the whole board's traffic.
    const before = roadEntries(citizencars.level, 12, 9);
    const after = roadEntries(deriveKerbOverflow(citizencars.level), 12, 9);
    expect(after).toEqual(before);
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
    const s = createRoadSim({
      level: citizencars.level,
      width: 12,
      height: 9,
      seed: 3,
    });
    const withKerb = createRoadSim({
      level: deriveKerbOverflow(citizencars.level),
      width: 12,
      height: 9,
      seed: 3,
    });
    for (let t = 0; t < 120; t += 0.2) {
      s.step(0.2, () => false);
      withKerb.step(0.2, () => false);
    }
    // The closed ring spawns nothing ambient either way; what this pins is that
    // adding kerb everywhere did not invent traffic or parked cars.
    expect(withKerb.cars().filter(c => c.parked).length).toBe(
      s.cars().filter(c => c.parked).length,
    );
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
