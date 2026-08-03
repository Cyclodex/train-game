import { describe, it, expect } from "vitest";
import { computed } from "vue";
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
import { Position } from "@/types";

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
    for (let t = 0; t < 30 && game.sim.occupiedBy(game.depotTiles[0]); t += 0.1) {
      game.advance(0.1);
    }
    const stops = game.stationTiles.slice(0, 2);
    const def = game.buyTrain(stops);
    expect(def).not.toBeNull();
    const id = def!.id;
    expect(game.trainLines[id]).toEqual(stops);
    expect(game.sim.trainNextStop(id)).toBe(stops[0]);
    // It is a real train: it has a livery and the sim is driving it.
    expect(game.trainColors[id]).toBeTruthy();
    expect(game.sim.trainState(id)).not.toBe("parked");
    expect(game.queuedTrains).not.toContain(id);
  });

  // The depot is a QUEUE, not a gate: ordering never fails for want of room —
  // what a busy shed delays is the departure, not the purchase.
  it("queues trains ordered while the shed is busy, and rolls them out in order", () => {
    const game = gameFor();
    // At t=0 the authored train is still standing in the only depot.
    expect(game.sim.occupiedBy(game.depotTiles[0])).toBeTruthy();

    const stops = game.stationTiles.slice(0, 2);
    const first = game.buyTrain(stops);
    const second = game.buyTrain(stops);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // Both were sold, and both are waiting their turn on the metals.
    expect(game.queuedTrains).toEqual([first!.id, second!.id]);
    expect(game.sim.trains[first!.id]).toBeUndefined();
    // The line they were BOUGHT for is theirs from the moment of sale — the
    // panel reads `trainLines`, and "no line" on an order you just placed onto
    // a line reads as "that did not work".
    expect(game.trainLines[first!.id]).toEqual(stops);
    expect(game.trainLines[second!.id]).toEqual(stops);

    // Run: they leave one after another, oldest first, as the mouth clears.
    let firstOutAt = -1;
    let secondOutAt = -1;
    for (let t = 0; t < 120; t += 0.1) {
      game.advance(0.1);
      if (firstOutAt < 0 && game.sim.trains[first!.id]) firstOutAt = t;
      if (secondOutAt < 0 && game.sim.trains[second!.id]) secondOutAt = t;
      if (secondOutAt >= 0) break;
    }
    expect(firstOutAt).toBeGreaterThan(0);
    expect(secondOutAt).toBeGreaterThan(firstOutAt);
    expect(game.queuedTrains).toEqual([]);
    // Both ended up in service on the line they were bought for.
    expect(game.trainLines[first!.id]).toEqual(stops);
    expect(game.trainLines[second!.id]).toEqual(stops);
  });

  it("returns null only when the board has no depot at all", () => {
    const game = createGame(
      { "0,0": expandKind("station", 1) },
      [],
      200,
      networkMode,
      1
    );
    expect(game.depotTiles).toEqual([]);
    expect(game.buyTrain([])).toBeNull();
  });

  // THE ROSTER IS A VIEW SOURCE, so it has to be reactive. The service panel's
  // list of trains is a Vue computed over `game.trainColors`, and `game` is
  // provided markRaw — so if that record is a plain object the computed has
  // nothing to track, caches its first answer, and a bought train NEVER appears
  // in the panel. On a network board that starts with no trains the list then
  // stays empty for ever, however many you order.
  //
  // This is the same reactivity trap as `trainNextStops`/`retiringTrains`, hit
  // a third time, which is why it is tested here rather than trusted: reading
  // `game.trainColors` directly would pass even when the panel is frozen.
  it("a bought train reaches a view derived from the roster", () => {
    const game = gameFor();
    const roster = computed(() => Object.keys(game.trainColors).sort());
    // Prime the cache exactly as the panel's first render does.
    const before = [...roster.value];
    const def = game.buyTrain([]);
    expect(def).not.toBeNull();
    expect(before).not.toContain(def!.id);
    expect(roster.value).toContain(def!.id);
  });

  // ROUTING A TRAIN THAT IS STILL IN THE SHED. This is the normal case, not an
  // edge one: the depot mouth is busy whenever another train is standing in it,
  // so a train bought right then is queued — and the very next thing the player
  // does is click stations to give it a line. The sim has no entry for a queued
  // train, so going through `sim.assignLine` alone refused every one of those
  // clicks WITHOUT SAYING SO: the panel kept reading "no line" and the board
  // did nothing, on a board where buying is the whole verb set.
  it("routes a train that is still queued in the shed, and it keeps that line when it rolls out", () => {
    const game = gameFor();
    // At t=0 the authored train occupies the only depot, so this order queues.
    const def = game.buyTrain([]);
    expect(def).not.toBeNull();
    const id = def!.id;
    expect(game.queuedTrains).toContain(id);
    expect(game.sim.trains[id]).toBeUndefined();

    const stops = game.stationTiles.slice(0, 2);
    expect(game.setLine(id, stops)).toBe(true);
    // The panel reads this — it must show the line straight away, not after
    // the train happens to leave.
    expect(game.trainLines[id]).toEqual(stops);
    // And the platforms know a second service calls there.
    for (const stop of stops) {
      expect(game.stationLines[stop]).toContain(game.trainColors[id]);
    }

    // Run until it rolls out: the line it was given while queued is the line
    // it actually works.
    for (let t = 0; t < 120 && !game.sim.trains[id]; t += 0.1) game.advance(0.1);
    expect(game.sim.trains[id]).toBeDefined();
    expect(game.sim.trainLine(id)).toEqual(stops);
    expect(game.trainLines[id]).toEqual(stops);
  });

  it("still refuses a line for a train that does not exist at all", () => {
    const game = gameFor();
    expect(game.setLine("nobody", game.stationTiles.slice(0, 1))).toBe(false);
  });

  // Scrapping runs the other way through the same list.
  it("a scrapped train leaves a view derived from the roster", () => {
    const game = gameFor();
    const listed = computed(() =>
      Object.keys(game.trainColors)
        .filter(id => !game.removedTrains.includes(id))
        .sort()
    );
    expect(listed.value).toContain("circle");
    game.scrapTrain("circle");
    expect(listed.value).not.toContain("circle");
  });
});

// Withdrawing a train. Two verbs on purpose: the orderly one is a JOURNEY (it
// runs to a depot and is stabled there), the emergency one is instant and
// deliberately unrealistic — so they cannot be the same call.
describe("taking a train out of service", () => {
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

  it("retires the orderly way: drops the line, runs to a depot, is stabled there", () => {
    const game = gameFor();
    for (let t = 0; t < 20; t += 0.1) game.advance(0.1); // get it out on the ring

    expect(game.retireTrain("circle")).toBe(true);
    // It is out of service immediately — no line, taking nobody new…
    expect(game.trainLines.circle).toBeUndefined();
    expect(game.sim.isRetiring("circle")).toBe(true);
    // …but still on the board, running to its shed.
    expect(game.sim.trains.circle).toBeDefined();
    expect(game.removedTrains).not.toContain("circle");

    // It gets there, and then it is gone from the game.
    for (let t = 0; t < 120 && game.sim.trains.circle; t += 0.1) game.advance(0.1);
    expect(game.sim.trains.circle).toBeUndefined();
    expect(game.removedTrains).toContain("circle");
    expect(game.trainLines.circle).toBeUndefined();
  });

  it("takes no new passengers once withdrawn", () => {
    const game = gameFor();
    for (let t = 0; t < 20; t += 0.1) game.advance(0.1);
    game.retireTrain("circle");
    // Run it to the shed and watch: it may drop riders, never pick any up.
    let maxAboard = 0;
    for (let t = 0; t < 120 && game.sim.trains.circle; t += 0.1) {
      game.advance(0.1);
      maxAboard = Math.max(maxAboard, game.sim.trainPassengers("circle"));
    }
    // Whatever it was carrying when withdrawn only ever goes down.
    expect(game.sim.trains.circle).toBeUndefined();
    expect(maxAboard).toBeLessThanOrEqual(24);
  });

  it("scraps a train where it stands, releasing what it held", () => {
    const game = gameFor();
    for (let t = 0; t < 20; t += 0.1) game.advance(0.1);
    const tile = game.sim.trainTileId("circle");
    expect(game.sim.occupiedBy(tile)).toBe("circle");

    expect(game.scrapTrain("circle")).toBe(true);
    expect(game.sim.trains.circle).toBeUndefined();
    expect(game.removedTrains).toContain("circle");
    // The metals it was standing on are free again.
    expect(game.sim.occupiedBy(tile)).toBeUndefined();
    expect(game.scrapTrain("circle")).toBe(false); // gone is gone
  });

  it("cancels an order that is still queued in the shed", () => {
    const game = gameFor();
    const def = game.buyTrain(game.stationTiles.slice(0, 2));
    expect(game.queuedTrains).toContain(def!.id);
    // Withdrawing one that never left the shed is just cancelling the order.
    expect(game.retireTrain(def!.id)).toBe(true);
    expect(game.queuedTrains).not.toContain(def!.id);
    expect(game.removedTrains).toContain(def!.id);
    // And it never appears on the metals afterwards.
    for (let t = 0; t < 60; t += 0.1) game.advance(0.1);
    expect(game.sim.trains[def!.id]).toBeUndefined();
  });

  it("keeps the rest of the service running when one train leaves", () => {
    const game = gameFor();
    for (let t = 0; t < 20; t += 0.1) game.advance(0.1);
    const extra = game.buyTrain(networkmode.trains.circle.line ?? []);
    for (let t = 0; t < 40; t += 0.1) game.advance(0.1);
    game.scrapTrain("circle");
    for (let t = 0; t < 40; t += 0.1) game.advance(0.1);
    // The remaining train is unaffected and still working its line.
    expect(game.sim.trains[extra!.id]).toBeDefined();
    expect(game.sim.trainNextStop(extra!.id)).toBeDefined();
    expect(game.sim.trainState(extra!.id)).not.toBe("parked");
  });
});

// The line overlay: what the board shows while a line is being drawn. It is
// engine work, not decoration — the route comes from the same planner the
// trains drive, so the picture cannot disagree with where they will go.
describe("the line overlay", () => {
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

  it("numbers the stops in call order and draws the metals between them", () => {
    const game = gameFor();
    game.setLineOverlay("circle");
    const stops = networkmode.trains.circle.line ?? [];
    stops.forEach((id, i) => {
      expect(game.lineOverlay.order[id]).toBe(i + 1);
    });
    // The ring's tiles are drawn, and each carries the SEGMENTS driven.
    expect(Object.keys(game.lineOverlay.path).length).toBeGreaterThan(stops.length);
    for (const segs of Object.values(game.lineOverlay.path)) {
      expect(segs.length).toBeGreaterThan(0);
    }
  });

  it("never lights an arm the line does not take — the depot spur stays dark", () => {
    const game = gameFor();
    game.setLineOverlay("circle");
    // 1,3 is the T where the shed joins the ring: the line runs THROUGH it
    // (north-south) and never turns into the depot.
    const atJunction = game.lineOverlay.path["1,3"] ?? [];
    expect(atJunction.length).toBeGreaterThan(0);
    for (const [a, b] of atJunction) {
      expect([a, b]).not.toContain(Position.Left); // Left is the shed
    }
    // …and the depot tile itself is not on the drawn line at all.
    expect(game.lineOverlay.path["0,3"]).toBeUndefined();
  });

  it("redraws as the line is edited, and clears on null", () => {
    const game = gameFor();
    game.setLineOverlay("circle");
    const before = Object.keys(game.lineOverlay.path).length;

    game.setLine("circle", game.stationTiles.slice(0, 2));
    expect(Object.keys(game.lineOverlay.order).length).toBe(2);
    expect(Object.keys(game.lineOverlay.path).length).not.toBe(before);

    game.setLineOverlay(null);
    expect(game.lineOverlay.trainId).toBeNull();
    expect(game.lineOverlay.order).toEqual({});
    expect(game.lineOverlay.path).toEqual({});
  });

  it("names every platform, so the panel lists places and not coordinates", () => {
    const game = gameFor();
    expect(game.stationLabels["2,1"]).toBe("Nordstadt");
    expect(Object.keys(game.stationLabels).sort()).toEqual(
      game.stationTiles.slice().sort()
    );
  });
});
