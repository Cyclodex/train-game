import { describe, it, expect } from "vitest";
import { createRoadSim, type CarSample } from "@/sim/road";
import { parkpass } from "@/levels/test/scenarios/parkpass";
import {
  buildSqueezeBanks,
  createLaneGeometry,
  informalSqueeze,
  type LaneOffsets,
} from "@/sim/laneGeometry";
import {
  CAR_BODY_WIDTH_FRAC,
  LARGE_BODY_WIDTH_FRAC,
} from "@/sim/laneOffset";
import { laneSegmentPointAt } from "@/sim/pathGeometry";
import { oppositePort } from "@/sim/topology";
import type { VehicleClass } from "@/tiles/lanes";

// THE BODY-OVERLAP ORACLE — "cars must never drive through each other."
//
// The report behind it (2026-08-21): on a 1+1 street with informally parked
// cars, passing traffic visibly clipped through them. Screenshots can show one
// moment; this drives the `parkpass` isolation board headless and rebuilds THE
// EXACT RENDERER PIPELINE for every vehicle at every sample tick — the same
// `couplerOffsets`, the same `informalSqueeze`, the same chord positioning as
// `game.ts updateRoadCars` — then checks every pair of rendered bodies for
// rectangle overlap (separating-axis test on the oriented boxes). Any pair
// that interpenetrates deeper than the tolerance fails with the time, the ids
// and the depth, whether it is moving×moving or moving×parked.
//
// The tolerance absorbs chord/rounding slack, not design: 1px on a 200px tile.

const SIZE = 200;
const EPS_PX = 1;

interface Box {
  x: number;
  y: number;
  angleDeg: number;
  halfL: number;
  halfW: number;
}

// Deepest interpenetration of two oriented rectangles (0 = separated), via the
// separating-axis theorem over both boxes' axes.
function penetrationPx(a: Box, b: Box): number {
  const axes: { x: number; y: number }[] = [];
  for (const box of [a, b]) {
    const rad = (box.angleDeg * Math.PI) / 180;
    axes.push({ x: Math.cos(rad), y: Math.sin(rad) });
    axes.push({ x: -Math.sin(rad), y: Math.cos(rad) });
  }
  const radius = (box: Box, axis: { x: number; y: number }): number => {
    const rad = (box.angleDeg * Math.PI) / 180;
    const ux = Math.cos(rad), uy = Math.sin(rad);
    return (
      box.halfL * Math.abs(ux * axis.x + uy * axis.y) +
      box.halfW * Math.abs(-uy * axis.x + ux * axis.y)
    );
  };
  let depth = Number.POSITIVE_INFINITY;
  for (const axis of axes) {
    const dist = Math.abs((a.x - b.x) * axis.x + (a.y - b.y) * axis.y);
    const overlap = radius(a, axis) + radius(b, axis) - dist;
    if (overlap <= 0) return 0;
    depth = Math.min(depth, overlap);
  }
  return depth;
}

describe("the oracle's maths bite", () => {
  it("flags the OLD geometry (20px cars, 4px squeeze) as interpenetration", () => {
    // The exact numbers of the 2026-08-21 report, as two parallel boxes on a
    // 1+1 street: parked centre on the kerb line (28px from the mid), passer
    // squeezed 4px off its 14px lane centre. Old widths: 20px. That clipped by
    // 2px — the oracle must see it, or a green sweep above proves nothing.
    const parked: Box = { x: 100, y: 28, angleDeg: 0, halfL: 19, halfW: 10 };
    const passer: Box = { x: 100, y: 10, angleDeg: 0, halfL: 19, halfW: 10 };
    expect(penetrationPx(parked, passer)).toBeCloseTo(2, 5);
    // Today's geometry — 16px car, 5px squeeze — clears by 3px.
    const slimParked: Box = { ...parked, halfW: 8 };
    const slimPasser: Box = { ...passer, y: 9, halfW: 8 };
    expect(penetrationPx(slimParked, slimPasser)).toBe(0);
    // And rotation is honoured: turn the passer broadside and it hits.
    expect(penetrationPx(slimParked, { ...slimPasser, angleDeg: 90 })).toBeGreaterThan(0);
  });
});

describe("no two rendered road bodies ever overlap (parkpass)", () => {
  it("moving traffic clears parked cars and each other, every tick", () => {
    const level = parkpass.level;
    const sim = createRoadSim({
      level,
      width: parkpass.size!.cols,
      height: parkpass.size!.rows,
      seed: 7,
      spawnInterval: parkpass.traffic!.spawnInterval,
      maxCars: parkpass.traffic!.maxCars,
      mix: parkpass.traffic!.mix,
    });
    const laneGeo = createLaneGeometry(level, SIZE);

    // A commuter drives in and takes the bare kerb — the protruding half every
    // passer then has to clear. Sanity-checked below so the sweep can't go
    // vacuously green on an empty kerb.
    const trip = sim.requestTrip("0,1", "3,1", "car", { park: true });
    expect(trip, "the kerb commuter was refused dispatch").toBeTruthy();

    const widthPx = (part: string): number =>
      part === "car"
        ? CAR_BODY_WIDTH_FRAC * SIZE
        : LARGE_BODY_WIDTH_FRAC * SIZE;

    const world = (s: CarSample, off: LaneOffsets) => {
      if (s.pose) {
        return {
          x: (s.coord.x + s.pose.tx) * SIZE,
          y: (s.coord.y + s.pose.ty) * SIZE,
          tangent: s.pose.headingDeg,
        };
      }
      const exit = s.exitPort !== null && s.exitPort !== s.entryPort ? s.exitPort : null;
      const p =
        exit === null
          ? laneSegmentPointAt(s.entryPort, oppositePort(s.entryPort), SIZE, off.offEntry, off.offEntry, 0)
          : laneSegmentPointAt(s.entryPort, exit, SIZE, off.offEntry, off.offExit, s.t);
      return { x: s.coord.x * SIZE + p.x, y: s.coord.y * SIZE + p.y, tangent: p.tangentDeg };
    };

    let sawParked = false;
    let sawPasserWhileParked = false;
    const offences: string[] = [];

    for (let t = 0; t < 180; t += 0.2) {
      sim.step(0.2, () => false);
      if (t < 5) continue; // let the first spawns settle
      const banks = buildSqueezeBanks(sim.informalParked());
      if (banks.size > 0) sawParked = true;

      const boxes: { id: string; parked: boolean; box: Box }[] = [];
      for (const s of sim.sample()) {
        const cls: VehicleClass = "car";
        for (const unit of s.units) {
          const offAt = (c: CarSample): LaneOffsets =>
            c.pose
              ? { offEntry: 0, offExit: 0 }
              : informalSqueeze(
                  banks,
                  c,
                  laneGeo.couplerOffsets(c, s.laneIndex, cls),
                  c.lanePos ?? s.laneIndex,
                  SIZE,
                );
          const f = world(unit.front, offAt(unit.front));
          const r = world(unit.rear, offAt(unit.rear));
          const dx = f.x - r.x;
          const dy = f.y - r.y;
          const chord = Math.hypot(dx, dy);
          const angle = chord > 0.5 ? (Math.atan2(dy, dx) * 180) / Math.PI : f.tangent;
          boxes.push({
            id: s.id,
            parked: !!unit.front.pose,
            box: {
              x: (f.x + r.x) / 2,
              y: (f.y + r.y) / 2,
              angleDeg: angle,
              halfL: (unit.lengthTiles * SIZE) / 2,
              halfW: widthPx(unit.part) / 2,
            },
          });
        }
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (a.id === b.id) continue; // one vehicle's own segments
          if (a.parked && b.parked) continue; // two parked cars share no motion
          if (!a.parked !== !b.parked) sawPasserWhileParked = true;
          const depth = penetrationPx(a.box, b.box);
          if (depth > EPS_PX) {
            offences.push(
              `t=${t.toFixed(1)}s ${a.id}${a.parked ? "(parked)" : ""} × ${b.id}${b.parked ? "(parked)" : ""}: ${depth.toFixed(1)}px deep at (${a.box.x.toFixed(0)},${a.box.y.toFixed(0)})`,
            );
          }
        }
      }
      if (offences.length > 12) break; // enough evidence; keep the failure readable
    }

    // The board did what it exists for: somebody parked on the bare kerb and
    // traffic really passed alongside — otherwise a green run proves nothing.
    expect(sawParked, "nobody ever parked on the bare kerb").toBe(true);
    expect(sawPasserWhileParked, "no car ever passed the parked one").toBe(true);
    expect(offences, "bodies interpenetrated").toEqual([]);
  });
});
