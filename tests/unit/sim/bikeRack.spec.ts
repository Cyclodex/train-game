import { describe, it, expect } from "vitest";
import { itSlow } from "../support/tier";
import { Position } from "@/types";
import type { Level } from "@/tiles/model";
import { twoWay } from "@/tiles/lanes";
import {
  maxStallsPerTile,
  stallDepthPx,
  stallLengthPx,
  stallOnLane,
  stallWalkIn,
  exitsForward,
  validateParking,
  type ParkingRow,
} from "@/tiles/parking";
import { bikeRackGeometry, stallOutlinePath } from "@/tiles/parkingGeometry";
import {
  createParkingRegistry,
  stallFits,
  vehicleCanPark,
  bayClassOf,
  bayAdmits,
  type BayClass,
} from "@/sim/parking";
import { createRoadSim, specLength, vehicleSpec, type VehicleKind } from "@/sim/road";
import {
  parkAndRideStationsOf,
  bikeAndRideStationsOf,
} from "@/tiles/cities";
import {
  WALK_RADIUS_TILES,
  BIKE_RANGE_TILES,
  bikeRangeOf,
} from "@/tiles/catchment";
import { SCENARIOS } from "@/levels/test";

// The base car body length the road sim uses in these tests, in tiles.
const CAR_LEN = 0.19;

const breathe = () => new Promise<void>(resolve => setImmediate(resolve));
const BREATHE_EVERY = 500;

const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });

const rackRow = (from: Position = Position.Left, count = 6): ParkingRow => ({
  from,
  kind: "bikerack",
  count,
});

describe("the bike rack — bike-only by its own kind", () => {
  it("classes a rack as a bike bay, and admits bikes there alone", () => {
    expect(bayClassOf(rackRow())).toBe("bike");
    // The exhaustive matrix, both ways round. The size gate would pass a bike
    // into ANY bay (it is the smallest body the sim builds), so the class gate
    // is the only fence — a single wrong row here is a bike wintering in a car
    // bay or a lorry crushing a rack.
    const kinds: VehicleKind[] = ["car", "truck", "semi", "bus", "bike"];
    const classes: BayClass[] = ["car", "lorry", "bus", "delivery", "permit", "resident", "bike"];
    for (const cls of classes) {
      expect(bayAdmits("bike", cls)).toBe(cls === "bike");
    }
    for (const kind of kinds) {
      expect(bayAdmits(kind, "bike")).toBe(kind === "bike");
    }
  });

  it("lets a bike park at a rack and nowhere else, whatever fits", () => {
    expect(vehicleCanPark("bike")).toBe(true);
    expect(stallFits("bike", rackRow(), CAR_LEN)).toBe(true);
    // A bike physically fits every one of these; the class refuses it anyway.
    const carBays: ParkingRow[] = [
      { from: Position.Left, kind: "parallel", count: 2 },
      { from: Position.Left, kind: "perpendicular", count: 2 },
      { from: Position.Left, kind: "garage", count: 8 },
    ];
    for (const row of carBays) expect(stallFits("bike", row, CAR_LEN)).toBe(false);
    // And no motor vehicle takes a stand.
    for (const kind of ["car", "truck", "bus", "semi"] as VehicleKind[]) {
      expect(stallFits(kind, rackRow(), CAR_LEN)).toBe(false);
    }
  });

  it("packs rack density: ~11 stands where 3 cars fit, all off the carriageway", () => {
    expect(maxStallsPerTile("bikerack")).toBeGreaterThanOrEqual(10);
    expect(maxStallsPerTile("parallel")).toBeLessThanOrEqual(4);
    // The stand must hold the body the sim actually builds (the fit gate's 2%
    // margin included) — this is why the depth is 0.09 and not the plan's 0.08.
    const bikePx = specLength(vehicleSpec("bike", CAR_LEN)) * 200;
    expect(bikePx).toBeLessThanOrEqual(stallLengthPx(rackRow(), 200) * 0.98);
    // And clear of the lane: over the validator's half-lane shallowness floor.
    expect(stallDepthPx("bikerack", 200)).toBeGreaterThanOrEqual(0.5 * 0.14 * 200);
  });

  it("is walked in and walked out — no manoeuvre in either direction", () => {
    expect(stallWalkIn("bikerack")).toBe(true);
    expect(stallOnLane("bikerack")).toBe(false);
    expect(exitsForward("bikerack")).toBe(false);
    expect(exitsForward("bikerack", true)).toBe(false);
    // The registry agrees: the rider stops AT the stand, no approach run.
    const level: Level = {
      "0,0": street(),
      "1,0": { ...street(), parking: { facility: "R", rows: [rackRow()] } },
      "2,0": street(),
    };
    const reg = createParkingRegistry(level, CAR_LEN);
    const ref = { tileId: "1,0", from: Position.Left, side: "right" as const, index: 0 };
    expect(reg.startTOf(ref)).toBeCloseTo(reg.info(ref)!.t);
    // And there is no forward exit curve to drive.
    expect(reg.exitFor(ref, 0)).toBeNull();
  });

  it("validates: a plain rack passes, a reserved or private one is refused", () => {
    const ok: Level = {
      "0,0": street(),
      "1,0": { ...street(), parking: { rows: [rackRow()] } },
      "2,0": street(),
    };
    expect(validateParking(ok, 200)).toEqual([]);
    const reserved: Level = {
      ...ok,
      "1,0": { ...street(), parking: { rows: [{ ...rackRow(), reserved: "bus" }] } },
    };
    expect(validateParking(reserved, 200).length).toBeGreaterThan(0);
    const priv: Level = {
      ...ok,
      "1,0": { ...street(), parking: { rows: [{ ...rackRow(), resident: "3,3" }] } },
    };
    expect(validateParking(priv, 200).length).toBeGreaterThan(0);
  });

  it("paints hoops, not bay boxes", () => {
    const row = rackRow();
    // No white box around a stand...
    expect(stallOutlinePath(row, 0, 200, 28)).toBe("");
    // ...one hoop per stall instead, each a stroke clear of the carriageway
    // (travelling east from Left, the right-side row's furniture sits south of
    // the kerb at y > 100 + kerb).
    const g = bikeRackGeometry(row, 200, 28);
    expect(g.hoops).toHaveLength(row.count);
    for (const d of g.hoops) {
      const ys = [...d.matchAll(/[ML] [\d.]+ ([\d.]+)/g)].map(m => Number(m[1]));
      expect(ys.length).toBeGreaterThan(0);
      for (const y of ys) expect(y).toBeGreaterThan(100 + 28);
    }
  });
});

describe("bike-and-ride targeting — racks and car parks qualify different stations", () => {
  // A station with ONLY a rack in reach, and a station with ONLY car bays.
  function levelWith(kind: "bikerack" | "parallel"): Level {
    return {
      "1,0": { connections: [[Position.Left, Position.Right]], role: "station" },
      "0,1": street(),
      "1,1": {
        ...street(),
        parking: { rows: [{ from: Position.Left, kind, count: kind === "bikerack" ? 6 : 2 }] },
      },
      "2,1": street(),
    };
  }

  it("a rack-only station is bike-and-ride, never car P+R", () => {
    const level = levelWith("bikerack");
    // THE TRAP THE SURVEY NAMED: before the bay-class filter, any parking row
    // in reach made a station a car P+R target — so building a rack would have
    // silently invited cars to a station with nowhere for them to park.
    expect(parkAndRideStationsOf(level)).toEqual([]);
    expect(bikeAndRideStationsOf(level).map(s => s.station)).toEqual(["1,0"]);
    expect(bikeAndRideStationsOf(level)[0].roadComponent).not.toBeNull();
  });

  it("a car-bays station is car P+R, never bike-and-ride", () => {
    const level = levelWith("parallel");
    expect(parkAndRideStationsOf(level).map(s => s.station)).toEqual(["1,0"]);
    expect(bikeAndRideStationsOf(level)).toEqual([]);
  });

  it("cycling reach is a range, not a constant — and its own, not the walk radius", () => {
    // Most riders take the bike for short hops; a sporty minority rides far.
    // The tuning encodes that as a typical/max pair a rider's own range is
    // drawn from — never by inflating the shared walk radius, which also feeds
    // station demand and P+R.
    expect(BIKE_RANGE_TILES.typical).toBeGreaterThan(WALK_RADIUS_TILES);
    expect(BIKE_RANGE_TILES.max).toBeGreaterThan(BIKE_RANGE_TILES.typical);
    // The per-rider draw spans the whole band, monotonically in keenness.
    expect(bikeRangeOf(0)).toBeCloseTo(WALK_RADIUS_TILES);
    expect(bikeRangeOf(0.5)).toBeCloseTo(BIKE_RANGE_TILES.typical);
    expect(bikeRangeOf(1)).toBeCloseTo(BIKE_RANGE_TILES.max);
    let prev = -1;
    for (let a = 0; a <= 1.0001; a += 0.1) {
      const r = bikeRangeOf(a);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
});

describe("the rack in the simulation", () => {
  function simFor(id: string, seed = 5) {
    const s = SCENARIOS.find(x => x.id === id)!;
    return createRoadSim({
      level: s.level,
      width: s.size!.cols,
      height: s.size!.rows,
      seed,
      spawnInterval: s.traffic?.spawnInterval ?? 0.6,
      carSpeed: 0.5,
      carLength: 0.19,
      maxCars: s.traffic?.maxCars ?? 12,
      mix: s.traffic?.mix,
    });
  }

  itSlow("bikes rack up and ride off again; the classes never cross", async () => {
    const sim = simFor("bikerack");
    const kindOf = new Map<string, VehicleKind>();
    let peakRacked = 0;
    let sawRelease = false;
    const everRacked = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(0.05, () => false);
      for (const c of sim.cars()) kindOf.set(c.id, c.kind);
      const occ = sim.parkingOccupancy();
      let racked = 0;
      for (const [stall, carId] of Object.entries(occ)) {
        const kind = kindOf.get(carId);
        // The scenario keys the rack to tile 2,1 and the car bays to 4,1 —
        // resolve the class through the stall id's leading tile id.
        const atRack = stall.startsWith("2,1|");
        if (atRack) {
          expect(kind).toBe("bike");
          racked++;
          if (everRacked.has(stall) === false) everRacked.add(stall);
        } else {
          expect(kind).toBe("car");
        }
      }
      if (peakRacked > 0 && racked < peakRacked) sawRelease = true;
      peakRacked = Math.max(peakRacked, racked);

      // A PARKED bike is off the road entirely (the parked invariant): no body
      // points, so the lane it left is genuinely free.
      const parkedIds = new Set(
        sim.cars().filter(c => c.parked).map(c => c.id),
      );
      if (parkedIds.size > 0) {
        for (const b of sim.bodies()) {
          if (parkedIds.has(b.id)) expect(b.points).toHaveLength(0);
        }
      }
    }
    // The feature actually ran: stands filled, and at least one bike left again.
    expect(peakRacked).toBeGreaterThan(0);
    expect(sawRelease).toBe(true);
  });

  itSlow("a parked bike is drawn at its stand, not on the road", async () => {
    const sim = simFor("bikerack", 7);
    let checked = 0;
    for (let i = 0; i < 4000 && checked < 8; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(0.05, () => false);
      const parked = sim.cars().filter(c => c.parked && c.kind === "bike");
      if (parked.length === 0) continue;
      const samples = sim.sample();
      for (const c of parked) {
        const s = samples.find(x => x.id === c.id)!;
        // The walked-in bike has no manoeuvre curve, so this is the stall-pose
        // branch: an absolute pose, off the carriageway. The street runs along
        // y = 1.5 tiles with kerbs ±0.14 tiles out; a racked bike stands beyond
        // them.
        expect(s.units).toHaveLength(1);
        const pose = s.units[0].front.pose;
        expect(pose).toBeTruthy();
        const yInTile = pose!.ty; // tile units, 0..1 across the row's tile
        const offCentre = Math.abs(yInTile - 0.5);
        expect(offCentre).toBeGreaterThan(0.14);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
