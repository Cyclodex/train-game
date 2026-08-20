import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { sandboxMode } from "@/modes/sandbox";
import { parkandride } from "@/levels/test/scenarios/parkandride";
import { bikeandride } from "@/levels/test/scenarios/bikeandride";
import type { TestScenario } from "@/levels/test/scenario";
import { stationDemandOf } from "@/tiles/catchment";

// The park & ride transfer runs in game.advance() — the headless world step —
// which is what makes THIS test possible: drive the world without a browser
// and watch parked cars become platform passengers. If the transfer ever moves
// into a render-only path (the rAF/hidden-tab trap), this spec goes silent red.
describe("park & ride: parked cars feed the station queue", () => {
  // Drive a scenario's world headless for `seconds` and count everyone who ever
  // appeared on the platform, against what its own demand schedule could have
  // produced alone. Shared by the car and the bike variant: the transfer is the
  // same mechanism — a stall going free→taken within walking reach — whatever
  // rolled up to take the stall.
  function arrivalsBeyondSchedule(s: TestScenario, seconds: number) {
    const trains: TrainDef[] = Object.values(s.trains).map(t => ({
      id: t.id,
      x: t.x,
      y: t.y,
      type: t.type,
      wagonIds: (t.wagons ?? []).map(w => w.id),
      ...(t.line?.length ? { line: t.line } : {}),
    }));
    const game = createGame(s.level, trains, 200, sandboxMode, 1, s.colors);

    for (let t = 0; t < seconds; t += 0.1) game.advance(0.1);

    // Everyone who ever appeared on the platform is either still queueing,
    // riding the train, or already delivered.
    const appeared =
      game.sim.stationQueue("2,1") +
      game.sim.trainPassengers("train1") +
      game.sim.passengersDelivered();

    // What the station's OWN schedule could produce in the window — derived,
    // not hardcoded, so retuning the demand rates can never quietly turn this
    // into a test that passes on the schedule alone.
    const schedule = stationDemandOf(s.level, "2,1");
    const scheduleOnly =
      (schedule.initial ?? 0) + Math.floor(seconds / schedule.intervalSec);
    return { appeared, scheduleOnly };
  }

  it("puts more passengers on the platform than the schedule alone can", () => {
    // Anything beyond the schedule arrived BY CAR.
    const { appeared, scheduleOnly } = arrivalsBeyondSchedule(parkandride, 60);
    expect(appeared).toBeGreaterThan(scheduleOnly);
  });

  it("bike & ride: racked bikes feed the platform the same way", () => {
    // The sibling with the car bays swapped for a rack: anything beyond the
    // schedule arrived BY BIKE — one rider per racked bike (`transferSizeOf`'s
    // default arm, correct for a rack). A longer window than the car variant:
    // bikes ride at under half car pace, so they take longer to reach a stand.
    const { appeared, scheduleOnly } = arrivalsBeyondSchedule(bikeandride, 90);
    expect(appeared).toBeGreaterThan(scheduleOnly);
  });
});
