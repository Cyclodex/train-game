import { describe, it, expect } from "vitest";
import { itSlow } from "../support/tier";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { junctionExitLane, busLaneIndices, turnLandsOnBusLane } from "@/tiles/lanes";
import { oppositePort } from "@/sim/topology";
import { createRoadSim } from "@/sim/road";
import { buscross } from "@/levels/test/scenarios/buscross";
import {
  buscrossboth,
  busmedian,
  busarterial,
  busmedianboth,
  busonewaycross,
  busmegacross,
} from "@/levels/test/scenarios/buscrosses";

// BUS LANES — a lane cars may not use, and buses prefer.
//
// Split out of road.spec.ts (2026-08-01) — see roadExitLanes.spec.ts for why.
// Pure moves.
//
// Three levels of the same rule: that traffic FLOWS on the bus crosses while
// cars stay off the bus lane, that the scenarios are WIRED the way the
// right-hand-traffic rule says (kerb bus -> straight+right, median bus ->
// straight+left), and that the editor overlay colours a junction movement by
// where it LANDS rather than where it starts.

describe("bus-lane crosses flow and keep cars off the bus lane", () => {
  // Drive each /test bus-cross scenario end-to-end. On the ARM tiles (not the
  // junction centre, where lanes map through turns) assert the class invariant:
  // a car NEVER drives on a bus lane, and buses DO use the bus lane — whether the
  // bus lane is the kerb (index 0) or the median (inner) lane. Plus: traffic
  // actually flows through (cars complete) with no broken positions or gridlock.
  const drive = (
    scenario: { level: Level; size?: { cols: number; rows: number }; traffic?: { mix?: Record<string, number> } },
    centre: { x: number; y: number },
    seed: number,
  ) => {
    const sim = createRoadSim({
      level: scenario.level,
      width: scenario.size!.cols,
      height: scenario.size!.rows,
      seed,
      spawnInterval: 0.6,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 14,
      mix: scenario.traffic?.mix,
    });
    let prev = new Set<string>();
    const completed = new Set<string>();
    let carOnBus = 0;
    let busOnBus = 0;
    let busSamples = 0;
    let badPos = 0;
    let stuck = 0;
    for (let i = 0; i < 1600; i++) {
      sim.step(0.05, () => false);
      const now = new Set(sim.cars().map(c => c.id));
      for (const id of prev) if (!now.has(id)) completed.add(id);
      prev = now;
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        if (!Number.isFinite(f.t) || (f.lanePos != null && !Number.isFinite(f.lanePos))) badPos++;
        if (f.coord.x === centre.x && f.coord.y === centre.y) continue; // skip the junction tile
        const road = scenario.level[`${f.coord.x},${f.coord.y}`]?.road;
        const busLanes = busLaneIndices(road, f.entryPort);
        if (busLanes.length === 0) continue;
        const onBus = busLanes.includes(Math.round(c.laneIndex));
        if (c.units[0].part === "bus") {
          busSamples++;
          if (onBus) busOnBus++;
        } else if (onBus) {
          carOnBus++;
        }
      }
      const cars = sim.cars();
      if (cars.length >= 3 && cars.every(c => c.velocity < 0.001)) stuck++;
    }
    return { completed: completed.size, carOnBus, busOnBus, busSamples, badPos, stuck };
  };

  const cases: [string, { level: Level; size?: { cols: number; rows: number }; traffic?: { mix?: Record<string, number> } }][] = [
    ["buscrossboth", buscrossboth],
    ["busmedian", busmedian],
    ["busarterial", busarterial],
    ["busmedianboth", busmedianboth],
    ["busonewaycross", busonewaycross],
    ["busmegacross", busmegacross],
  ];

  for (const [name, scenario] of cases) {
    itSlow(`${name}: cars never use a bus lane, buses do, and traffic flows`, () => {
      const r = drive(scenario, { x: 2, y: 2 }, 7);
      expect(r.badPos).toBe(0); // no broken/non-finite positions
      expect(r.completed).toBeGreaterThan(5); // sustained flow through the cross
      expect(r.stuck).toBeLessThan(80); // no permanent gridlock
      expect(r.busSamples).toBeGreaterThan(20); // buses actually ran the arms
      expect(r.busOnBus).toBeGreaterThan(0); // and used their bus lane
      expect(r.carOnBus).toBe(0); // a car NEVER drove on a bus lane on the arms
    });
  }
});

describe("bus-rule wiring audit (#16): kerb bus → straight+right, median bus → straight+left", () => {
  // The buscrosses.ts header states the rule (right-hand traffic, kerb = lane 0):
  // a KERB bus lane naturally feeds straight + the kerb-side RIGHT turn; a MEDIAN
  // (inner) bus lane feeds straight + the median-side LEFT turn. This locks that
  // wiring in across the whole family so a future edit can't silently re-point a
  // bus lane at the wrong arm. busmegacross is the ONE documented exception (its
  // north arm is inbound-only, so the natural turn target doesn't exist) — it is
  // audited separately below.
  const T = Position.Top, R = Position.Right, B = Position.Bottom, L = Position.Left;
  const C = Position.Center; // never an edge port on a road lane — present only to satisfy the map type.
  // Exit ports relative to a vehicle entering via `from` (right-hand traffic).
  const STRAIGHT: Record<Position, Position> = { [L]: R, [R]: L, [T]: B, [B]: T, [C]: C };
  const RIGHT: Record<Position, Position> = { [L]: B, [R]: T, [T]: L, [B]: R, [C]: C };
  const LEFT: Record<Position, Position> = { [L]: T, [R]: B, [T]: R, [B]: L, [C]: C };

  const compliant: [string, typeof buscross][] = [
    ["buscrossboth", buscrossboth],
    ["busmedian", busmedian],
    ["busarterial", busarterial],
    ["busmedianboth", busmedianboth],
    ["busonewaycross", busonewaycross],
  ];

  for (const [name, scn] of compliant) {
    it(`${name}: every centre bus lane feeds only straight + its kerb/median-side turn`, () => {
      const centre = scn.level["2,2"].road!;
      let busLanes = 0;
      for (const lane of centre) {
        if (lane.kind !== "bus") continue;
        busLanes++;
        // index 0 = kerb (straight + right); any higher index = median (straight + left).
        const turn = lane.index === 0 ? RIGHT[lane.from] : LEFT[lane.from];
        const allowed = new Set([STRAIGHT[lane.from], turn]);
        for (const to of lane.to) {
          // Every movement the bus lane offers is either straight or its own-side turn.
          expect(allowed.has(to)).toBe(true);
        }
      }
      expect(busLanes).toBeGreaterThan(0); // the scenario really has bus lanes to audit
    });
  }

  it("busmegacross: the documented exception — north is inbound-only, so each bus lane's natural turn falls back across the rule", () => {
    const centre = busmegacross.level["2,2"].road!;
    // Nothing in the junction exits north (the N arm is one-way INBOUND): this is
    // exactly why the natural kerb/median turn target is unavailable.
    for (const lane of centre) expect(lane.to).not.toContain(T);

    // Each bus lane has at least one `to` that breaks the kerb/median rule — and
    // that broken movement is precisely the one whose own-side turn would have gone
    // north (now impossible), so it falls back onto the south (car-only) arm.
    let violations = 0;
    for (const lane of centre) {
      if (lane.kind !== "bus") continue;
      const turn = lane.index === 0 ? RIGHT[lane.from] : LEFT[lane.from];
      const allowed = new Set([STRAIGHT[lane.from], turn]);
      const offside = lane.to.filter(to => !allowed.has(to));
      for (const to of offside) {
        violations++;
        expect(to).toBe(B); // the fallback always lands on the south arm
        expect(turn).toBe(T); // because the rule-correct turn target was north
      }
    }
    expect(violations).toBeGreaterThan(0); // the exception is real, not vacuous
  });
});

describe("bus-lane overlay colours a junction movement by where it LANDS", () => {
  // The debug overlay (Tile.vue) paints an arrow amber only when the movement
  // lands on a real bus lane on the EXIT arm — the rule lives in
  // `turnLandsOnBusLane`, shared by game.ts + the editor. Regression for #18: a
  // median bus turning right onto a car-only arm (busmegacross W→S) was painted
  // amber even though the bus lands on a CAR lane there. Drive the shared rule
  // against every shipped bus-cross centre so an amber arrow can never again be
  // drawn onto a lane the bus doesn't occupy as a bus lane.
  const T = Position.Top;
  const R = Position.Right;
  const B = Position.Bottom;
  const L = Position.Left;
  // The exit arm's road for a movement leaving the centre tile (2,2) via `exit`.
  const armRoad = (level: Level, exit: Position) =>
    level[
      `${2 + (exit === R ? 1 : exit === L ? -1 : 0)},${
        2 + (exit === B ? 1 : exit === T ? -1 : 0)
      }`
    ]?.road;

  const family: [string, typeof buscross][] = [
    ["buscross", buscross],
    ["buscrossboth", buscrossboth],
    ["busmedian", busmedian],
    ["busarterial", busarterial],
    ["busmedianboth", busmedianboth],
    ["busonewaycross", busonewaycross],
    ["busmegacross", busmegacross],
  ];

  it("every amber bus movement lands on a bus lane; car-lane fallbacks exist (cyan)", () => {
    let amber = 0;
    let fallback = 0;
    for (const [, scn] of family) {
      const centre = scn.level["2,2"].road;
      for (const lane of centre!) {
        if (lane.kind !== "bus") continue; // only bus-lane approaches go amber
        for (const to of lane.to) {
          const exitRoad = armRoad(scn.level, to);
          const exitApproach = oppositePort(to);
          if (turnLandsOnBusLane(centre, lane.from, lane.index, to, exitRoad, exitApproach, "bus")) {
            amber++;
            // Honesty: an amber arrow really ends on a bus lane of the exit arm.
            const landing = junctionExitLane(
              centre, lane.from, lane.index, to, exitRoad, exitApproach, "bus",
            );
            expect(busLaneIndices(exitRoad, exitApproach)).toContain(landing);
          } else {
            fallback++; // a bus movement that lands on a car lane → rendered cyan
          }
        }
      }
    }
    expect(amber).toBeGreaterThan(0); // amber is still used where it's earned
    expect(fallback).toBeGreaterThan(0); // and the buggy class (car-lane fallback) is present
  });

  it("busmegacross: the median bus's right turn onto the car-only south arm is NOT amber", () => {
    // W median bus lane (from L, index 1) turning to the south (B). The south arm
    // is a 2-lane one-way OUTBOUND with no bus lane — the original phantom amber.
    const centre = busmegacross.level["2,2"].road;
    const south = armRoad(busmegacross.level, B);
    expect(
      turnLandsOnBusLane(centre, L, 1, B, south, oppositePort(B), "bus"),
    ).toBe(false);
  });

  it("busmedianboth: a median bus left turn lands on the cross street's median bus lane (amber)", () => {
    // The positive case: median→median is a true bus-lane-to-bus-lane movement.
    const centre = busmedianboth.level["2,2"].road;
    const north = armRoad(busmedianboth.level, T);
    expect(
      turnLandsOnBusLane(centre, L, 1, T, north, oppositePort(T), "bus"),
    ).toBe(true);
  });
});
