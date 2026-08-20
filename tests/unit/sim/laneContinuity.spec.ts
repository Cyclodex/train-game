import { describe, it, expect } from "vitest";
import { SCENARIOS } from "@/levels/test";
import { createLaneGeometry } from "@/sim/laneGeometry";
import { laneSegmentPointAt } from "@/sim/pathGeometry";
import { oppositePort } from "@/sim/topology";
import type { CarSample } from "@/sim/road";
import type { VehicleClass } from "@/tiles/lanes";
import { simFor, hasRoad, canSpawn } from "../support/roadSim";

// Lane continuity: a vehicle must never TELEPORT SIDEWAYS.
//
// A car's rendered position is the tile's lane path pushed sideways by the lateral
// offsets `laneGeometry.couplerOffsets` returns for the seam it entered by and the
// seam it leaves by. Those offsets are derived per tile, so two tiles that
// disagree about where a lane sits put the same car in two different places on
// either side of their shared seam — and the car jumps across the line in a single
// tick. Nothing else in the suite catches that: the sim is perfectly happy, the
// route is legal, no bodies clip. It is purely a geometry contract between
// neighbours, and it is visible to the player as a car swerving for no reason.
//
// The bug this was written for: a JUNCTION whose arms carry different lane counts
// (mixedcross, mixedtee). A straight-through movement used to be positioned by the
// plain-road SEAM TAPER, which anchors the lane index on the tile's own band — and
// a junction's `laneCountAt` is not its arm's real width (it tallies the movements
// fanning through the arm). Every inner through-lane therefore sat half a lane off
// the road it came from, snapped on entering the box and snapped back on leaving.
//
// Rather than assert offsets tile by tile, this reconstructs the exact world point
// the renderer draws (game.ts sampleRoadWorld, at tileSize 1) and measures how far
// it moves per tick. A car travels at most `speed·dt`; anything beyond that is not
// driving, it is teleporting. Registry-wide, so every scenario — including ones
// added later — is held to it.

const ROAD_SCENARIOS = SCENARIOS.filter(s => hasRoad(s) && canSpawn(s));

// Measured SIDEWAYS ONLY — the component of the step perpendicular to the
// direction the vehicle was pointing. Longitudinal travel is the vehicle doing its
// job, and how far it gets per tick depends on its speed and on how the sim
// converts arc length to segment progress; folding that in would make this a
// speed test with an arbitrary bound. Lateral motion has no such excuse: a lane
// change is metered by LANE_CHANGE_RATE (~2.2 lanes/s ≈ 0.006 tiles per tick) and
// a bend contributes only its sagitta (~0.0002), so anything past a small fraction
// of a lane in one tick is a teleport. Half a lane — the mixedcross defect — is
// 0.07, a whole lane 0.14.
const DT = 0.02;
const STEPS = 900;
const SEED = 5;
const MAX_LATERAL = 0.02; // tiles ≈ 1/7 lane

// The world point the renderer draws for one coupler, in TILE units: game.ts
// `sampleRoadWorld` with tileSize 1. Kept in lockstep with it deliberately — the
// whole point is to measure what the player sees, not what the sim intends.
function worldPoint(
  geo: ReturnType<typeof createLaneGeometry>,
  s: CarSample,
  laneIndex: number,
  cls: VehicleClass,
): { x: number; y: number; deg: number } | null {
  if (s.pose) return null; // parked / manoeuvring: not on a lane path at all
  const off = geo.couplerOffsets(s, laneIndex, cls);
  const exit = s.exitPort !== null && s.exitPort !== s.entryPort ? s.exitPort : null;
  const p =
    exit === null
      ? laneSegmentPointAt(s.entryPort, oppositePort(s.entryPort), 1, off.offEntry, off.offEntry, 0)
      : laneSegmentPointAt(s.entryPort, exit, 1, off.offEntry, off.offExit, s.t);
  return { x: s.coord.x + p.x, y: s.coord.y + p.y, deg: p.tangentDeg };
}

// How far the vehicle moved SIDEWAYS between two consecutive drawn positions: the
// step projected onto the normal of the heading it had before the step.
function lateralStep(
  was: { x: number; y: number; deg: number },
  now: { x: number; y: number },
): number {
  const th = (was.deg * Math.PI) / 180;
  return Math.abs((now.x - was.x) * -Math.sin(th) + (now.y - was.y) * Math.cos(th));
}

describe("lane continuity — no vehicle ever jumps sideways", () => {
  it("finds road scenarios to sweep", () => {
    expect(ROAD_SCENARIOS.length).toBeGreaterThan(20);
  });

  for (const scenario of ROAD_SCENARIOS) {
    it(`${scenario.id}: every vehicle's drawn position moves continuously`, () => {
      const sim = simFor(scenario, SEED);
      const geo = createLaneGeometry(scenario.level, 1);
      const prev = new Map<string, { x: number; y: number; deg: number }>();
      let worst = 0;
      let where = "";

      for (let i = 0; i < STEPS; i++) {
        sim.step(DT, () => false);
        const alive = new Set<string>();
        for (const c of sim.sample()) {
          for (let u = 0; u < c.units.length; u++) {
            // Exactly what game.ts's updateRoadCars feeds the geometry: the unit's
            // own front coupler, the car's lane index, and the unit's lane-access
            // class (a bus is positioned on bus lanes a car may not use, and a
            // BIKE on the half-width cycle strip — mapping a bike to "car" here
            // measured a point the renderer never draws, and read a whole lane of
            // phantom teleport wherever a bike turned off a cycle lane).
            const unit = c.units[u];
            const f = unit.front;
            const id = `${c.id}#${u}`;
            const cls: VehicleClass =
              unit.part === "bus" ? "bus" : unit.part === "bike" ? "bike" : "car";
            const pt = worldPoint(geo, f, c.laneIndex, cls);
            if (!pt) continue; // parked: skip, and let it re-anchor when it drives off
            alive.add(id);
            const was = prev.get(id);
            prev.set(id, pt);
            if (!was) continue; // first sighting (spawn, or leaving a bay)
            const d = lateralStep(was, pt);
            if (d > worst) {
              worst = d;
              where = `${id} at ${f.coord.x},${f.coord.y} (entry ${f.entryPort} exit ${f.exitPort}, lane ${c.laneIndex.toFixed(2)})`;
            }
          }
        }
        // Drop vehicles that despawned or parked, so a recycled id can't be
        // compared against a point from a previous life.
        for (const id of [...prev.keys()]) if (!alive.has(id)) prev.delete(id);
      }

      expect(worst, `${scenario.id}: ${where} moved ${worst.toFixed(3)} tiles sideways in one tick`)
        .toBeLessThan(MAX_LATERAL);
    }, 60000);
  }
});
