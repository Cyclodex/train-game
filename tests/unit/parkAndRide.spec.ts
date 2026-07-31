import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { sandboxMode } from "@/modes/sandbox";
import { parkandride } from "@/levels/test/scenarios/parkandride";

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

    // The lonely-halt schedule alone manages `initial` (2) plus one walker per
    // 15 s. Anything beyond that bound arrived BY CAR.
    const scheduleOnly = 2 + Math.floor(seconds / 15);
    expect(appeared).toBeGreaterThan(scheduleOnly);
  });
});
