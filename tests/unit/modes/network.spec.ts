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
// stationDemandOf (or to the shuttle) cannot quietly make it impossible again.
describe("the network board is winnable — and not trivially", () => {
  function playScenario(seconds: number) {
    const trains: TrainDef[] = Object.values(networkmode.trains).map(t => ({
      id: t.id,
      x: t.x,
      y: t.y,
      type: t.type,
      wagonIds: (t.wagons ?? []).map(w => w.id),
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

  it("is won by a shuttle that just keeps running, inside the brisk time", () => {
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

  it("is not a walkover: the crowds really build while the shuttle works", () => {
    const game = playScenario(180);
    const peak = game.objective.counters.peakStationQueue ?? 0;
    // Well above empty (there is real pressure) but under the overflow that
    // ends the run — the window the whole mode lives in.
    expect(peak).toBeGreaterThan(OVERCROWD_LIMIT / 2);
    expect(peak).toBeLessThanOrEqual(OVERCROWD_LIMIT);
  });

  it("keeps the shuttle shuttling: it never parks, it bounces", () => {
    const game = playScenario(90);
    // Both depots mismatch on purpose, so every turn-back is a "mismatched"
    // arrival. Zero of them would mean the train parked and the service died.
    expect(game.objective.counters.mismatchedArrivals).toBeGreaterThan(0);
  });
});
