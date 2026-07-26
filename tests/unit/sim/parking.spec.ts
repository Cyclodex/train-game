import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import type { Level } from "@/tiles/model";
import { oneWay, twoWay, nWayLanes } from "@/tiles/lanes";
import {
  facilitiesOf,
  manoeuvreAt,
  manoeuvreLength,
  manoeuvrePath,
  maxStallsPerTile,
  stallBoxPoints,
  stallPose,
  validateParking,
  kerbOffsetAt,
  bankOf,
  garageExitPath,
  garageExitEndT,
  garageExitFrom,
  type ParkingRow,
} from "@/tiles/parking";
import { createParkingRegistry, stallFits, vehicleCanPark } from "@/sim/parking";
import { createRoadSim } from "@/sim/road";
import { SCENARIOS } from "@/levels/test";

// The base car body length the road sim uses in these tests, in tiles (the
// rendered game passes 38px/200px = 0.19).
const CAR_LEN = 0.19;

const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });

function levelWith(rows: ParkingRow[], facility = "P"): Level {
  return {
    "0,0": street(),
    "1,0": { ...street(), parking: { facility, rows } },
    "2,0": street(),
  };
}

describe("parking geometry — a bay is where the car in it stands", () => {
  it("places a row of bays outside the kerb, evenly along the tile", () => {
    const row: ParkingRow = { from: Position.Left, kind: "parallel", count: 3 };
    const kerb = 28;
    const poses = [0, 1, 2].map(i => stallPose(row, i, 200, kerb));
    // Travelling east, "right" is south: every bay sits BELOW the centreline
    // (y > 100) and none of them is on the carriageway.
    for (const p of poses) expect(p.y).toBeGreaterThan(100 + kerb);
    // Evenly pitched along the direction of travel, in driving order.
    expect(poses[0].x).toBeLessThan(poses[1].x);
    expect(poses[1].x).toBeLessThan(poses[2].x);
    const d1 = poses[1].x - poses[0].x;
    const d2 = poses[2].x - poses[1].x;
    expect(Math.abs(d1 - d2)).toBeLessThan(1e-6);
    // A parallel bay lies ALONG the kerb: the car points down the road.
    for (const p of poses) expect(Math.abs(p.angleDeg)).toBeLessThan(1e-6);
  });

  it("noses a 90° bay away from the road, and mirrors it on the far bank", () => {
    const right: ParkingRow = { from: Position.Left, kind: "perpendicular", count: 2 };
    const left: ParkingRow = { from: Position.Left, side: "left", kind: "perpendicular", count: 2 };
    const r = stallPose(right, 0, 200, 14);
    const l = stallPose(left, 0, 200, 14);
    expect(r.angleDeg).toBeCloseTo(90); // south, away from an eastbound road
    expect(l.angleDeg).toBeCloseTo(-90); // north
    expect(r.y).toBeGreaterThan(100);
    expect(l.y).toBeLessThan(100);
    // Same longitudinal position — the two banks face each other across the aisle.
    expect(r.x).toBeCloseTo(l.x);
  });

  it("packs a row from the leading edge by default, and centres it on request", () => {
    // "pack" starts the row AT the tile's leading edge, so consecutive tiles of a
    // long row line up. Centring every tile's row instead would push each one
    // inward and leave a hole of empty kerb at every tile seam, repeated down the
    // whole street — which is why "centre" is opt-in, for a lone lay-by.
    const packed: ParkingRow = { from: Position.Left, kind: "parallel", count: 2 };
    const centred: ParkingRow = { ...packed, align: "centre" };
    const pitch = 0.3 * 200;
    // First bay's centre sits half a pitch in from the edge it starts at.
    expect(stallPose(packed, 0, 200, 28).x).toBeCloseTo(pitch / 2);
    // Centred, the pair straddles the middle of the tile instead.
    const c0 = stallPose(centred, 0, 200, 28).x;
    const c1 = stallPose(centred, 1, 200, 28).x;
    expect((c0 + c1) / 2).toBeCloseTo(100);
    expect(c0).toBeGreaterThan(stallPose(packed, 0, 200, 28).x);
  });

  it("draws an echelon bay as a parallelogram, so ranks nest instead of overlapping", () => {
    const row: ParkingRow = { from: Position.Left, kind: "angled", count: 3 };
    const a = stallBoxPoints(row, 0, 200, 14);
    const b = stallBoxPoints(row, 1, 200, 14);
    // The kerb-side edge of each bay runs ALONG the road: its two points share a
    // lateral position. (A rotated rectangle would not.)
    expect(a[0].y).toBeCloseTo(a[1].y);
    // Adjacent bays tile: bay 1's kerb edge starts where bay 0's ends.
    expect(b[0].x).toBeCloseTo(a[1].x);
    // And the far edge is raked FORWARD, the way the cars point.
    expect(a[3].x).toBeGreaterThan(a[0].x);
  });

  it("measures the kerb of a one-way aisle by its own width, not the two-way floor", () => {
    // A 1-lane one-way aisle is painted 14px from the centreline (kerb-anchored to
    // its run's widest lane count). Measuring it with the two-way max(count, 2)
    // rule would put the kerb at 28px and float the bays a car's width off the
    // tarmac.
    const lvl: Level = {
      "0,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
      "1,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    };
    expect(kerbOffsetAt(lvl, { x: 1, y: 0 }, Position.Left, 200)).toBeCloseTo(14);
    // A 2+2 street: kerb at (4/2)·0.14·200 = 56px.
    const wide: Level = {
      "0,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    };
    expect(kerbOffsetAt(wide, { x: 0, y: 0 }, Position.Left, 200)).toBeCloseTo(56);
  });

  it("identifies the two spellings of the same physical kerb", () => {
    // On an east-west street these two rows are BOTH the north kerb. Authoring
    // both would paint two sets of bays into one strip of tarmac and count every
    // space twice — which is why the validator rejects it.
    const a: ParkingRow = { from: Position.Left, side: "left", kind: "parallel", count: 1 };
    const b: ParkingRow = { from: Position.Right, side: "right", kind: "parallel", count: 1 };
    expect(bankOf(a)).toBe(bankOf(b));
    expect(bankOf(a)).toBe(Position.Top);
  });
});

describe("the parking manoeuvre", () => {
  const row: ParkingRow = { from: Position.Left, kind: "perpendicular", count: 2 };

  it("runs from the lane to the bay and finishes square in it", () => {
    const path = manoeuvrePath(row, 0, 200, 14, 7);
    const start = manoeuvreAt(path, 0);
    const end = manoeuvreAt(path, 1);
    const pose = stallPose(row, 0, 200, 14);
    // Starts on the lane (7px right of the centreline), ends in the bay.
    expect(start.y).toBeCloseTo(107);
    expect(end.x).toBeCloseTo(pose.x);
    expect(end.y).toBeCloseTo(pose.y);
    // And square: the car ends pointing into the bay, not at whatever angle the
    // curve happened to finish on.
    expect(end.angleDeg).toBeCloseTo(pose.angleDeg, 1);
  });

  it("is parameterised by ARC LENGTH, so the car crawls in at a constant speed", () => {
    // This is the property that a raw Bézier parameter does NOT have: equal steps
    // in `m` must cover equal distance, or the car visibly surges through the
    // middle of the swing.
    const path = manoeuvrePath(row, 0, 200, 14, 7);
    const total = manoeuvreLength(path);
    const steps = 8;
    let prev = manoeuvreAt(path, 0);
    for (let i = 1; i <= steps; i++) {
      const p = manoeuvreAt(path, i / steps);
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      // Every step covers within 6% of an equal share of the total length.
      expect(Math.abs(d - total / steps)).toBeLessThan(total / steps * 0.06);
      prev = p;
    }
  });

  it("anchors at the car's real position when the sim overrides the start", () => {
    // The sim triggers the swing wherever the car actually is, not where the
    // default curve would have begun — otherwise the sprite jumps sideways the
    // tick it starts to park.
    const path = manoeuvrePath(row, 1, 200, 14, 7, 0.42);
    expect(manoeuvreAt(path, 0).x).toBeCloseTo(0.42 * 200);
  });
});

describe("a garage is driven THROUGH, not reversed out of", () => {
  const garage: ParkingRow = { from: Position.Left, kind: "garage", count: 4 };

  it("puts its two ramp mouths at different points along the tile", () => {
    // One driveway in, one out. A single mouth serialises arrivals and departures
    // through the same hole and forces the car to come out backwards.
    const inM = stallPose(garage, 0, 200, 28, "in");
    const outM = stallPose(garage, 0, 200, 28, "out");
    expect(outM.x).toBeGreaterThan(inM.x); // the out ramp is downstream
    expect(Math.abs(outM.x - inM.x)).toBeGreaterThan(50);
    // Both on the same kerb, since no separate exit approach was authored.
    expect(outM.y).toBeCloseTo(inM.y);
  });

  it("drives OUT forwards, ending aligned with the road", () => {
    const path = garageExitPath(garage, 200, 28, 7);
    const start = manoeuvreAt(path, 0);
    const end = manoeuvreAt(path, 1);
    const mouth = stallPose(garage, 0, 200, 28, "out");
    // Starts at the out ramp…
    expect(start.x).toBeCloseTo(mouth.x);
    expect(start.y).toBeCloseTo(mouth.y);
    // …ends back on the lane, FURTHER DOWN THE ROAD (not back where it came in),
    // pointing the way it is going rather than nose-out of the building.
    expect(end.x).toBeGreaterThan(start.x);
    expect(end.y).toBeCloseTo(107);
    expect(Math.abs(end.angleDeg)).toBeLessThan(5); // eastbound, along the street
  });

  it("sends the car out on the far kerb when the author gives it a separate exit", () => {
    const twoRamp: ParkingRow = { ...garage, exitTo: Position.Right };
    expect(garageExitFrom(twoRamp)).toBe(Position.Right);
    const inM = stallPose(twoRamp, 0, 200, 28, "in");
    const outM = stallPose({ ...twoRamp, from: Position.Right }, 0, 200, 28, "out");
    // Opposite banks of the street: departures no longer queue behind arrivals.
    expect((inM.y - 100) * (outM.y - 100)).toBeLessThan(0);
  });

  it("rejoins the road at the OUT ramp, not back at the entrance", () => {
    // The car must carry on from where it really emerged. Re-seeding it at the
    // in-ramp would teleport it backwards and make it drive the same stretch twice.
    const endT = garageExitEndT(garage, 200);
    const inT = stallPose(garage, 0, 200, 0, "in").t;
    expect(endT).toBeGreaterThan(inT);
    expect(endT).toBeLessThanOrEqual(0.999);
  });
});

describe("the parking registry — occupancy and fit", () => {
  const rows: ParkingRow[] = [{ from: Position.Left, kind: "parallel", count: 2 }];

  it("hands out each bay exactly once", () => {
    const reg = createParkingRegistry(levelWith(rows), CAR_LEN);
    const a = reg.pickStallOn("1,0", Position.Left, "car", "car1")!;
    expect(a).toBeTruthy();
    expect(reg.claim(a, "car1")).toBe(true);
    // Claiming a taken bay fails; the car keeps driving, as a real driver does.
    expect(reg.claim(a, "car2")).toBe(false);
    const b = reg.pickStallOn("1,0", Position.Left, "car", "car2")!;
    expect(b.index).not.toBe(a.index);
    expect(reg.claim(b, "car2")).toBe(true);
    expect(reg.pickStallOn("1,0", Position.Left, "car", "car3")).toBeNull();
    expect(reg.freeCount("P")).toBe(0);
    reg.release(a);
    expect(reg.freeCount("P")).toBe(1);
  });

  it("scatters drivers across the free bays instead of packing from one end", () => {
    // Always taking the nearest space fills a car park solid from the entrance
    // while the far half stands empty — the one thing a real car park never looks
    // like. Different cars must land on different bays.
    const reg = createParkingRegistry(
      levelWith([{ from: Position.Left, kind: "perpendicular", count: 7 }]),
      CAR_LEN,
    );
    const picked = new Set<number>();
    for (let i = 0; i < 30; i++) {
      picked.add(reg.pickStallOn("1,0", Position.Left, "car", `car${i}`)!.index);
    }
    expect(picked.size).toBeGreaterThan(3);
  });

  it("gives the same car the same bay every time (a seed replays exactly)", () => {
    const reg = createParkingRegistry(
      levelWith([{ from: Position.Left, kind: "perpendicular", count: 7 }]),
      CAR_LEN,
    );
    const once = reg.pickStallOn("1,0", Position.Left, "car", "car42")!;
    for (let i = 0; i < 5; i++) {
      expect(reg.pickStallOn("1,0", Position.Left, "car", "car42")!.index).toBe(once.index);
    }
  });

  it("never offers a bay the car has already driven past", () => {
    // `atStallEntry` only ever fires forwards, so a space behind the nose is one
    // the car could never turn into — it would sit at its stop line for ever.
    const reg = createParkingRegistry(
      levelWith([{ from: Position.Left, kind: "perpendicular", count: 7 }]),
      CAR_LEN,
    );
    for (let i = 0; i < 40; i++) {
      const ref = reg.pickStallOn("1,0", Position.Left, "car", `car${i}`, 0.6);
      if (!ref) continue;
      expect(reg.info(ref)!.t).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("refuses a vehicle that does not physically fit the bay", () => {
    // A truck is 1.7 car lengths (65px at the native tile); a standard parallel
    // bay is 60px. Letting it in would lay it across the two bays either side —
    // and nothing downstream would catch that, because the swept-body check never
    // compares bodies that far off the carriageway.
    const std: ParkingRow = { from: Position.Left, kind: "parallel", count: 1 };
    const long: ParkingRow = { from: Position.Left, kind: "parallel", count: 1, reserved: "long" };
    expect(stallFits("car", std, CAR_LEN)).toBe(true);
    expect(stallFits("truck", std, CAR_LEN)).toBe(false);
    expect(stallFits("truck", long, CAR_LEN)).toBe(true);
    expect(stallFits("bus", long, CAR_LEN)).toBe(true);
    // A semi is two articulated boxes and a bay is one — it never parks at all.
    expect(vehicleCanPark("semi")).toBe(false);
    expect(stallFits("semi", long, CAR_LEN)).toBe(false);
  });

  it("keeps reserved bays out of capacity, so a car park cannot advertise space it has none of", () => {
    const reg = createParkingRegistry(
      levelWith([
        { from: Position.Left, kind: "parallel", count: 2 },
        { from: Position.Right, kind: "parallel", count: 2, reserved: "disabled" },
      ]),
      CAR_LEN,
    );
    expect(reg.capacity("P")).toBe(2);
    expect(reg.freeCount("P", "car")).toBe(2);
    expect(reg.pickStallOn("1,0", Position.Right, "car", "car1")).toBeNull();
  });

  it("counts a car park that is spoken for as full (the aim token)", () => {
    const reg = createParkingRegistry(levelWith(rows), CAR_LEN);
    expect(reg.availableFor("P", "car")).toBe(2);
    reg.aim("P", "car1");
    reg.aim("P", "car2");
    // Both spaces are now claimed-in-advance: a third driver must be sent
    // elsewhere rather than driving the length of the car park to find out.
    expect(reg.availableFor("P", "car")).toBe(0);
    expect(reg.openFacilities("car")).toEqual([]);
    reg.unaim("car2");
    expect(reg.availableFor("P", "car")).toBe(1);
  });

  it("groups tiles that share a facility id into one car park", () => {
    const lvl: Level = {
      "0,0": { ...street(), parking: { facility: "P", label: "Nord", rows } },
      "1,0": { ...street(), parking: { facility: "P", rows } },
      "2,0": { ...street(), parking: { facility: "Q", rows } },
    };
    const fs = facilitiesOf(lvl);
    expect(fs.map(f => f.id)).toEqual(["P", "Q"]);
    expect(fs[0].label).toBe("Nord");
    expect(fs[0].stalls).toHaveLength(4);
    expect(fs[0].tileIds.size).toBe(2);
  });
});

describe("validateParking — the mistakes that would otherwise ship green", () => {
  const rows: ParkingRow[] = [{ from: Position.Left, kind: "parallel", count: 1 }];

  it("accepts a well-formed kerbside row", () => {
    expect(validateParking(levelWith(rows))).toEqual([]);
  });

  it("rejects bays with no road to reach them", () => {
    const lvl: Level = { "0,0": { connections: [], parking: { rows } } };
    expect(validateParking(lvl)[0].message).toMatch(/no road/);
  });

  it("rejects a rank too deep for the street it hugs", () => {
    // A 3+3 boulevard puts its kerb 84px out, leaving less room to the tile edge
    // than a car is wide. Kerb parking genuinely caps at a 2+2 arterial at this
    // tile size — the right answer, but one that has to be said out loud.
    const lvl: Level = {
      "0,0": {
        connections: [],
        road: nWayLanes(Position.Left, Position.Right, 3),
        parking: { rows: [{ from: Position.Left, kind: "perpendicular", count: 1 }] },
      },
    };
    expect(validateParking(lvl).map(i => i.message).join()).toMatch(/overhang/);
  });

  it("rejects two rows that name the same physical kerb", () => {
    const lvl = levelWith([
      { from: Position.Left, side: "left", kind: "parallel", count: 1 },
      { from: Position.Right, side: "right", kind: "parallel", count: 1 },
    ]);
    expect(validateParking(lvl).map(i => i.message).join()).toMatch(/same bank/);
  });

  it("rejects a far-bank row on a two-way road (nobody crosses oncoming to park)", () => {
    const lvl = levelWith([{ from: Position.Left, side: "left", kind: "parallel", count: 1 }]);
    expect(validateParking(lvl).map(i => i.message).join()).toMatch(/cross oncoming/);
  });

  it("rejects a row on a tapering tile, where the kerb moves across the tile", () => {
    // A 2+2 tile between a 1+1 neighbour and a 2+2 one: the painted road narrows
    // over the tile's own length, so its kerb is 28px out at one end and 56px at
    // the other. Bays sized against either end have their inner half under the
    // running lane at the other.
    const lvl: Level = {
      "0,0": street(),
      "1,0": {
        connections: [],
        road: nWayLanes(Position.Left, Position.Right, 2),
        parking: { rows },
      },
      "2,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    };
    expect(validateParking(lvl).map(i => i.message).join()).toMatch(/tapering/);
  });

  it("rejects a car park with no way back to the road network (a car trap)", () => {
    // A one-way aisle that simply stops. There is no U-turn anywhere in the lane
    // model, so a driver who finds this car park full has nowhere to go.
    const lvl: Level = {
      "0,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
      "1,0": {
        connections: [],
        road: [oneWay(Position.Left, Position.Right)],
        parking: { facility: "trap", rows: [{ from: Position.Left, kind: "perpendicular", count: 1 }] },
      },
    };
    expect(validateParking(lvl).map(i => i.message).join()).toMatch(/no way back/);
  });

  it("rejects more stalls than physically fit on a tile", () => {
    expect(maxStallsPerTile("perpendicular", 200)).toBe(7);
    const lvl = levelWith([{ from: Position.Left, kind: "perpendicular", count: 20 }]);
    expect(validateParking(lvl).map(i => i.message).join()).toMatch(/do not fit/);
  });
});

describe("parking in the simulation — a cycle, not a sink", () => {
  function simFor(id: string, seed = 5) {
    const s = SCENARIOS.find(x => x.id === id)!;
    return createRoadSim({
      level: s.level,
      width: s.size!.cols,
      height: s.size!.rows,
      seed,
      spawnInterval: s.traffic?.spawnInterval ?? 0.6,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: s.traffic?.maxCars ?? 12,
    });
  }

  it("cars drive to a car park, park, dwell, and leave again", () => {
    const sim = simFor("parkinglot");
    const phases = new Set<string>();
    const parkedOnce = new Set<string>();
    let cycles = 0;
    for (let i = 0; i < 2400; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.cars()) {
        phases.add(c.phase);
        if (c.parked) parkedOnce.add(c.id);
        else if (parkedOnce.has(c.id) && c.phase === "driving") {
          parkedOnce.delete(c.id);
          cycles++;
        }
      }
    }
    // Every phase of the machine is exercised…
    expect([...phases].sort()).toEqual(["driving", "entering", "leaving", "parked"]);
    // …and bays genuinely turn over rather than filling once and stopping.
    expect(cycles).toBeGreaterThan(3);
  });

  it("a parked car occupies its bay and nobody else takes it", () => {
    const sim = simFor("parkinglot");
    for (let i = 0; i < 1200; i++) sim.step(0.05, () => false);
    const occ = sim.parkingOccupancy();
    const stalls = Object.keys(occ);
    expect(stalls.length).toBeGreaterThan(0);
    // One car per bay, and one bay per car — no double-booking in either direction.
    expect(new Set(Object.values(occ)).size).toBe(stalls.length);
  });

  it("a parked car is off the carriageway — it reports no road body at all", () => {
    const sim = simFor("parkingkerb");
    for (let i = 0; i < 900; i++) {
      sim.step(0.05, () => false);
      const parked = new Set(sim.cars().filter(c => c.parked).map(c => c.id));
      if (parked.size === 0) continue;
      for (const b of sim.bodies()) {
        if (parked.has(b.id)) expect(b.points).toEqual([]);
      }
    }
  });

  it("stops sending cars to a car park once it is full", () => {
    // Saturate the map. Once every space is taken or spoken for, no further car
    // may target it — the alternative is a queue of drivers touring a full car
    // park, which is a traffic jam rather than a feature.
    const sim = simFor("parkingkerb");
    for (let i = 0; i < 3000; i++) sim.step(0.05, () => false);
    const status = sim.parkingStatus();
    for (const f of status) {
      if (f.free === 0) {
        // Nobody is still driving toward a car park with nothing left. (`inbound`
        // counts cars that have already CLAIMED a space too, so the bound is the
        // number of bays, not zero.)
        expect(f.inbound).toBeLessThanOrEqual(f.capacity);
      }
    }
    expect(status.length).toBeGreaterThan(0);
  });

  it("drains as fast as it fills — a busy aisle must not trap its own cars", () => {
    // REGRESSION. A car waits for a gap in the aisle before reversing out of its
    // bay, and that gap used to be half a tile: on a single-lane car-park aisle
    // almost any moving car anywhere on the tile vetoed the manoeuvre. Measured on
    // this very map: twelve cars parked in forty seconds and TWO got back out, so
    // the car park filled and stayed full while traffic streamed past it.
    //
    // Asserted as a RATIO rather than a count, because what matters is not how
    // many cars park but that roughly as many leave as arrive.
    const sim = simFor("parkinglot");
    let parkings = 0;
    let departures = 0;
    const parked = new Set<string>();
    for (let i = 0; i < 1600; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.cars()) {
        if (c.parked) {
          if (!parked.has(c.id)) parkings++;
          parked.add(c.id);
        } else if (parked.has(c.id) && c.phase === "driving") {
          parked.delete(c.id);
          departures++;
        }
      }
    }
    expect(parkings).toBeGreaterThan(8);
    // Over 80 seconds the bays must turn over, not silt up. Half is generous —
    // the broken version managed one in six.
    expect(departures).toBeGreaterThan(parkings * 0.5);
  });

  it("keeps filling car parks under fill-fast spawning (no leaked aim tokens)", () => {
    // REGRESSION. The facility "aim" token used to be taken while a spawn was
    // still being decided, before the blocked-entry-lane bail-out. `fillFast` —
    // which the rendered game uses — retries a spawn many times a tick, and most
    // of those attempts bounce off that bail-out, so each one leaked a token for a
    // car that never existed and could never release it. Within a minute every car
    // park reported zero availability, no new driver was ever sent to one, and the
    // car parks slowly DRAINED to empty while traffic streamed past them.
    //
    // Measured through `parkingStatus()`, which is exactly what the roadside sign
    // shows, so this fails the moment the board would start lying to the player.
    const s = SCENARIOS.find(x => x.id === "parkinglot")!;
    const sim = createRoadSim({
      level: s.level,
      width: s.size!.cols,
      height: s.size!.rows,
      seed: 3,
      carSpeed: 0.5,
      carLength: 0.19,
      maxCars: 16,
      fillFast: true, // the rendered game's setting — the one that exposed it
    });
    let peakOccupied = 0;
    for (let i = 0; i < 3000; i++) {
      sim.step(0.05, () => false);
      if (i % 20 === 0) {
        const used = sim.parkingStatus().reduce((n, f) => n + (f.capacity - f.free), 0);
        peakOccupied = Math.max(peakOccupied, used);
      }
    }
    // Late in the run the car parks must still be in use, not drained to nothing.
    const finalUsed = sim.parkingStatus().reduce((n, f) => n + (f.capacity - f.free), 0);
    expect(peakOccupied).toBeGreaterThan(3);
    expect(finalUsed).toBeGreaterThan(0);
  });

  it("leaves every existing road scenario's parking layer empty", () => {
    // The parking subsystem must cost a level that has none exactly nothing —
    // including its RNG draws, which is what keeps every pre-existing seeded run
    // byte-identical.
    const reg = createParkingRegistry(SCENARIOS.find(s => s.id === "roadjunction")!.level, CAR_LEN);
    expect(reg.any()).toBe(false);
    expect(reg.facilities()).toEqual([]);
  });
});
