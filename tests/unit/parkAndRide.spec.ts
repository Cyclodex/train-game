import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { sandboxMode } from "@/modes/sandbox";
import { parkandride } from "@/levels/test/scenarios/parkandride";
import { stationDemandOf } from "@/tiles/catchment";

// The park & ride transfer runs in game.advance() — the headless world step —
// which is what makes THIS test possible: drive the world without a browser
// and watch parked cars become platform passengers. If the transfer ever moves
// into a render-only path (the rAF/hidden-tab trap), this spec goes silent red.
describe("park & ride: parked cars feed the station queue", () => {
  it("puts more passengers on the platform than the schedule alone can", () => {
    const trains: TrainDef[] = Object.values(parkandride.trains).map(t => ({
      id: t.id,
      x: t.x,
      y: t.y,
      type: t.type,
      wagonIds: (t.wagons ?? []).map(w => w.id),
    }));
    const game = createGame(
      parkandride.level,
      trains,
      200,
      sandboxMode,
      1,
      parkandride.colors
    );

    const seconds = 60;
    for (let t = 0; t < seconds; t += 0.1) game.advance(0.1);

    // Everyone who ever appeared on the platform is either still queueing,
    // riding the train, or already delivered.
    const appeared =
      game.sim.stationQueue("2,0") +
      game.sim.trainPassengers("train1") +
      game.sim.passengersDelivered();

    // What the station's OWN schedule could produce in the window — derived,
    // not hardcoded, so retuning the demand rates can never quietly turn this
    // into a test that passes on the schedule alone. Anything beyond it
    // arrived BY CAR.
    const schedule = stationDemandOf(parkandride.level, "2,0");
    const scheduleOnly =
      (schedule.initial ?? 0) + Math.floor(seconds / schedule.intervalSec);
    expect(appeared).toBeGreaterThan(scheduleOnly);
  });
});
