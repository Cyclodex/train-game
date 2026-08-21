import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { citizensModeWith } from "@/modes/citizens";
import { networkMode } from "@/modes/network";
import { busride, WEST_HALT, EAST_HALT } from "@/levels/test/scenarios/busride";
import {
  edgedemand,
  EDGE_STATION,
  PLAIN_STATION,
} from "@/levels/test/scenarios/edgedemand";
import { Level } from "@/tiles/model";
import type { TestScenario } from "@/levels/test/scenario";
import { itSlow } from "./support/tier";

// THE DEMAND CONVERGENCE, phase 1 (#117): the per-mode XOR between citizen
// demand and the synthetic per-station schedule becomes two DEFAULTS of one
// per-stop dial (`TileCell.edgeDemand`), and citizens ride the shared carrier
// layer — buses included — instead of the rail sim alone.
//
// Everything here runs through `game.advance()`, the headless world step, so
// the whole loop is provable without a browser: real buses on real streets,
// real platforms, and people whose journeys those calls begin and end.
// Design: docs/superpowers/specs/2026-08-21-economy-demand-convergence-design.md

function defsOf(scenario: TestScenario): TrainDef[] {
  return Object.values(scenario.trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
  }));
}

const run = (g: ReturnType<typeof createGame>, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.2) g.advance(0.2);
};

// A day short enough to test against. The shipped calibration is 1800 board
// seconds; compressing it is stated out loud here rather than the calibration
// being quietly bent to keep the suite fast.
const DAY = 300;

describe("citizens ride the bus (#117 step 1)", () => {
  function busGame() {
    const game = createGame(
      busride.level,
      [],
      200,
      citizensModeWith({ secPerDay: DAY }),
      1,
      undefined,
      busride.traffic,
      "busride"
    );
    // What TestStage does for an authored `busLines` board: the line exists
    // and one bus runs it from the start.
    game.buyBus(game.createLine([WEST_HALT, EAST_HALT]));
    return game;
  }

  it("quotes the bus as transit: commuters queue at the kerb under their own names", () => {
    const game = busGame();
    // The morning peak (the board opens at 07:00). There is NO railway on this
    // board and no edge demand (citizen default 0), so anyone in the halt's
    // queue is a citizen who chose transit — which, before #117, was
    // impossible: boarding points were rail stations only, and this board
    // refused every transit quote with "no station in reach". Sampled as a
    // PEAK, not a snapshot: the bus works the queue down between arrivals.
    let peak = 0;
    for (let t = 0; t < 60; t += 0.2) {
      game.advance(0.2);
      peak = Math.max(peak, game.sim.stationQueue(WEST_HALT));
    }
    expect(peak).toBeGreaterThan(0);
  });

  itSlow("carries them end to end: boarding and alighting mirrored off the bus's own calls", () => {
    const game = busGame();
    run(game, 2 * DAY);
    const s = game.citizenStats;
    // `modeShare` counts COMPLETED trips, and a transit trip completes only by
    // being boarded and set down again — which, with no rail on the board,
    // can only have happened through a bus's exchange events. A non-zero
    // transit slice is therefore proof the citizens rode an actual bus.
    expect(s.modeShare.transit).toBeGreaterThan(0);
    expect(s.tripsCompleted).toBeGreaterThan(0);
    // The far commutes are past every bike's range and half the town owns no
    // car, so the bus is load-bearing, not decorative.
    expect(game.sim.passengersDelivered()).toBeGreaterThan(0);
  });

  itSlow("a deleted line sets its riders down instead of stranding them", () => {
    const game = busGame();
    // Run into the peak until somebody is actually aboard the bus.
    let sawRider = false;
    for (let t = 0; t < 2 * DAY && !sawRider; t += 0.2) {
      game.advance(0.2);
      sawRider = game.busServices.some(b => b.passengers > 0);
    }
    expect(sawRider).toBe(true);
    const line = game.lines[0]?.id;
    expect(line).toBeTruthy();
    expect(game.deleteLine(line)).toBe(true);
    game.advance(0.2);
    // Everyone was set down at the last stop the bus called at — a citizen in
    // a seat is driven only by events, so a manifest surviving the line would
    // be a person frozen mid-trip forever.
    expect(game.busServices.every(b => b.passengers === 0)).toBe(true);
  });

  it("a reset empties the buses too — no riders carried into the new world", () => {
    const game = busGame();
    run(game, 90); // into the peak: somebody has boarded by now
    game.reset();
    game.advance(0.2);
    expect(game.busServices.every(b => b.passengers === 0)).toBe(true);
    expect(game.sim.passengersDelivered()).toBe(0);
  });
});

describe("edge demand is additive (#117 step 2)", () => {
  function edgeGame(overrides: { startHour?: number } = {}) {
    return createGame(
      edgedemand.level,
      defsOf(edgedemand),
      200,
      citizensModeWith({ secPerDay: DAY, ...overrides }),
      1,
      edgedemand.colors,
      undefined,
      "edgedemand"
    );
  }

  it("imports travellers at the dialled platform while the town sleeps — and only there", () => {
    // 03:00: no citizen travels at night, so anything on a platform came from
    // off the map. The west platform carries `edgeDemand: 1` (the full derived
    // schedule); the east platform has no dial, and under the citizen layer
    // its default is 0 — exactly the old XOR, surviving as a default.
    const game = edgeGame({ startHour: 3 });
    run(game, 30);
    expect(game.sim.stationQueue(EDGE_STATION)).toBeGreaterThan(0);
    expect(game.sim.stationQueue(PLAIN_STATION)).toBe(0);
  });

  it("the shuttle carries the edge riders: deliveries land overnight", () => {
    const game = edgeGame({ startHour: 1 });
    // 55s of a 300s day is 01:00 → 05:24 — still before anyone's earliest
    // possible departure (07:00), so the citizens provably slept through it.
    run(game, 55);
    // Nobody in town has travelled yet; every delivery is an imported rider.
    expect(game.sim.passengersDelivered()).toBeGreaterThan(0);
    expect(game.citizenStats.tripsCompleted).toBe(0);
  });

  itSlow("citizens and edge riders share the platform without double-counting", () => {
    const game = edgeGame();
    run(game, 2 * DAY);
    const s = game.citizenStats;
    // The commuters still complete their journeys through the same queue the
    // edge riders spawn into (they compete for seats, never for identity:
    // citizens are tagged, edge riders are anonymous)...
    expect(s.modeShare.transit).toBeGreaterThan(0);
    expect(s.tripsCompleted).toBeGreaterThan(0);
    // ...and the platform total serves both. Deliveries exceed the citizens'
    // completed transit trips, because the edge riders arrive on top.
    const citizenTransitTrips = Math.round(s.modeShare.transit * s.tripsCompleted);
    expect(game.sim.passengersDelivered()).toBeGreaterThan(citizenTransitTrips);
  });

  it("an explicit 0 turns a synthetic platform OFF on a board without citizens", () => {
    // The other side of the default: no citizen layer means every stop runs
    // its full derived schedule (share 1) — unless the board says otherwise.
    const muted: Level = structuredClone(edgedemand.level);
    muted[EDGE_STATION] = { ...muted[EDGE_STATION], edgeDemand: 0 };
    const game = createGame(
      muted,
      defsOf(edgedemand),
      200,
      networkMode,
      1,
      edgedemand.colors,
      undefined,
      "edgedemand-muted"
    );
    run(game, 30);
    // The un-dialled platform seeds and spawns its derived crowd; the muted
    // one stays empty. `??` semantics, never `||`: 0 must mean off.
    expect(game.sim.stationQueue(PLAIN_STATION)).toBeGreaterThan(0);
    expect(game.sim.stationQueue(EDGE_STATION)).toBe(0);
  });

  it("a hostile dial cannot hang the game: Infinity is clamped, not divided by", () => {
    // Level JSON is imported raw, and the dial divides a spawn interval — an
    // interval driven to 0 never leaves advanceDemand's catch-up loop. The
    // share is clamped instead, so this board TICKS rather than hanging, and
    // the platform fills at the clamped (fast) rate up to its cap.
    const hostile: Level = structuredClone(edgedemand.level);
    hostile[EDGE_STATION] = { ...hostile[EDGE_STATION], edgeDemand: Number.POSITIVE_INFINITY };
    const game = createGame(
      hostile,
      defsOf(edgedemand),
      200,
      networkMode,
      1,
      edgedemand.colors,
      undefined,
      "edgedemand-hostile"
    );
    run(game, 5);
    expect(game.sim.stationQueue(EDGE_STATION)).toBeGreaterThan(0);
  });
});
