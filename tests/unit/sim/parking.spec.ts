import { describe, it, expect } from "vitest";
import { itSlow } from "../support/tier";
import { Position } from "@/types";
import type { Level } from "@/tiles/model";
import { oneWay, twoWay, nWayLanes } from "@/tiles/lanes";
import {
  facilitiesOf,
  manoeuvreAt,
  manoeuvreLength,
  manoeuvrePath,
  maxStallsPerTile,
  needsBigBay,
  stallLengthPx,
  layByTaperPx,
  manoeuvreRunPx,
  stallBoxPoints,
  stallPose,
  stallPitchPx,
  bayNearPx,
  apronNearPx,
  validateParking,
  kerbOffsetAt,
  bankOf,
  forwardExitPath,
  forwardExitEndT,
  exitsForward,
  garageExitFrom,
  canReverseIn,
  parkedHeadingDeg,
  reverseAt,
  REVERSE_PACE,
  type ParkingRow,
} from "@/tiles/parking";
import {
  apronSpan,
  parkingApronPath,
  parkingKerbPath,
} from "@/tiles/parkingGeometry";
import {
  createParkingRegistry,
  stallFits,
  vehicleCanPark,
  bayClassOf,
  bayAdmits,
} from "@/sim/parking";
import { createRoadSim, roadEntries, specLength, vehicleSpec, type CarSample } from "@/sim/road";
import { neighborCoord } from "@/sim/topology";
import { SCENARIOS } from "@/levels/test";
import { getCoordinatesId } from "@/utils/tileHelpers";

// The base car body length the road sim uses in these tests, in tiles (the
// rendered game passes 38px/200px = 0.19).
const CAR_LEN = 0.19;

// LET THE WORKER BREATHE. Vitest's worker talks to the runner over an RPC
// channel with a heartbeat, and a long SYNCHRONOUS loop starves it — the run
// then dies with an unhandled `Timeout calling "onTaskUpdate"` while every
// assertion passes, and vitest still exits 1. Green tests, red suite, and
// nothing in the output says which test did it.
//
// The two long-run tests below are tens of seconds of tight, allocation-free
// stepping (measured: 71s and 58s of unbroken sync work, and exactly two
// unhandled errors per run). Yielding a macrotask every few hundred ticks costs
// microseconds and keeps the channel alive. Any new multi-thousand-tick loop in
// this file wants it too.
const breathe = () => new Promise<void>(resolve => setImmediate(resolve));
const BREATHE_EVERY = 500;

const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });

function levelWith(rows: ParkingRow[], facility = "P"): Level {
  return {
    "0,0": street(),
    "1,0": { ...street(), parking: { facility, rows } },
    "2,0": street(),
  };
}

describe("parking geometry — a bay is where the car in it stands", () => {
  it("places a row of bays outside the kerb, evenly along the tile", async () => {
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

  it("noses a 90° bay away from the road, and mirrors it on the far bank", async () => {
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

  it("packs a row from the leading edge by default, and centres it on request", async () => {
    // "pack" starts the row AT the tile's leading edge, so consecutive tiles of a
    // long row line up. Centring every tile's row instead would push each one
    // inward and leave a hole of empty kerb at every tile seam, repeated down the
    // whole street — which is why "centre" is opt-in, for a lone lay-by.
    const packed: ParkingRow = { from: Position.Left, kind: "parallel", count: 2 };
    const centred: ParkingRow = { ...packed, align: "centre" };
    const pitch = 200 / 3;
    // First bay's centre sits half a pitch in from the edge it starts at.
    expect(stallPose(packed, 0, 200, 28).x).toBeCloseTo(pitch / 2);
    // Centred, the pair straddles the middle of the tile instead.
    const c0 = stallPose(centred, 0, 200, 28).x;
    const c1 = stallPose(centred, 1, 200, 28).x;
    expect((c0 + c1) / 2).toBeCloseTo(100);
    expect(c0).toBeGreaterThan(stallPose(packed, 0, 200, 28).x);
  });

  it("draws an echelon bay as a parallelogram, so ranks nest instead of overlapping", async () => {
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

  it("measures the kerb of a one-way aisle by its own width, not the two-way floor", async () => {
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

  it("identifies the two spellings of the same physical kerb", async () => {
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

  it("runs from the lane to the bay and finishes square in it", async () => {
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

  it("is parameterised by ARC LENGTH, so the car crawls in at a constant speed", async () => {
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

  it("anchors at the car's real position when the sim overrides the start", async () => {
    // The sim triggers the swing wherever the car actually is, not where the
    // default curve would have begun — otherwise the sprite jumps sideways the
    // tick it starts to park.
    const path = manoeuvrePath(row, 1, 200, 14, 7, 0.42);
    expect(manoeuvreAt(path, 0).x).toBeCloseTo(0.42 * 200);
  });
});

describe("a garage is driven THROUGH, not reversed out of", () => {
  const garage: ParkingRow = { from: Position.Left, kind: "garage", count: 4 };

  it("puts its two ramp mouths at different points along the tile", async () => {
    // One driveway in, one out. A single mouth serialises arrivals and departures
    // through the same hole and forces the car to come out backwards.
    const inM = stallPose(garage, 0, 200, 28, "in");
    const outM = stallPose(garage, 0, 200, 28, "out");
    expect(outM.x).toBeGreaterThan(inM.x); // the out ramp is downstream
    expect(Math.abs(outM.x - inM.x)).toBeGreaterThan(50);
    // Both on the same kerb, since no separate exit approach was authored.
    expect(outM.y).toBeCloseTo(inM.y);
  });

  it("drives OUT forwards, ending aligned with the road", async () => {
    const path = forwardExitPath(garage, 0, 200, 28, 7);
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

  it("sends the car out on the far kerb when the author gives it a separate exit", async () => {
    const twoRamp: ParkingRow = { ...garage, exitTo: Position.Right };
    expect(garageExitFrom(twoRamp)).toBe(Position.Right);
    const inM = stallPose(twoRamp, 0, 200, 28, "in");
    const outM = stallPose({ ...twoRamp, from: Position.Right }, 0, 200, 28, "out");
    // Opposite banks of the street: departures no longer queue behind arrivals.
    expect((inM.y - 100) * (outM.y - 100)).toBeLessThan(0);
  });

  it("rejoins the road at the OUT ramp, not back at the entrance", async () => {
    // The car must carry on from where it really emerged. Re-seeding it at the
    // in-ramp would teleport it backwards and make it drive the same stretch twice.
    const endT = forwardExitEndT(garage, 0, 200, 28);
    const inT = stallPose(garage, 0, 200, 0, "in").t;
    expect(endT).toBeGreaterThan(inT);
    expect(endT).toBeLessThanOrEqual(0.999);
  });
});

describe("a 90 deg bay needs an aisle to turn in", () => {
  // Separation (>0) or penetration (<0) of two convex boxes, by SAT.
  const sat = (A: { x: number; y: number }[], B: { x: number; y: number }[]): number => {
    let worst = -Infinity;
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        const l = Math.hypot(q.y - p.y, q.x - p.x) || 1;
        const nx = -(q.y - p.y) / l;
        const ny = (q.x - p.x) / l;
        const pr = (pts: typeof A) => pts.map(t => t.x * nx + t.y * ny);
        const a = pr(A);
        const b = pr(B);
        const gap = Math.max(Math.min(...a) - Math.max(...b), Math.min(...b) - Math.max(...a));
        if (gap > 0) return gap;
        worst = Math.max(worst, gap);
      }
    }
    return worst;
  };
  const box = (x: number, y: number, deg: number, len: number, wid: number) => {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r);
    const sn = Math.sin(r);
    return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([u, v]) => ({
      x: x + c * (len / 2) * u! - sn * (wid / 2) * v!,
      y: y + sn * (len / 2) * u! + c * (wid / 2) * v!,
    }));
  };

  it("never drives through the car in the bay next door", async () => {
    // THE REPORTED PICTURE: a car swinging into a 90° bay across the ones either
    // side of it. Turning a car through a right angle takes its own length of
    // room, and these aisles were 14px wide for a 38px car — the pull-in went
    // 5.6px THROUGH the parked neighbour. `bayNearPx` holds a turning rank a car's
    // length off the driving line, which is what a real car park's aisle is.
    const row: ParkingRow = { from: Position.Left, kind: "perpendicular", count: 7 };
    const target = 3;
    const CAR_L = 38;
    const CAR_W = 20;
    const kerb = 14; // a one-lane aisle: the tightest case there is
    const neighbours = [target - 1, target + 1].map(i => {
      const q = stallPose(row, i, 200, kerb);
      return box(q.x, q.y, q.angleDeg, CAR_L, CAR_W);
    });
    const path = manoeuvrePath(row, target, 200, kerb, 7);
    let worst = Infinity;
    for (let i = 0; i <= 40; i++) {
      const at = manoeuvreAt(path, i / 40);
      const me = box(at.x, at.y, at.angleDeg, CAR_L, CAR_W);
      for (const n of neighbours) worst = Math.min(worst, sat(me, n));
    }
    expect(worst).toBeGreaterThanOrEqual(0);
  });

  it("paves the clearance, and leaves an authored verge green", async () => {
    // The room a turning rank is held out by IS the aisle, so it is tarmac up to
    // the kerb — a band of grass between the road and the car park is not a car
    // park. An authored `gap` on a kerbside row is the opposite: a pavement.
    const lot: ParkingRow = { from: Position.Left, kind: "perpendicular", count: 7 };
    const kerbside: ParkingRow = { from: Position.Left, kind: "parallel", count: 3, gap: 1 };
    expect(bayNearPx(lot, 200, 14)).toBeCloseTo(38);
    expect(apronNearPx(lot, 200, 14)).toBeCloseTo(14); // paved from the kerb out
    expect(bayNearPx(kerbside, 200, 28)).toBeCloseTo(56);
    expect(apronNearPx(kerbside, 200, 28)).toBeCloseTo(56); // the verge stays green
  });

  it("runs one unbroken strip of tarmac across a tile seam", async () => {
    // THE ECHELON APRON USED TO FOLLOW THE RAKE, so its road-side edge ran
    // −21..153 on a 200px tile while its far edge ran 21..195: consecutive tiles
    // stepped past each other and left a wedge of grass hard against the
    // carriageway in the middle of one car park. Squared off, and a packed row
    // reaches the seam, so two tiles' aprons meet or overlap.
    //
    // Measured on the PATH, not on the span function alone — the point is what
    // gets painted.
    const edges = (d: string) => {
      const n = d.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < n.length; i += 2) pts.push({ x: n[i]!, y: n[i + 1]! });
      return pts;
    };
    // The counts a tile actually holds — six echelon bays, seven 90° ones, three
    // kerbside. A rank that does NOT fill its tile is a different case, below.
    const FULL = { angled: 6, perpendicular: 7, parallel: 3 } as const;
    for (const kind of ["angled", "perpendicular", "parallel"] as const) {
      const row: ParkingRow = { from: Position.Left, kind, count: FULL[kind] };
      const pts = edges(parkingApronPath(row, 200, 14));
      // The row runs left→right, so the apron's two long edges are its two
      // distinct `y`s; each must cover the same stretch of `x`. A parallelogram
      // does not, which is the whole defect.
      const ys = [...new Set(pts.map(p => Math.round(p.y)))];
      expect(ys.length, `${kind}: apron is not a four-sided strip`).toBe(2);
      for (const y of ys) {
        const xs = pts.filter(p => Math.round(p.y) === y).map(p => p.x);
        expect(Math.min(...xs), `${kind}: near/far edges start apart`).toBeCloseTo(
          Math.min(...pts.map(p => p.x)),
          5,
        );
        expect(Math.max(...xs), `${kind}: near/far edges end apart`).toBeCloseTo(
          Math.max(...pts.map(p => p.x)),
          5,
        );
      }
      // And it reaches BOTH seams, so the next tile's strip continues it. Without
      // this the echelon rank leaves 5px of grass at every seam and the 90° one 4.
      const span = apronSpan(row, 200);
      expect(span.from, `${kind}: apron stops short of the leading seam`).toBeLessThanOrEqual(0);
      expect(span.to, `${kind}: apron stops short of the trailing seam`).toBeGreaterThanOrEqual(200);
      // The outer kerb line has to end where the tarmac does, or it floats.
      const kerb = edges(parkingKerbPath(row, 200, 14));
      expect(Math.min(...kerb.map(p => p.x))).toBeCloseTo(span.from, 5);
      expect(Math.max(...kerb.map(p => p.x))).toBeCloseTo(span.to, 5);
    }
    // A row that does NOT pack is a pocket and keeps its own extent: paving a
    // whole tile for one centred bay would read as a mistake, not as a car park.
    const lone: ParkingRow = { from: Position.Left, kind: "parallel", count: 1, align: "centre" };
    expect(apronSpan(lone, 200)).toEqual({ from: 200 / 3, to: 200 - 200 / 3 });
    // Nor is a packed rank that simply does not REACH the far seam stretched to
    // it: six 90° bays are 168px of a 200px tile, and 32px of bare tarmac past
    // the last one would read as a rank someone gave up on. "Within half a pitch"
    // is what separates "part of a run" from "short".
    const short: ParkingRow = { from: Position.Left, kind: "perpendicular", count: 6 };
    expect(apronSpan(short, 200).from).toBeCloseTo(0);
    expect(apronSpan(short, 200).to).toBeCloseTo(168);
  });
});

describe("a kerbside space is pulled out of, an echelon bay is reversed out of", () => {
  const rank: ParkingRow = { from: Position.Left, kind: "parallel", count: 3 };

  it("only the kinds a driver really noses out of get a forward exit", async () => {
    // Reversing is not a fallback here, it is the RIGHT motion for a bay you back
    // into. The line is drawn by kind, not by size or reservation.
    expect(exitsForward("parallel")).toBe(true);
    expect(exitsForward("garage")).toBe(true);
    expect(exitsForward("perpendicular")).toBe(false);
    expect(exitsForward("angled")).toBe(false);
    // A halt never leaves the lane at all, so it has no manoeuvre either way.
    expect(exitsForward("busstop")).toBe(false);
  });

  it("the registry hands one out for a kerb bay and withholds it from a 90° bay", async () => {
    const kerb = createParkingRegistry(levelWith([rank]), CAR_LEN);
    const bay = kerb.pickStallOn("1,0", Position.Left, "car", "c1")!;
    const exit = kerb.exitFor(bay, 0)!;
    expect(exit).toBeTruthy();
    // It rejoins the road on the approach it arrived by, downstream of the bay.
    expect(exit.from).toBe(Position.Left);
    expect(exit.endT).toBeGreaterThan(kerb.startTOf(bay));

    const echelon = createParkingRegistry(
      levelWith([{ from: Position.Left, kind: "perpendicular", count: 3 }]),
      CAR_LEN,
    );
    const slot = echelon.pickStallOn("1,0", Position.Left, "car", "c1")!;
    expect(echelon.exitFor(slot, 0)).toBeNull();
  });

  it("a car faces ONE way in its bay, and the exit sets off along it", async () => {
    // THE 180° SPIN. The entry curve and the exit curve each answered "which way
    // is this car pointing?" for themselves and disagreed: a kerbside car that had
    // backed in rested pointing down the road (right) while its exit set off
    // assuming it pointed back up the road (wrong). Measured on /test/parkingkerb
    // before `parkedHeadingDeg`: 47 per-tick heading jumps over 25°, worst 180.0°.
    const cases: [ParkingRow, number][] = [
      // A KERBSIDE bay lies along the road, so backing in changes nothing about
      // which way the car ends up facing.
      [{ from: Position.Left, kind: "parallel", count: 3 }, 0],
      // A 90° bay turns across the kerb, so backing in leaves it NOSE-OUT — which
      // is the entire reason a driver does it.
      [{ from: Position.Left, kind: "perpendicular", count: 3 }, 180],
    ];
    for (const [row, flip] of cases) {
      const pose = stallPose(row, 1, 200, 28);
      const rest = ((parkedHeadingDeg(row.kind, pose.angleDeg, true) - pose.angleDeg) % 360 + 360) % 360;
      expect(rest, `${row.kind} rest heading`).toBe(flip);
      // What the ENTRY curve actually leaves the car at, and what the EXIT curve
      // sets off at, both measured rather than asserted from the constant.
      const inPath = manoeuvrePath(row, 1, 200, 28, 7, undefined, "reverse");
      const out = forwardExitPath(row, 1, 200, 28, 7, true);
      const parked = manoeuvreAt(inPath, 1).angleDeg;
      const away = manoeuvreAt(out, 0).angleDeg;
      const gap = Math.abs(((((parked - away) % 360) + 540) % 360) - 180);
      expect(gap, `${row.kind}: entry and exit disagree by ${gap.toFixed(0)}°`).toBeLessThan(2);
    }
  });

  it("backs into a 90° bay, and never into an echelon one", async () => {
    // Which kinds can be backed into is GEOMETRY, not driver taste. An echelon bay
    // is raked FORWARD — you reach it by turning toward its side — so a car backed
    // into one comes to rest facing back up the aisle it arrived down, and on a
    // one-way aisle (the only place a far-bank rank is legal) there is nowhere for
    // it to go. Nosing in measures better too: −2.3/+0.3px against −8.6/−15.0.
    expect(canReverseIn("perpendicular")).toBe(true);
    expect(canReverseIn("parallel")).toBe(true);
    expect(canReverseIn("angled")).toBe(false);
    expect(canReverseIn("garage")).toBe(false);
    // And so a hemmed-in echelon bay is still NOSED into: `canNoseIn` must not
    // send it down a road that does not exist.
    const echelon = createParkingRegistry(
      levelWith([{ from: Position.Left, kind: "angled", count: 5 }]),
      CAR_LEN,
    );
    const a = echelon.pickStallOn("1,0", Position.Left, "car", "c1")!;
    echelon.claim({ ...a, index: a.index + 1 }, "blocker");
    expect(echelon.canNoseIn(a)).toBe(true);
  });

  it("pivots into a 90° bay instead of bulging across its neighbours", async () => {
    // A REVERSE IS A PIVOT, and a cubic between two known tangents is not one.
    // The old curve swung out beyond the bay and came back, which is why it
    // measured worse than nosing in (−3.3/−5.6px against +3.3/+0.1) and why
    // widening the aisle barely helped (−5.6 → −1.8 at 42px more).
    const row: ParkingRow = { from: Position.Left, kind: "perpendicular", count: 5 };
    const pose = stallPose(row, 2, 200, 28);
    const path = manoeuvrePath(row, 2, 200, 28, 14, undefined, "reverse");
    // It pulls PAST the bay and then comes back: the furthest point along the road
    // is reached mid-manoeuvre, not at either end.
    let far = -Infinity;
    for (let i = 0; i <= 40; i++) far = Math.max(far, manoeuvreAt(path, i / 40).x);
    expect(far).toBeGreaterThan(pose.x + 20);
    // NOTHING GOES DEEPER THAN THE BAY. That is the bulge, and it is what used to
    // put the curve through the rank behind: the old construction overshot to
    // y=182 on a bay whose centre is at 162.
    let deepest = -Infinity;
    for (let i = 0; i <= 40; i++) deepest = Math.max(deepest, manoeuvreAt(path, i / 40).y);
    expect(deepest).toBeLessThanOrEqual(pose.y + 0.5);
    // The first leg is driven FORWARDS and the rest backwards — which is what the
    // per-leg speed reads (`REVERSE_PACE`), so it is worth pinning here rather
    // than inferring it from the shape.
    expect(reverseAt(path, 0.05)).toBe(false);
    expect(reverseAt(path, 0.95)).toBe(true);
    expect(reverseAt(manoeuvrePath(row, 2, 200, 28, 14), 0.5)).toBe(false);
    // And it finishes square in the bay, facing out.
    const end = manoeuvreAt(path, 1);
    expect(end.x).toBeCloseTo(pose.x, 1);
    expect(end.y).toBeCloseTo(pose.y, 1);
    expect(Math.abs(end.angleDeg - (pose.angleDeg + 180))).toBeLessThan(1);
  });

  it("noses out along the road instead of crabbing sideways into it", async () => {
    const path = forwardExitPath(rank, 1, 200, 28, 7);
    const start = manoeuvreAt(path, 0);
    const end = manoeuvreAt(path, 1);
    const pose = stallPose(rank, 1, 200, 28);
    expect(start.x).toBeCloseTo(pose.x);
    expect(start.y).toBeCloseTo(pose.y);
    // Ends further down the street, back on the lane, pointing the way it goes.
    expect(end.x).toBeGreaterThan(start.x);
    expect(Math.abs(end.angleDeg)).toBeLessThan(5);
    // THE POINT: the first thing that happens is forward motion. With the control
    // point abeam the bay — the garage's rule, which is right for a ramp — the
    // opening leg of the curve is purely lateral and a car parked ALONG the road
    // would slide out of its space broadside.
    const first = manoeuvreAt(path, 0.12);
    expect(first.x - start.x).toBeGreaterThan(Math.abs(first.y - start.y));
  });
});

describe("a lay-by opens out of the kerb, and is entered along its own opening", () => {
  const bay: ParkingRow = { from: Position.Left, kind: "parallel", count: 1, reserved: "bus" };
  const rank: ParkingRow = { from: Position.Left, kind: "parallel", count: 3 };

  it("tapers a lay-by and leaves an ordinary rank square", async () => {
    // A lay-by is cut INTO the verge: the kerb swings out, runs level, swings back.
    // A run of kerbside spaces is a continuous parking LANE — tapering each tile's
    // end would turn one street into a row of pockets.
    expect(layByTaperPx(bay, 200)).toBeGreaterThan(0);
    expect(layByTaperPx(rank, 200)).toBe(0);
    // Both tapers plus the bay have to fit the tile they are painted on, or the
    // tile's own viewBox clips the opening off.
    const total = layByTaperPx(bay, 200) * 2 + stallLengthPx(bay, 200);
    expect(total).toBeLessThanOrEqual(200);
  });

  it("centres a tapered bay, because a packed one has no room for its entry", async () => {
    // Packed rows start at the tile's leading edge, which leaves nothing in front
    // of the bay for the kerb to open through.
    const pose = stallPose(bay, 0, 200, 28);
    expect(pose.t * 200 - stallLengthPx(bay, 200) / 2).toBeGreaterThanOrEqual(
      layByTaperPx(bay, 200) - 0.5,
    );
    // An ordinary rank still packs, so consecutive tiles line up.
    expect(stallPose(rank, 0, 200, 28).x).toBeCloseTo(200 / 6);
  });

  it("makes the entry SHALLOWER, not just longer", async () => {
    // The point of following the opening: the bus drifts in along the taper
    // instead of turning across the kerb line. Measured as the sharpest heading
    // change anywhere on the curve — the same swing, spread over more road.
    const worstTurn = (row: ParkingRow) => {
      const path = manoeuvrePath(row, 0, 200, 28, 7);
      let worst = 0;
      let prev = manoeuvreAt(path, 0).angleDeg;
      for (let i = 1; i <= 20; i++) {
        const a = manoeuvreAt(path, i / 20).angleDeg;
        worst = Math.max(worst, Math.abs(((a - prev + 540) % 360) - 180));
        prev = a;
      }
      return worst;
    };
    // Same bay geometry, with and without the opening to follow.
    const square: ParkingRow = { ...bay, reserved: undefined, count: 1 };
    expect(manoeuvreRunPx(bay, 200, 28)).toBeGreaterThan(manoeuvreRunPx(square, 200, 28));
    expect(worstTurn(bay)).toBeLessThan(worstTurn(square));
  });
});

describe("the parking registry — occupancy and fit", () => {
  const rows: ParkingRow[] = [{ from: Position.Left, kind: "parallel", count: 2 }];

  it("hands out each bay exactly once", async () => {
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

  it("scatters drivers across the free bays instead of packing from one end", async () => {
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

  it("gives the same car the same bay every time (a seed replays exactly)", async () => {
    const reg = createParkingRegistry(
      levelWith([{ from: Position.Left, kind: "perpendicular", count: 7 }]),
      CAR_LEN,
    );
    const once = reg.pickStallOn("1,0", Position.Left, "car", "car42")!;
    for (let i = 0; i < 5; i++) {
      expect(reg.pickStallOn("1,0", Position.Left, "car", "car42")!.index).toBe(once.index);
    }
  });

  it("never offers a bay the car has already driven past", async () => {
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

  it("keeps each class to its own bays — a bay is not just a space you fit in", async () => {
    // What the player reported: cars sitting in the lorry bays. Measured, it was
    // worse than that — a coach also took ordinary kerb spaces (a bus is 55px, a
    // parallel bay 60px) and a lorry drove down the ramp of an underground
    // garage. All three fit; none of them belongs.
    const std: ParkingRow = { from: Position.Left, kind: "parallel", count: 1 };
    const long: ParkingRow = { ...std, reserved: "long" };
    const deep: ParkingRow = { from: Position.Left, kind: "perpendicular", count: 1 };
    const garage: ParkingRow = { from: Position.Left, kind: "garage", count: 8 };

    // Ordinary bays: cars, and nothing bigger.
    expect(stallFits("car", std, CAR_LEN)).toBe(true);
    expect(stallFits("bus", std, CAR_LEN)).toBe(false);
    expect(stallFits("truck", std, CAR_LEN)).toBe(false);
    expect(stallFits("car", deep, CAR_LEN)).toBe(true);

    // Lorry bays: lorries and coaches, and NOT cars however much room is left.
    expect(stallFits("truck", long, CAR_LEN)).toBe(true);
    expect(stallFits("bus", long, CAR_LEN)).toBe(true);
    expect(stallFits("car", long, CAR_LEN)).toBe(false);

    // A garage has a height barrier: cars go down the ramp, lorries do not. Its
    // slots are not on the map, so no amount of geometry would have said so.
    expect(stallFits("car", garage, CAR_LEN)).toBe(true);
    expect(stallFits("truck", garage, CAR_LEN)).toBe(false);
    expect(stallFits("bus", garage, CAR_LEN)).toBe(false);

    // And the classification itself.
    expect(bayClassOf(std)).toBe("car");
    expect(bayClassOf(long)).toBe("lorry");
    expect(bayClassOf(garage)).toBe("car");
    expect(bayAdmits("bus", "lorry")).toBe(true);
    expect(bayAdmits("car", "lorry")).toBe(false);
  });

  it("keeps a bus stop, a loading bay and a lay-by apart — same size, different traffic", async () => {
    // All three need a BIG bay, so size alone cannot tell them apart. That is
    // exactly why admission is a class and not a measurement.
    const stop: ParkingRow = { from: Position.Left, kind: "parallel", count: 1, reserved: "bus" };
    const load: ParkingRow = { ...stop, reserved: "delivery" };
    const layby: ParkingRow = { ...stop, reserved: "long" };
    const permit: ParkingRow = { ...stop, reserved: "disabled" };
    expect(stallLengthPx(stop, 200)).toBe(stallLengthPx(load, 200));
    expect(stallLengthPx(load, 200)).toBe(stallLengthPx(layby, 200));

    // A bus stop is for the coach and nobody else.
    expect(stallFits("bus", stop, CAR_LEN)).toBe(true);
    expect(stallFits("truck", stop, CAR_LEN)).toBe(false);
    expect(stallFits("car", stop, CAR_LEN)).toBe(false);

    // A loading bay is for the delivery lorry — a coach would fit and is still
    // not making a delivery.
    expect(stallFits("truck", load, CAR_LEN)).toBe(true);
    expect(stallFits("bus", load, CAR_LEN)).toBe(false);
    expect(stallFits("car", load, CAR_LEN)).toBe(false);

    // A lay-by genuinely serves both. That is what a lay-by is.
    expect(stallFits("truck", layby, CAR_LEN)).toBe(true);
    expect(stallFits("bus", layby, CAR_LEN)).toBe(true);

    // And a disabled bay stays empty, because nothing issues a permit yet.
    for (const k of ["car", "truck", "bus"] as const) {
      expect(stallFits(k, permit, CAR_LEN)).toBe(false);
    }
  });

  it("sizes every reserved bay to the vehicle it is for", async () => {
    // One predicate decides this. The inline `reserved === "long"` it replaced sat
    // at nine call sites, and every one of them would have gone on sizing a bus
    // stop like a car space — a 55px coach in a 60px bay, which fits by 5px and
    // looks it.
    expect(needsBigBay("long")).toBe(true);
    expect(needsBigBay("delivery")).toBe(true);
    expect(needsBigBay("bus")).toBe(true);
    expect(needsBigBay("disabled")).toBe(false); // a permit bay is a car space
    expect(needsBigBay(undefined)).toBe(false);
    // A big bay takes most of a tile, so exactly one fits — which is what a
    // lay-by, a loading bay and a bus stop all actually look like.
    expect(maxStallsPerTile("parallel", 200, true)).toBe(1);
    expect(maxStallsPerTile("parallel", 200, false)).toBe(3);
  });

  it("counts a lorry-only facility as real capacity, not as a full car park", async () => {
    // The sign asks "could ANY vehicle use this?", so a lay-by of two lorry bays
    // reads 2/2 rather than reporting nought capacity and showing VOLL beside two
    // empty spaces. The ROUTER always names the kind, so a car is still never sent
    // there.
    const reg = createParkingRegistry(
      levelWith([{ from: Position.Left, kind: "parallel", count: 1, reserved: "long" }]),
      CAR_LEN,
    );
    expect(reg.capacity("P")).toBe(1);
    expect(reg.availableFor("P", "truck")).toBe(1);
    expect(reg.availableFor("P", "car")).toBe(0);
    expect(reg.openFacilities("car")).toEqual([]);
    expect(reg.openFacilities("truck").map(f => f.id)).toEqual(["P"]);
  });

  it("refuses a vehicle that does not physically fit the bay", async () => {
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

  it("keeps reserved bays out of capacity, so a car park cannot advertise space it has none of", async () => {
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

  it("counts a car park that is spoken for as full (the aim token)", async () => {
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

  it("groups tiles that share a facility id into one car park", async () => {
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

  it("accepts a well-formed kerbside row", async () => {
    expect(validateParking(levelWith(rows))).toEqual([]);
  });

  it("rejects bays with no road to reach them", async () => {
    const lvl: Level = { "0,0": { connections: [], parking: { rows } } };
    expect(validateParking(lvl)[0].message).toMatch(/no road/);
  });

  it("rejects a rank too deep for the street it hugs", async () => {
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

  it("rejects two rows that name the same physical kerb", async () => {
    const lvl = levelWith([
      { from: Position.Left, side: "left", kind: "parallel", count: 1 },
      { from: Position.Right, side: "right", kind: "parallel", count: 1 },
    ]);
    expect(validateParking(lvl).map(i => i.message).join()).toMatch(/same bank/);
  });

  it("rejects a far-bank row on a two-way road (nobody crosses oncoming to park)", async () => {
    const lvl = levelWith([{ from: Position.Left, side: "left", kind: "parallel", count: 1 }]);
    expect(validateParking(lvl).map(i => i.message).join()).toMatch(/cross oncoming/);
  });

  it("rejects a row on a tapering tile, where the kerb moves across the tile", async () => {
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

  it("rejects a car park with no way back to the road network (a car trap)", async () => {
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
    // The grid says the aisle stops in the MIDDLE of the map, not at its edge —
    // which is the whole difference between a car trap and a street that simply
    // runs off the world.
    expect(
      validateParking(lvl, 200, { cols: 4, rows: 2 }).map(i => i.message).join(),
    ).toMatch(/no way back/);
  });

  it("rejects more stalls than physically fit on a tile", async () => {
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
      // The scenario's OWN vehicle mix. Dropping it silently spawns cars only —
      // and a map whose bay is bus-reserved then never parks anything at all, so
      // a test of the parking seams runs green over an empty street.
      mix: s.traffic?.mix,
    });
  }

  itSlow("noses out of a kerbside bay — never reverses into the road", async () => {
    // The rule as a PLAYER sees it: watch a bus leave a lay-by and it drives away
    // forwards. Asserted on the rendered pose rather than on the curve, because
    // the geometry being right is worth nothing if the phase machine still hands
    // the car its entry curve to replay backwards.
    const sim = simFor("parkingkerb", 4);
    const prev = new Map<string, { x: number; y: number; tile: string }>();
    let steps = 0;
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(0.05, () => false);
      const leaving = new Set(
        sim.cars().filter(c => c.phase === "leaving").map(c => c.id),
      );
      for (const chord of sim.sample()) {
        const u = chord.units[0];
        if (!u?.front.pose || !u.rear.pose) continue;
        const tile = getCoordinatesId(u.front.coord);
        const now = { x: u.front.pose.tx, y: u.front.pose.ty, tile };
        const before = prev.get(chord.id);
        prev.set(chord.id, now);
        if (!before || before.tile !== tile || !leaving.has(chord.id)) continue;
        // How far it moved ALONG its own nose. Negative = reversing.
        const hx = u.front.pose.tx - u.rear.pose.tx;
        const hy = u.front.pose.ty - u.rear.pose.ty;
        const h = Math.hypot(hx, hy) || 1;
        worst = Math.min(worst, ((now.x - before.x) * hx + (now.y - before.y) * hy) / h);
        steps++;
      }
    }
    expect(steps).toBeGreaterThan(20); // cars really did leave their bays
    expect(worst).toBeGreaterThanOrEqual(-1e-9);
  });

  itSlow("never teleports a body between the road and a bay", async () => {
    // THE SEAM BUG, as a property. `headProgress` names the car's NOSE; every
    // manoeuvre curve names its CENTRE. Cross between them without converting and
    // the sprite steps half its own length — forward as it peels off, backwards as
    // it rejoins. On a coach that is a fifth of a tile, and it was reported as
    // "the bus appears a few cm further back before it drives away".
    //
    // `/test/buslayby` is a single east-west street, so a body's position along
    // the road is just `coord.x + progress`, whichever branch of `sample()` it
    // came from — which is what makes the two sides of the seam comparable at all.
    const sim = simFor("buslayby", 6);
    const DT = 0.05;
    // Generous: 0.5 tiles/sec of cruise is 0.025 a tick, so this is double the
    // fastest legitimate step and still a fifth of the half-coach jump it catches.
    const LIMIT = 0.05;
    const prev = new Map<string, number>();
    let biggest = 0;
    let worstId = "";
    let ticks = 0;
    for (let i = 0; i < 4000; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(DT, () => false);
      const seen = new Set<string>();
      for (const chord of sim.sample()) {
        const u = chord.units[0];
        if (!u) continue; // a garaged car is not drawn at all
        const f = u.front;
        const x = f.pose
          ? f.coord.x + f.pose.tx
          : f.coord.x + (f.entryPort === Position.Left ? f.t : 1 - f.t);
        seen.add(chord.id);
        const before = prev.get(chord.id);
        prev.set(chord.id, x);
        if (before === undefined) continue;
        const jump = Math.abs(x - before);
        if (jump > biggest) {
          biggest = jump;
          worstId = chord.id;
        }
        ticks++;
      }
      // Drop the cars that despawned, so a recycled id cannot read as a jump.
      for (const id of [...prev.keys()]) if (!seen.has(id)) prev.delete(id);
    }
    expect(ticks).toBeGreaterThan(500);
    expect(`${worstId}:${biggest.toFixed(3)}`).toBe(`${worstId}:${Math.min(biggest, LIMIT).toFixed(3)}`);
  });

  it("pulls away with the speed it left the bay at, instead of stalling on the lane", async () => {
    // `advanceParking` pins `velocity` at 0 for the whole manoeuvre — the curve
    // moves the car, the follower model does not — so handing it back at 0 makes a
    // coach that was gliding out at nearly cruise speed stop dead the instant it
    // rejoins the road and start again. Not braking: no momentum. It reads as the
    // bus almost stopping just after it pulls out.
    const sim = simFor("buslayby", 6);
    const leaving = new Set<string>();
    const handovers: number[] = [];
    for (let i = 0; i < 4000; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(0.05, () => false);
      for (const c of sim.cars()) {
        if (c.phase === "leaving") leaving.add(c.id);
        else if (c.phase === "driving" && leaving.delete(c.id)) handovers.push(c.velocity);
      }
    }
    expect(handovers.length).toBeGreaterThan(3);
    // Every one of them, not just the best: a single stall is the thing you see.
    // The manoeuvre runs at PARKING.speed x pace, ~0.47 tiles/sec on this bay,
    // and a departure held up by traffic is capped by the follower gate, not by
    // this handover — so a floor well under the crawl speed is the honest bar.
    expect(Math.min(...handovers)).toBeGreaterThan(0.3);
  });

  it("only peels off into a bay from the lane the bay is on", async () => {
    // A car diving into a kerbside space out of the INNER lane of a 2+2 street
    // cuts across the stream beside it. `/test/parkingkerb` is two lanes each way
    // with bays down both kerbs, so it is the map where this shows.
    const sim = simFor("parkingkerb", 4);
    const driving = new Set<string>();
    const lanes: number[] = [];
    for (let i = 0; i < 3000; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(0.05, () => false);
      for (const c of sim.cars()) {
        if (c.phase === "driving") driving.add(c.id);
        else if (c.phase === "entering" && driving.delete(c.id)) lanes.push(Math.round(c.laneIndex));
      }
    }
    expect(lanes.length).toBeGreaterThan(8); // cars really did park
    // Every one of them from the kerb lane. Not "mostly": one car crossing a live
    // lane to reach a space is the whole complaint.
    expect([...new Set(lanes)]).toEqual([0]);
  });

  const CAR_W = 0.1; // sprite width in tiles; the length comes from the pose pair
  const sat = (A: { x: number; y: number }[], B: { x: number; y: number }[]): number => {
    let worst = -Infinity;
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        const l = Math.hypot(q.y - p.y, q.x - p.x) || 1;
        const nx = -(q.y - p.y) / l;
        const ny = (q.x - p.x) / l;
        const pr = (pts: typeof A) => pts.map(t => t.x * nx + t.y * ny);
        const a = pr(A);
        const b = pr(B);
        const gap = Math.max(Math.min(...a) - Math.max(...b), Math.min(...b) - Math.max(...a));
        if (gap > 0) return gap;
        worst = Math.max(worst, gap);
      }
    }
    return worst;
  };
  const boxOf = (u: { front: CarSample; rear: CarSample }): { x: number; y: number }[] | null => {
    if (!u.front.pose || !u.rear.pose) return null;
    const fx = u.front.coord.x + u.front.pose.tx;
    const fy = u.front.coord.y + u.front.pose.ty;
    const rx = u.rear.coord.x + u.rear.pose.tx;
    const ry = u.rear.coord.y + u.rear.pose.ty;
    const dx = fx - rx;
    const dy = fy - ry;
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * (CAR_W / 2);
    const ny = (dx / l) * (CAR_W / 2);
    return [
      { x: fx + nx, y: fy + ny },
      { x: fx - nx, y: fy - ny },
      { x: rx - nx, y: ry - ny },
      { x: rx + nx, y: ry + ny },
    ];
  };

  // EVERY parking map, not just the 90° one. A kerbside bay whose neighbour is
  // parked is BACKED into now (`canNoseIn` decides, not the driver), which is
  // what took these from −7.6px of driving through a parked car to clear.

  itSlow("never drives a manoeuvre through a car that is already parked", async () => {
    // The geometric test above proves the DESIGNED curve clears its neighbours.
    // This one proves the car actually drives that curve — which it did not: the
    // stop line braked the nose to the curve's start, so the centre was half a
    // body short and `beginEntering` anchored there, quietly adding half a body of
    // approach to every pull-in. On a 90° bay a longer approach cuts HARDER, so
    // the aisle clearance was spent again before anyone could use it.
    //
    // Rendered poses, in world tiles, swept against every parked body on the map.
    for (const [map, seed] of [["parkinglot", 5], ["parkingkerb", 1], ["parkcity", 5]] as const) {
      await expectNoSweptOverlap(map, seed);
    }
  }, 60_000);

  async function expectNoSweptOverlap(map: string, seed: number) {
    const sim = simFor(map, seed);
    let worst = Infinity;
    let compared = 0;
    for (let i = 0; i < 1600; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(0.05, () => false);
      const phase = new Map(sim.cars().map(c => [c.id, c.phase]));
      const boxes = sim
        .sample()
        .map(c => ({ id: c.id, phase: phase.get(c.id), box: c.units[0] ? boxOf(c.units[0]) : null }))
        .filter(c => c.box);
      const moving = boxes.filter(c => c.phase === "entering" || c.phase === "leaving");
      const still = boxes.filter(c => c.phase === "parked");
      for (const m of moving) {
        for (const p of still) {
          worst = Math.min(worst, sat(m.box!, p.box!));
          compared++;
        }
      }
    }
    expect(compared, `${map}: nothing manoeuvred past a parked car`).toBeGreaterThan(150);
    // NOT A HAIR OF TOLERANCE — none at all. The road here, measured on this same
    // sweep: −0.029 tiles of driving THROUGH a parked car with the old narrow
    // aisle, −0.006 once the stop line stopped adding half a body of approach,
    // clear on the 90° maps the moment the approach became square, and clear on
    // the kerbside ones once a hemmed-in space is backed into instead of nosed
    // into (−7.6px → +0.1) and the trigger stopped firing early while still
    // rolling (−2.4px → 0).
    expect(worst, `${map}: swept a parked car`).toBeGreaterThanOrEqual(-0.001);
  }

  itSlow("reverses at a careful crawl, not at the speed it drove in", async () => {
    // A BACKING LEG IS DRIVEN AT AN ABSOLUTE SPEED: REVERSE_PACE × the base
    // parking crawl (0.16 tiles/s), never scaled by `pace`. That last clause is
    // the actual regression this test pins. The first ship of REVERSE_PACE was a
    // multiplier ON the pace-scaled speed, and the two cancelled: `pace` speeds a
    // path up in proportion to its length, the pivot-reverse path is long
    // (pace ≈ 3–4), so cars backed into bays at up to TWICE the crawl they nose
    // in at — "way too fast", verbatim from the report.
    //
    // Measured on the RENDERED body's MIDPOINT. The midpoint rides the curve, so
    // its displacement over dt is exactly the arc-length rate the sim drives —
    // the NOSE is the wrong point to watch, because on a curved leg the tangent
    // rotates and the nose sweeps sideways at sqrt(v² + (halfLen·ω)²), well above
    // the crawl while the car itself is crawling. (First draft of this test
    // watched the nose and "failed" on physically correct motion.) A tick where
    // the midpoint moves against the heading is a backing tick.
    const CRAWL = 0.16; // PARKING.speed in road.ts — the base manoeuvre crawl
    for (const map of ["parkingkerb", "parkinglot"]) {
      const sim = simFor(map, 1);
      const backSpeeds: number[] = [];
      let prev = new Map<string, { x: number; y: number; hx: number; hy: number; phase: string }>();
      for (let i = 0; i < 3000; i++) {
        if (i % BREATHE_EVERY === 0) await breathe();
        sim.step(0.05, () => false);
        const phase = new Map(sim.cars().map(c => [c.id, c.phase]));
        const now = new Map<string, { x: number; y: number; hx: number; hy: number; phase: string }>();
        for (const c of sim.sample()) {
          const u = c.units[0];
          if (!u?.front.pose || !u.rear.pose) continue;
          const fx = u.front.coord.x + u.front.pose.tx;
          const fy = u.front.coord.y + u.front.pose.ty;
          const rx = u.rear.coord.x + u.rear.pose.tx;
          const ry = u.rear.coord.y + u.rear.pose.ty;
          const l = Math.hypot(fx - rx, fy - ry) || 1;
          const ph = phase.get(c.id) ?? "driving";
          now.set(c.id, {
            x: (fx + rx) / 2,
            y: (fy + ry) / 2,
            hx: (fx - rx) / l,
            hy: (fy - ry) / l,
            phase: ph,
          });
          const b = prev.get(c.id);
          // Same manoeuvre both ticks, so phase-transition re-seats (which are
          // deliberate jumps, not driving) never pollute the sample.
          if (!b || b.phase !== ph || (ph !== "entering" && ph !== "leaving")) continue;
          const cur = now.get(c.id)!;
          const dx = cur.x - b.x;
          const dy = cur.y - b.y;
          if (dx * b.hx + dy * b.hy < -1e-5) backSpeeds.push(Math.hypot(dx, dy) / 0.05);
        }
        prev = now;
      }
      expect(backSpeeds.length, `${map}: nothing ever reversed`).toBeGreaterThan(50);
      backSpeeds.sort((a, b) => a - b);
      const p95 = backSpeeds[Math.floor(0.95 * backSpeeds.length)]!;
      const median = backSpeeds[Math.floor(0.5 * backSpeeds.length)]!;
      // Every ordinary backing tick at the one absolute speed; the median proves
      // the cap is the speed actually driven, not just an unreached ceiling.
      expect(p95, `${map}: reversing faster than the careful crawl`).toBeLessThan(
        REVERSE_PACE * CRAWL * 1.1,
      );
      expect(median, `${map}: reverse speed is not the absolute crawl`).toBeCloseTo(
        REVERSE_PACE * CRAWL,
        2,
      );
    }
  }, 120_000);

  // NO RIGHT OF WAY. A car whose dwell has ended waits IN ITS BAY — phase stays
  // `parked`, so it has no road body and nobody brakes for it. It used to claim
  // its lane slot the instant the dwell ended and let the traffic brake for a car
  // that had not moved, which is priority, and a car pulling out of a space does
  // not have it.
  //
  // The number that says whether the rule is livable is the wait between
  // dwell-end and rolling — `dwellLeft` keeps counting down past zero, so
  // `-dwellLeft` IS that wait. Seconds, not tens of seconds.
  //
  // ONE 200-SECOND RUN PER MAP AND SEED, MEASURED FOR EVERYTHING AT ONCE. The liveness
  // check and the leaver-wait check used to be two tests walking the SAME nine
  // sims — 3 maps x 3 seeds x 4000 ticks, twice — which is a third of this
  // suite's runtime spent simulating the same traffic a second time to look at a
  // different field of it.
  //
  // Merging them is not a coverage cut, and the split by map and seed is not
  // cosmetic either: as one case over all three maps it ran 70 seconds, and
  // vitest's runner-worker RPC gives up on a call it cannot answer within 60
  // (`DEFAULT_TIMEOUT = 6e4`, no config knob). The suite then dies on an
  // unhandled `Timeout calling "onTaskUpdate"` with every assertion passing and
  // the process still exiting 1 — green tests, red CI, and nothing naming the
  // culprit. Fold new measurements into this pass rather than adding another one.
  //
  // ONE CASE PER SEED, not one per map. Per map, `parkcity` alone was 11.4s of the
  // 12.6s these cost, and a 120s budget on an 11.4s case is 10x — which sounds
  // ample and is not: measured, an ordinary parallel job on the same machine
  // stretches it to 48s and a saturated one past 120s, so the budget rather than
  // the behaviour decided the verdict. Per seed it is ~3.8s against the same
  // budget. THIS is the move when a long-run case runs out of room — make it
  // cheaper, never raise an assertion's tolerance to fit.
  for (const id of ["parkingkerb", "parkinglot", "parkcity"]) {
    for (const seed of [1, 3, 5]) {
      itSlow(`${id} seed ${seed} stays alive over a LONG run, and lets its parkers back out`, async () => {
        let sampled = 0;
        const sim = simFor(id, seed);
        const where = `${id} seed ${seed}`;
        let cycles = 0;
        let worstStreak = 0;
        let streak = 0;
        let worstWait = 0;
        const parkedOnce = new Set<string>();
        const waited = new Map<string, number>();
        let prevM = new Map<string, number>();
        for (let i = 0; i < 4000; i++) {
          if (i % BREATHE_EVERY === 0) await breathe();
          sim.step(0.05, () => false);
          const cars = sim.cars();
          for (const c of cars) {
            if (c.parked) {
              parkedOnce.add(c.id);
              // `dwellLeft` goes NEGATIVE once the stay is over, so this IS the
              // wait between "wants out" and "rolling".
              if (c.dwellLeft < 0) waited.set(c.id, -c.dwellLeft);
            } else {
              if (parkedOnce.has(c.id) && c.phase === "driving") {
                parkedOnce.delete(c.id);
                cycles++;
              }
              if (c.phase === "leaving" && waited.has(c.id)) {
                worstWait = Math.max(worstWait, waited.get(c.id)!);
                waited.delete(c.id);
                sampled++;
              }
            }
          }
          // Manoeuvre progress counts as MOTION: `advanceParking` pins velocity
          // at 0 while the curve moves the car, so with reversing at a realistic
          // crawl a healthy car park would read as a dead map. This predicate has
          // now been blind in both directions once each — `speed` could never
          // fire, velocity-alone fires on cars that are visibly parking.
          const mNow = new Map(cars.map(c => [c.id, c.manoeuvre]));
          const rolling = cars.filter(c => !c.parked);
          const anyMoving = rolling.some(
            c =>
              c.velocity > 0.001 ||
              Math.abs((mNow.get(c.id) ?? 0) - (prevM.get(c.id) ?? mNow.get(c.id) ?? 0)) > 1e-9,
          );
          prevM = mNow;
          streak = rolling.length > 0 && !anyMoving ? streak + 1 : 0;
          worstStreak = Math.max(worstStreak, streak);
        }
        // THE MAP IS ALIVE. A lane rule once held a car at a stop line it could
        // not satisfy — it may not change lanes at a standstill, so it could never
        // reach the lane its bay is served from, and never reached the tile end
        // that hands the bay back. Wedged in a live lane for ever, and being the
        // LEAD car it took the street with it. The registry sweep cannot see this:
        // it runs 40 simulated seconds and the collapse takes 50–120.
        expect(worstStreak * 0.05, `${where} stood completely still`).toBeLessThan(3);
        expect(cycles, `${where} completed park-and-leave cycles`).toBeGreaterThan(20);
        // AND THE LEAVERS GET OUT. Measured across these nine runs: worst
        // 1.4–9.6s, average 0.7–2.4s.
        expect(worstWait, `${where}: worst wait from dwell-end to rolling`).toBeLessThan(20);
        // Nobody still sitting there at the end. This is the half the courtesy
        // yield buys: with the gap rule alone and the traffic at 2.5x, parkinglot
        // left 4–9 cars waiting, the worst of them 45.8s.
        const stranded = sim.cars().filter(c => c.parked && c.dwellLeft < -30);
        expect(stranded.length, `${where}: cars stranded in their bays`).toBe(0);
        // The wait rule has to have FIRED. It passes trivially on a build where
        // every car happens to leave on the tick its dwell ends. Per seed now
        // rather than pooled over three, which is the stricter reading: EVERY run
        // has to exercise it, not just whichever one carried the total. Measured
        // per seed: 24–33 on parkingkerb, 26–29 on parkinglot, 10–12 on parkcity.
        expect(sampled, `${where}: no car ever waited for a gap`).toBeGreaterThan(3);
      }, 120_000);
    }
  }

  itSlow("never spins on the spot, and really does back into a 90° bay", async () => {
    // A CAR TURNS BY DRIVING. Every heading on the board comes from a curve
    // tangent, so a big per-tick step means two curves were joined at poses that
    // disagree — which is exactly what shipped: a kerbside car that had backed in
    // flipped 180° the tick its dwell ended, then unwound another 102° over the
    // next few ticks as its looping exit curve straightened out. Measured before
    // `parkedHeadingDeg`: worst 180.0°, 47 such ticks on parkingkerb seed 1 alone.
    const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
    let reversed = 0;
    for (const [map, seed] of [["parkingkerb", 1], ["parkinglot", 5], ["parkvariants", 1]] as const) {
      const sim = simFor(map, seed);
      let worst = 0;
      let prev = new Map<string, number>();
      for (let i = 0; i < 2400; i++) {
        if (i % BREATHE_EVERY === 0) await breathe();
        sim.step(0.05, () => false);
        for (const c of sim.cars()) if (c.parkedReverse) reversed++;
        const now = new Map<string, number>();
        for (const c of sim.sample()) {
          const u = c.units[0];
          if (!u?.front.pose || !u.rear.pose) continue;
          const dx = u.front.coord.x + u.front.pose.tx - (u.rear.coord.x + u.rear.pose.tx);
          const dy = u.front.coord.y + u.front.pose.ty - (u.rear.coord.y + u.rear.pose.ty);
          now.set(c.id, (Math.atan2(dy, dx) * 180) / Math.PI);
          const before = prev.get(c.id);
          if (before !== undefined) worst = Math.max(worst, Math.abs(norm(now.get(c.id)! - before)));
        }
        prev = now;
      }
      // A tick is 50ms. The pivot arc's sharpest moment measures ~29°; anything
      // near a right angle is a discontinuity, not a manoeuvre.
      expect(worst, `${map} seed ${seed}: worst per-tick heading step`).toBeLessThan(45);
    }
    // AND THE PREFERENCE IS LIVE. Without this the test above passes trivially on
    // a build where nothing ever backs in — which is what the gate used to make
    // true for 90° bays.
    expect(reversed, "no car ever backed into a bay").toBeGreaterThan(0);
  }, 120_000);

  it("spawns nothing in the middle of the map", async () => {
    // A seam whose neighbour is a ONE-WAY pointing away feeds nothing, and that
    // read as "the world ends here": /test/parkcity spawned 4-9 vehicles a run at
    // the mouth of its car-park ramp (6,3, whose Bottom neighbour is a one-way
    // running down), where they appeared out of nowhere and then got stuck. A road
    // you cannot enter from this side is a one-way street, not an edge of the map.
    const s = SCENARIOS.find(x => x.id === "parkcity")!;
    const w = s.size!.cols;
    const h = s.size!.rows;
    for (const e of roadEntries(s.level, w, h)) {
      const onBorder = e.coord.x === 0 || e.coord.y === 0 || e.coord.x === w - 1 || e.coord.y === h - 1;
      const n = neighborCoord(e.coord, e.entryPort)!;
      const stub = !s.level[getCoordinatesId(n)]?.road?.length;
      expect(
        onBorder || stub,
        `${getCoordinatesId(e.coord)} port ${e.entryPort} is an interior spawn point`,
      ).toBe(true);
    }
  });


  itSlow("cars drive to a car park, park, dwell, and leave again", async () => {
    const sim = simFor("parkinglot");
    const phases = new Set<string>();
    const parkedOnce = new Set<string>();
    let cycles = 0;
    for (let i = 0; i < 2400; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
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

  it("a parked car occupies its bay and nobody else takes it", async () => {
    const sim = simFor("parkinglot");
    for (let i = 0; i < 1200; i++) sim.step(0.05, () => false);
    const occ = sim.parkingOccupancy();
    const stalls = Object.keys(occ);
    expect(stalls.length).toBeGreaterThan(0);
    // One car per bay, and one bay per car — no double-booking in either direction.
    expect(new Set(Object.values(occ)).size).toBe(stalls.length);
  });

  it("a parked car is off the carriageway — it reports no road body at all", async () => {
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

  it("stops sending cars to a car park once it is full", async () => {
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

  it("drains as fast as it fills — a busy aisle must not trap its own cars", async () => {
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
      if (i % BREATHE_EVERY === 0) await breathe();
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

  itSlow("keeps filling car parks under fill-fast spawning (no leaked aim tokens)", async () => {
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
      if (i % BREATHE_EVERY === 0) await breathe();
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

  itSlow("never lets a car end up in a lorry bay, over a whole run", async () => {
    // The end-to-end version of the rule, on the map built to show it: a street
    // with car spaces at one end and a lay-by at the other, and enough lorries and
    // coaches in the mix to want it.
    const s = SCENARIOS.find(x => x.id === "parkinglorry")!;
    const sim = createRoadSim({
      level: s.level,
      width: s.size!.cols,
      height: s.size!.rows,
      seed: 5,
      spawnInterval: s.traffic!.spawnInterval,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: s.traffic!.maxCars,
      mix: s.traffic!.mix,
    });
    // Which stalls are lorry bays, straight from the level.
    const lorryStalls = new Set<string>();
    for (const [tileId, cell] of Object.entries(s.level)) {
      for (const row of cell.parking?.rows ?? []) {
        if (row.reserved !== "long") continue;
        for (let i = 0; i < row.count; i++) {
          lorryStalls.add(`${tileId}|${row.from}|${row.side ?? "right"}|${i}`);
        }
      }
    }
    expect(lorryStalls.size).toBeGreaterThan(0);

    let sawLorryParked = 0;
    let sawCarParked = 0;
    for (let i = 0; i < 2400; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(0.05, () => false);
      const kindById = new Map(sim.cars().map(c => [c.id, c.kind]));
      for (const [stall, carId] of Object.entries(sim.parkingOccupancy())) {
        const kind = kindById.get(carId);
        if (!kind) continue;
        if (lorryStalls.has(stall)) {
          expect(kind, `a ${kind} took the lorry bay ${stall}`).not.toBe("car");
          sawLorryParked++;
        } else {
          expect(kind, `a ${kind} took the car bay ${stall}`).toBe("car");
          sawCarParked++;
        }
      }
    }
    // And both kinds of bay were genuinely exercised, or the assertions above
    // would be proving nothing.
    expect(sawLorryParked).toBeGreaterThan(0);
    expect(sawCarParked).toBeGreaterThan(0);
  });

  itSlow("sends every class of vehicle to its own kind of facility, across a whole city", async () => {
    // The end-to-end statement of the rule, on the map that has all of them at
    // once. Six facilities, six different kinds of bay, and one run long enough
    // that each is actually used — this is the test that would have caught the
    // original report (cars in the lorry bays) and the two it turned out to be
    // hiding (a coach in a car space, a lorry down the garage ramp).
    const s = SCENARIOS.find(x => x.id === "parkcity")!;
    const sim = createRoadSim({
      level: s.level,
      width: s.size!.cols,
      height: s.size!.rows,
      seed: 5,
      spawnInterval: s.traffic!.spawnInterval,
      carSpeed: 0.5,
      carLength: 0.19,
      maxCars: s.traffic!.maxCars,
      mix: s.traffic!.mix,
    });
    const seen = new Map<string, Set<string>>();
    for (let i = 0; i < 4000; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(0.05, () => false);
      const kindById = new Map(sim.cars().map(c => [c.id, c.kind]));
      for (const [stall, carId] of Object.entries(sim.parkingOccupancy())) {
        const tileId = stall.split("|")[0];
        const fac = s.level[tileId]?.parking?.facility ?? tileId;
        const kind = kindById.get(carId);
        if (!kind) continue;
        if (!seen.has(fac)) seen.set(fac, new Set());
        seen.get(fac)!.add(kind);
      }
    }
    // Who is ALLOWED where. Sets, not single values: a lay-by genuinely serves
    // both lorries and coaches, and pinning it to whichever one a given seed
    // happened to send first tests the seed rather than the rule.
    const allowed: Record<string, string[]> = {
      "kerb-west": ["car"], // ordinary kerb spaces
      lot: ["car"], // the surface car park
      garage: ["car"], // a height barrier keeps the big vehicles out
      lorry: ["truck", "bus"], // the Lieferhof lay-by takes either
      busstop: ["bus"], // the Haltestelle is coaches only
    };
    for (const [fac, kinds] of Object.entries(allowed)) {
      const got = seen.get(fac);
      expect(got, `nothing ever parked at ${fac} — the assertion below proves nothing`)
        .toBeTruthy();
      for (const k of got!) {
        expect(kinds, `a ${k} used ${fac}, which is for ${kinds.join(" or ")}`)
          .toContain(k);
      }
    }
    // And a semi never parks anywhere at all.
    for (const kinds of seen.values()) expect(kinds.has("semi")).toBe(false);
    // 200 simulated seconds on a 16x12 city with 34 vehicles, and the run has to
    // be that long or six facilities do not all get used and the assertions above
    // prove nothing. Same weight as the `parkcity stays alive` case below, so the
    // same 120s budget: 3.5s idle, 16s measured under a 4.5x load, and the 30s it
    // used to carry was one of the two that went red on a busy machine.
  }, 120_000);

  it("stands a halted bus ON its markings, not short of them", async () => {
    // A halt is a length of painted kerb, and the bus is supposed to be BESIDE it.
    // Braking the NOSE to the middle of the stretch parks the whole coach behind
    // it — hanging off the back of its own markings with the front half empty,
    // which reads exactly as a bus stopping too early. The stop line is half a
    // body PAST the middle.
    const s = SCENARIOS.find(x => x.id === "busstops")!;
    const halt = s.level["1,1"]?.parking?.rows?.[0];
    if (!halt) throw new Error("busstops no longer has a halt row on 1,1");
    // The painted stretch, in tile units: one pitch centred on the stall's own t.
    const pitch = stallPitchPx(halt.kind, 1, needsBigBay(halt.reserved));
    const mid = stallPose(halt, 0, 1, 0).t;
    const markLo = mid - pitch / 2;
    const markHi = mid + pitch / 2;

    // `cars()` reports no body length, so take it from the same spec the sim sizes
    // its vehicles with — `simFor` passes carLength 0.2.
    const busLen = specLength(vehicleSpec("bus", 0.2));
    const sim = simFor("busstops", 5);
    let seen = 0;
    let worstOut = 0;
    for (let i = 0; i < 2000; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(0.05, () => false);
      for (const c of sim.cars()) {
        if (c.phase !== "parked" || c.tileId !== "1,1") continue;
        seen++;
        // How far the coach sticks out of the painted stretch, either end.
        worstOut = Math.max(worstOut, markLo - (c.headProgress - busLen), c.headProgress - markHi);
      }
    }
    expect(seen).toBeGreaterThan(50); // buses really did use the halt
    // A hair of tolerance for the arrival epsilon, nothing like the half-body
    // (0.1375 of a tile on a coach) this exists to catch.
    expect(worstOut).toBeLessThan(0.02);
  });

  itSlow("a bus at a HALT queues the traffic; a bus in a LAY-BY does not", async () => {
    // The entire difference between the two kinds of stop, measured. Both hold a
    // bus for the same dwell on the same street; only the halt is in the running
    // lane, so only the halt should ever have anything stopped behind it.
    const s = SCENARIOS.find(x => x.id === "busstops")!;
    const sim = createRoadSim({
      level: s.level,
      width: s.size!.cols,
      height: s.size!.rows,
      seed: 5,
      spawnInterval: s.traffic!.spawnInterval,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: s.traffic!.maxCars,
      mix: s.traffic!.mix,
    });
    // The halt is UPSTREAM of the bay on purpose (see the scenario): a queue backs
    // up behind whatever causes it, so the halt's runs west, away from the bay, and
    // the approach to the bay stays clear. The other way round, the halt's jam
    // reaches back past the lay-by and gets blamed on it.
    const HALT_TILE = "1,1";
    const BAY_TILE = "4,1";
    let haltedInLane = 0;
    let parkedInBay = 0;
    let queuedBehindHalt = 0;
    let queuedBehindBay = 0;

    for (let i = 0; i < 2000; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      sim.step(0.05, () => false);
      const cars = sim.cars();
      const stopped = cars.filter(c => c.phase === "parked");
      for (const b of stopped) {
        if (b.tileId === HALT_TILE) haltedInLane++;
        if (b.tileId === BAY_TILE) parkedInBay++;
      }
      // Anything else stationary on the same tile as a stopped bus, or on the tile
      // behind it, is a vehicle the stop is holding up.
      const haltBusy = stopped.some(c => c.tileId === HALT_TILE);
      const bayBusy = stopped.some(c => c.tileId === BAY_TILE);
      for (const c of cars) {
        if (c.phase !== "driving" || c.velocity > 0.01) continue;
        if (haltBusy && (c.tileId === HALT_TILE || c.tileId === "0,1")) queuedBehindHalt++;
        if (bayBusy && (c.tileId === BAY_TILE || c.tileId === "3,1")) queuedBehindBay++;
      }
    }

    // The MECHANISM, stated directly: a halted bus is still an obstacle on the
    // road and a bus in a bay is not. Everything above is the consequence.
    const mech = createRoadSim({
      level: s.level, width: s.size!.cols, height: s.size!.rows, seed: 5,
      spawnInterval: s.traffic!.spawnInterval, carSpeed: 0.5, carLength: 0.2,
      maxCars: s.traffic!.maxCars, mix: s.traffic!.mix,
    });
    let sawHaltBody = false;
    let sawBayBody = false;
    for (let i = 0; i < 2000; i++) {
      if (i % BREATHE_EVERY === 0) await breathe();
      mech.step(0.05, () => false);
      const bodies = new Map(mech.bodies().map(b => [b.id, b.points.length]));
      for (const c of mech.cars()) {
        if (c.phase !== "parked") continue;
        if (c.tileId === HALT_TILE) sawHaltBody ||= (bodies.get(c.id) ?? 0) > 0;
        if (c.tileId === BAY_TILE) sawBayBody ||= (bodies.get(c.id) ?? 0) > 0;
      }
    }
    expect(sawHaltBody, "a halted bus reported no road body — nothing would queue")
      .toBe(true);
    expect(sawBayBody, "a bus in the bay still held the lane it had left").toBe(false);

    // Both stops were genuinely used, or the comparison below proves nothing.
    expect(haltedInLane, "no bus ever used the halt").toBeGreaterThan(0);
    expect(parkedInBay, "no bus ever used the lay-by").toBeGreaterThan(0);
    // The halt holds traffic up…
    expect(queuedBehindHalt, "nothing ever queued behind the in-lane halt")
      .toBeGreaterThan(0);
    // …and the lay-by lets it past. That is the whole reason a town builds one,
    // and it is why the two cannot be the same thing with a flag.
    expect(
      queuedBehindBay,
      "traffic queued behind the LAY-BY — the bus did not leave the running lane",
    ).toBe(0);
    // No per-case budget: two 2000-tick runs are ~0.5s, well inside the project
    // default. The 20s that used to sit here predates that default and was
    // TIGHTER than it — a per-case timeout is only worth writing when the case
    // needs MORE.
  });

  it("leaves every existing road scenario's parking layer empty", async () => {
    // The parking subsystem must cost a level that has none exactly nothing —
    // including its RNG draws, which is what keeps every pre-existing seeded run
    // byte-identical.
    const reg = createParkingRegistry(SCENARIOS.find(s => s.id === "roadjunction")!.level, CAR_LEN);
    expect(reg.any()).toBe(false);
    expect(reg.facilities()).toEqual([]);
  });
});
