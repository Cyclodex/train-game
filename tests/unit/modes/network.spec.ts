import { describe, it, expect } from "vitest";
import {
  networkMode,
  passengerTargetOf,
  stationCount,
  OVERCROWD_LIMIT,
  PASSENGERS_PER_STATION,
  briskSecondsFor,
} from "@/modes/network";
import { createObjectiveTracker, emptyObservation } from "@/sim/objectives";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";
import { networkmode } from "@/levels/test/scenarios/networkmode";
import { createGame, TrainDef } from "@/game";
import { MODES } from "@/modes/index";

function twoStationLevel(): Level {
  return {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("station", 1),
    "2,0": expandKind("straight", 1),
    "3,0": expandKind("station", 1),
    "4,0": expandKind("depot", 3),
  };
}

const setupFor = (level: Level) =>
  networkMode.setup({ level, trains: [], levelId: "test" });

describe("network mode setup", () => {
  it("scales the passenger target with the number of stations", () => {
    expect(stationCount(twoStationLevel())).toBe(2);
    expect(passengerTargetOf(twoStationLevel())).toBe(2 * PASSENGERS_PER_STATION);
  });

  it("asks for at least one station's worth, even on a board with none", () => {
    expect(passengerTargetOf({})).toBe(PASSENGERS_PER_STATION);
  });

  it("scores people, not parked trains: no delivery requirement, an overcrowd fail", () => {
    const spec = setupFor(twoStationLevel()).objective;
    expect(spec.deliveriesRequired).toBe(0);
    expect(spec.passengersRequired).toBe(2 * PASSENGERS_PER_STATION);
    expect(spec.fail?.maxStationQueue).toBe(OVERCROWD_LIMIT);
  });

  it("shows the passenger card instead of the delivery card", () => {
    expect(networkMode.hud.passengers).toBe(true);
    expect(networkMode.hud.deliveries).toBe(false);
  });

  it("takes the points away from the player — the TRAIN decides where it goes", () => {
    expect(networkMode.controls.switches).toBe(false);
    // …and leaves the signals, which are about WHEN a train goes, not where.
    expect(networkMode.controls.signalHolds).toBe(true);
    // Every other mode still hands the player the points, unchanged.
    for (const mode of MODES.filter(m => m.id !== networkMode.id)) {
      expect(mode.controls.switches, `${mode.id} lost its switches`).toBe(true);
    }
  });
});

describe("network mode objective", () => {
  const trackerFor = (level: Level) =>
    networkMode.createObjective(setupFor(level));

  it("does NOT win at t=0 just because no deliveries are required", () => {
    const tracker = trackerFor(twoStationLevel());
    tracker.start();
    tracker.observe({ ...emptyObservation }, 0.1);
    expect(tracker.state().phase).toBe("playing");
  });

  it("wins once the passengers are carried", () => {
    const tracker = trackerFor(twoStationLevel());
    tracker.start();
    const target = passengerTargetOf(twoStationLevel());
    for (let i = 0; i < target; i++) {
      tracker.observe({ ...emptyObservation, passengersDeliveredDelta: 1 }, 0.1);
    }
    expect(tracker.state().phase).toBe("won");
    expect(tracker.state().counters.passengersDelivered).toBe(target);
  });

  it("loses when a platform overflows, and names the reason", () => {
    const tracker = trackerFor(twoStationLevel());
    tracker.start();
    tracker.observe(
      { ...emptyObservation, maxStationQueue: OVERCROWD_LIMIT + 1 },
      0.1
    );
    const state = tracker.state();
    expect(state.phase).toBe("lost");
    expect(state.lostReason).toMatch(/platform overflowed/i);
  });

  it("keeps the peak platform as a high-water mark once the crowd drains", () => {
    const tracker = trackerFor(twoStationLevel());
    tracker.start();
    tracker.observe({ ...emptyObservation, maxStationQueue: 5 }, 0.1);
    tracker.observe({ ...emptyObservation, maxStationQueue: 0 }, 0.1);
    expect(tracker.state().counters.peakStationQueue).toBe(5);
  });
});

describe("the mode's own scenario", () => {
  it("runs under the network mode and has stations to serve", () => {
    expect(networkmode.modeId).toBe("network");
    expect(stationCount(networkmode.level)).toBeGreaterThan(1);
  });
});

describe("other modes are unaffected by the passenger win", () => {
  it("still wins on deliveries alone when no passenger target is stated", () => {
    const tracker = createObjectiveTracker({ deliveriesRequired: 1 });
    tracker.start();
    tracker.observe({ ...emptyObservation, deliveredDelta: 1 }, 0.1);
    expect(tracker.state().phase).toBe("won");
  });

  it("ignores a crowded platform when the board states no overcrowd rule", () => {
    const tracker = createObjectiveTracker({ deliveriesRequired: 2 });
    tracker.start();
    tracker.observe({ ...emptyObservation, maxStationQueue: 99 }, 0.1);
    expect(tracker.state().phase).toBe("playing");
  });
});

// The balance guard. A mode whose only board cannot be won is not a mode, and
// the first cut of this one lost in 19 seconds — demand rates that had never
// been set against what a train can actually carry. This drives the real board
// headlessly and insists it is still winnable, so a future tuning change to
// stationDemandOf (or to the board) cannot quietly make it impossible again.
describe("the network board is winnable — and not trivially", () => {
  function playScenario(seconds: number) {
    const trains: TrainDef[] = Object.values(networkmode.trains).map(t => ({
      id: t.id,
      x: t.x,
      y: t.y,
      type: t.type,
      wagonIds: (t.wagons ?? []).map(w => w.id),
      // The board's train is IN SERVICE on a line — without this it would
      // follow the points instead of driving its route, which is a different
      // board entirely.
      ...(t.line?.length ? { line: t.line } : {}),
    }));
    const game = createGame(
      networkmode.level,
      trains,
      200,
      networkMode,
      1,
      networkmode.colors
    );
    game.startObjective();
    for (let t = 0; t < seconds; t += 0.1) {
      game.advance(0.1);
      if (game.objective.phase !== "playing") break;
    }
    return game;
  }

  it("is won by a train that just keeps running its line, inside the brisk time", () => {
    const game = playScenario(180);
    const c = game.objective.counters;
    expect(game.objective.phase).toBe("won");
    expect(c.passengersDelivered ?? 0).toBeGreaterThanOrEqual(
      passengerTargetOf(networkmode.level)
    );
    expect(c.elapsedSec).toBeLessThanOrEqual(
      briskSecondsFor(passengerTargetOf(networkmode.level))
    );
  });

  it("is not a walkover: the crowds really build while the train works", () => {
    const game = playScenario(180);
    const peak = game.objective.counters.peakStationQueue ?? 0;
    // Well above empty (there is real pressure) but under the overflow that
    // ends the run — the window the whole mode lives in.
    expect(peak).toBeGreaterThan(OVERCROWD_LIMIT / 2);
    expect(peak).toBeLessThanOrEqual(OVERCROWD_LIMIT);
  });

  it("keeps the service running: the train never terminates anywhere", () => {
    const game = playScenario(90);
    // A ring has no turn-back and no destination depot, so the train should
    // simply still be in service — parked would mean the service died.
    expect(game.sim.trainState("circle")).not.toBe("parked");
    expect(game.sim.trainNextStop("circle")).toBeDefined();
  });

  it("serves every station on the line, not just the near ones", () => {
    const trains: TrainDef[] = Object.values(networkmode.trains).map(t => ({
      id: t.id,
      x: t.x,
      y: t.y,
      type: t.type,
      wagonIds: (t.wagons ?? []).map(w => w.id),
      ...(t.line?.length ? { line: t.line } : {}),
    }));
    const game = createGame(
      networkmode.level,
      trains,
      200,
      networkMode,
      1,
      networkmode.colors
    );
    game.startObjective();
    const called = new Set<string>();
    for (let t = 0; t < 180; t += 0.1) {
      game.advance(0.1);
      const stop = game.sim.trainNextStop("circle");
      if (stop) called.add(stop);
      if (game.objective.phase !== "playing") break;
    }
    // Every stop on the authored line became the train's target at some point.
    for (const stop of networkmode.trains.circle.line ?? []) {
      expect(called.has(stop), `never headed for ${stop}`).toBe(true);
    }
  });
});

// The verbs the service panel calls. They live on the GAME (not the view), so
// the whole player loop of this mode — order a train, put it on a line, take
// it off again — is testable without a browser.
describe("the service: buying trains and setting lines", () => {
  function gameFor() {
    const trains: TrainDef[] = Object.values(networkmode.trains).map(t => ({
      id: t.id,
      x: t.x,
      y: t.y,
      type: t.type,
      wagonIds: (t.wagons ?? []).map(w => w.id),
      ...(t.line?.length ? { line: t.line } : {}),
    }));
    return createGame(
      networkmode.level,
      trains,
      200,
      networkMode,
      1,
      networkmode.colors
    );
  }

  it("mirrors the authored line, and the reverse index the platforms read", () => {
    const game = gameFor();
    const stops = networkmode.trains.circle.line ?? [];
    expect(game.trainLines.circle).toEqual(stops);
    // Every stop knows the livery calling there.
    for (const stop of stops) {
      expect(game.stationLines[stop]).toContain(game.trainColors.circle);
    }
  });

  it("setLine re-routes a train in service, and [] takes it out", () => {
    const game = gameFor();
    const one = [game.stationTiles[0]];
    expect(game.setLine("circle", one)).toBe(true);
    expect(game.trainLines.circle).toEqual(one);
    expect(game.sim.trainNextStop("circle")).toBe(one[0]);

    expect(game.setLine("circle", [])).toBe(true);
    expect(game.trainLines.circle).toBeUndefined();
    expect(game.sim.trainNextStop("circle")).toBeUndefined();
    expect(game.setLine("nobody", one)).toBe(false);
  });

  it("buys a train at a free depot, in service on the line it was given", () => {
    const game = gameFor();
    // The authored train is standing in the only depot at t=0, so make room by
    // running until it has pulled out. Ask the SIM, not `game.occupied` — that
    // is the render mirror and it is only refreshed inside the rAF frame, so
    // headless it stays empty for ever (the hidden-tab trap).
    for (let t = 0; t < 20 && game.sim.occupiedBy(game.depotTiles[0]); t += 0.1) {
      game.advance(0.1);
    }
    const stops = game.stationTiles.slice(0, 2);
    const id = game.buyTrain(stops);
    expect(id).not.toBeNull();
    expect(game.trainLines[id!]).toEqual(stops);
    expect(game.sim.trainNextStop(id!)).toBe(stops[0]);
    // It is a real train: it has a livery and the sim is driving it.
    expect(game.trainColors[id!]).toBeTruthy();
    expect(game.sim.trainState(id!)).not.toBe("parked");
  });

  it("refuses to build a train on top of one standing in the depot", () => {
    const game = gameFor();
    // At t=0 the authored train has not moved: the depot is occupied.
    expect(game.sim.occupiedBy(game.depotTiles[0])).toBeTruthy();
    expect(game.buyTrain([])).toBeNull();
  });
});
