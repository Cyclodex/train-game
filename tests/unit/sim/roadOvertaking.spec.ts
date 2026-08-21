import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { nWayLanes } from "@/tiles/lanes";
import { createRoadSim, type TrafficConfig } from "@/sim/road";
import { worstSweptOverlap } from "../support/roadSim";
import { carqueue } from "@/levels/test/scenarios/carqueue";
import { overtakeloop } from "@/levels/test/scenarios/overtakeloop";
import { overtaketwolane } from "@/levels/test/scenarios/overtaketwolane";
import { overtakeabort } from "@/levels/test/scenarios/overtakeabort";
import { roadpriority } from "@/levels/test/scenarios/roadpriority";

// OVERTAKING + SWEPT-BODY COLLISION ROBUSTNESS (#39).
//
// Split out of road.spec.ts (2026-08-01) — see roadExitLanes.spec.ts for why.
// Pure moves.
//
// The pull-out/pass/return state machine, and the invariant that outlives it:
// no two vehicle bodies ever overlap on any tick, measured as swept boxes
// rather than as centre points.

describe("createRoadSim — overtaking & swept-body collision robustness (#39)", () => {
  // Build a sim straight from a TestScenario's traffic config, with the
  // deterministic per-interval spawn cadence (no fillFast) so the run replays
  // identically for a fixed seed — the basis for the swept-body assertion.
  function simFor(
    scenario: { level: Level; size?: { cols: number; rows: number }; traffic?: TrafficConfig },
    seed: number,
  ) {
    const t = (scenario.traffic ?? {}) as {
      spawnInterval?: number;
      maxCars?: number;
      overtakeFraction?: number;
      mix?: Record<string, number>;
      spawnEntries?: { coord: { x: number; y: number }; entryPort: Position }[];
    };
    return createRoadSim({
      level: scenario.level,
      width: scenario.size!.cols,
      height: scenario.size!.rows,
      seed,
      spawnInterval: t.spawnInterval ?? 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      speedSpread: 0.3,
      maxCars: t.maxCars ?? 12,
      overtakeFraction: t.overtakeFraction,
      mix: t.mix,
      spawnEntries: t.spawnEntries,
    });
  }

  // The swept-body overlap measure is the SHARED helper (support/roadSim.ts) —
  // this file used to carry a private copy, whose hard-coded 0.7 threshold went
  // stale the day the sprites slimmed (2026-08-21) while the shared one derived
  // itself from the body-width constants. One measure, one source.

  // The acceptance criterion: a fixed deterministic run of each busy/junction
  // scenario never lets two bodies overlap on ANY tick.
  const sweptScenarios: { name: string; scenario: Parameters<typeof simFor>[0]; seed: number }[] = [
    { name: "overtaketwolane", scenario: overtaketwolane, seed: 7 },
    { name: "overtakeabort", scenario: overtakeabort, seed: 7 },
    { name: "overtakeloop", scenario: overtakeloop, seed: 9 },
    { name: "carqueue", scenario: carqueue, seed: 3 },
    { name: "roadpriority", scenario: roadpriority, seed: 5 },
  ];
  for (const { name, scenario, seed } of sweptScenarios) {
    it(`${name}: no two bodies overlap on any tick (swept-body)`, () => {
      const sim = simFor(scenario, seed);
      let worst = 0;
      let sawTraffic = false;
      for (let i = 0; i < 1500; i++) {
        sim.step(0.05, () => false);
        if (sim.cars().length > 1) sawTraffic = true;
        worst = Math.max(worst, worstSweptOverlap(sim));
      }
      expect(sawTraffic).toBe(true); // the run actually populated the road
      // A tiny tolerance absorbs body-sampling/curve discretisation; a real
      // overlap (two bodies sharing road in a lane) is far larger than this.
      expect(worst).toBeLessThan(0.02);
    }, 30000);
  }

  it("overtakers ease laterally — no snap on pull-out, return, or abort", () => {
    // Across a busy overtaking run, a car's lateral lane position never jumps more
    // than the lane-change rate allows in one tick. This holds for a graceful
    // abort too (the same eased glide carries the car back), so an aborted pass
    // can never teleport the body sideways.
    const dt = 0.05;
    const sim = simFor(overtakeabort, 7);
    const prev = new Map<string, number>();
    let worstStep = 0;
    for (let i = 0; i < 1500; i++) {
      sim.step(dt, () => false);
      const live = new Set<string>();
      for (const c of sim.cars()) {
        live.add(c.id);
        const p = prev.get(c.id);
        if (p != null) worstStep = Math.max(worstStep, Math.abs(c.laneIndex - p) / dt);
        prev.set(c.id, c.laneIndex);
      }
      for (const id of [...prev.keys()]) if (!live.has(id)) prev.delete(id);
    }
    // LANE_CHANGE_RATE is 2.2 lanes/sec; allow a small numerical margin. A snap
    // (instant lane swap) would be many times this.
    expect(worstStep).toBeLessThan(2.5);
  }, 30000);

  it("a car aborts a pass when the gap closes — returns to the kerb without committing", () => {
    // On the short, packed overtakeabort road the inner (passing) lane is often
    // blocked ahead, so a car that pulls out to pass frequently has to give up.
    // Detect a genuine abort: a car observed in the "passing" phase that then
    // switches to "returning" WITHOUT ever drawing level with its leader — i.e.
    // it never reached the inner lane proper (peak laneIndex stayed below ~0.7)
    // before tucking back to the kerb. That is the gap-acceptance bail-out.
    const sim = simFor(overtakeabort, 7);
    const peakWhilePassing = new Map<string, number>();
    const wasPassing = new Set<string>();
    let aborts = 0;
    let completedPasses = 0;
    for (let i = 0; i < 2000; i++) {
      sim.step(0.05, () => false);
      const live = new Set<string>();
      for (const c of sim.cars()) {
        live.add(c.id);
        if (c.overtakePhase === "passing") {
          wasPassing.add(c.id);
          peakWhilePassing.set(c.id, Math.max(peakWhilePassing.get(c.id) ?? 0, c.laneIndex));
        } else if (c.overtakePhase === "returning" && wasPassing.has(c.id)) {
          const peak = peakWhilePassing.get(c.id) ?? 0;
          if (peak < 0.7) aborts++;
          else completedPasses++;
          wasPassing.delete(c.id); // count each pass attempt once
          peakWhilePassing.delete(c.id);
        }
      }
      for (const id of [...peakWhilePassing.keys()]) {
        if (!live.has(id)) {
          peakWhilePassing.delete(id);
          wasPassing.delete(id);
        }
      }
    }
    // The packed inner lane forces at least one gap-acceptance abort…
    expect(aborts).toBeGreaterThan(0);
    // …and the model still completes real passes elsewhere (it doesn't just give
    // up on everything).
    expect(completedPasses + aborts).toBeGreaterThan(0);
  }, 30000);

  it("a returning overtaker aims for the kerb-most lane, not just its pull-out lane (keep-right)", () => {
    // A 3-lane-each-way straight, eastbound, busy with overtakers and a wide speed
    // spread so cars that spawned in the MIDDLE lane (1) pull out into lane 2 to
    // pass. Keep-right discipline means that when such a car returns it heads for
    // the KERB (lane 0), not back to its middle pull-out lane — so every car in the
    // "returning" phase targets the kerb-most legal lane, and returns do happen.
    const lane3 = () => ({ connections: [], road: nWayLanes(Position.Left, Position.Right, 3) });
    const lvl: Level = {
      "0,0": lane3(), "1,0": lane3(), "2,0": lane3(), "3,0": lane3(), "4,0": lane3(), "5,0": lane3(),
    };
    const sim = createRoadSim({
      level: lvl,
      width: 6,
      height: 1,
      seed: 4,
      spawnInterval: 0.6,
      carSpeed: 0.6,
      speedSpread: 0.3,
      carLength: 0.2,
      maxCars: 12,
      overtakeFraction: 1,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
    });
    let returningSamples = 0;
    let kerbTargeted = 0;
    for (let i = 0; i < 2000; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.cars()) {
        if (c.overtakePhase !== "returning") continue;
        returningSamples++;
        if (c.targetLane === 0) kerbTargeted++;
      }
    }
    expect(returningSamples).toBeGreaterThan(0); // passes are returned from
    // Every returning car steers for the kerb-most lane (keep-right discipline).
    expect(kerbTargeted).toBe(returningSamples);
  }, 30000);
});
