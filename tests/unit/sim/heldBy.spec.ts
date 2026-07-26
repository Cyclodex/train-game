import { describe, it, expect } from "vitest";
import { createSimulation } from "@/sim/simulation";
import { Position } from "@/types";
import { heldby } from "@/levels/test/scenarios/heldby";

// What the fare pin's "held by …" state is made of.
//
// The pin renders `sim.trainBlock(id)`: a held train shows the reason it is
// standing still and, when the cause is another train, that train's id. This
// suite pins the sim side of that contract on the very board the scenario uses
// (imported, so a change to the board fails here rather than silently making the
// demo undemonstrative). The badge mapping in game.ts is a straight copy of these
// three fields.
function simOf() {
  return createSimulation({
    level: heldby.level,
    waitForDispatch: true,
    depotColors: heldby.colors!.depotColors,
    trains: [
      {
        id: "east",
        coord: { x: 0, y: 1 },
        entryPort: Position.Center,
        color: "green",
        type: "people",
        wagonCount: 2,
        speed: 1,
      },
      {
        id: "south",
        coord: { x: 1, y: 0 },
        entryPort: Position.Center,
        color: "red",
        type: "people",
        wagonCount: 2,
        speed: 1,
      },
    ],
  });
}

function run(sim: ReturnType<typeof simOf>, ticks: number) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...sim.step(0.1));
  return events;
}

describe("held-by reporting (what the fare pin shows)", () => {
  it("a WAITING train is not held — its pin is the Send button, not an excuse", () => {
    const sim = simOf();
    run(sim, 20);
    expect(sim.trainState("south")).toBe("waiting");
    expect(sim.trainBlock("south")).toBeUndefined();
  });

  it("names the train whose reserved block is in the way", () => {
    const sim = simOf();
    // Both sent at once, as the scenario tells the player to. `step` advances
    // trains in sorted id order, so "east" reaches the crossing first and the
    // race has one determined winner — no staggering needed to make the point.
    sim.dispatch("east");
    sim.dispatch("south");
    run(sim, 25);
    expect(sim.reservedBy("1,1")).toBe("east");

    const block = sim.trainBlock("south");
    expect(block?.reason).toBe("reservation");
    expect(block?.blockedBy).toBe("east");
    // Held means held: it noses out of the shed and parks its front on the stop
    // line at the tile edge, never entering the crossing. Position, not velocity,
    // is the honest test — `advance` clamps the movement to the stop line while
    // the velocity is still braking down for a second or two afterwards.
    expect(sim.trainTileId("south")).toBe("1,0");
    expect(sim.trainProgress("south")).toBe(1);
  });

  it("clears itself once the blocker is gone, with no second click", () => {
    const sim = simOf();
    sim.dispatch("east");
    sim.dispatch("south");
    run(sim, 25);
    expect(sim.trainBlock("south")).toBeDefined();

    // Nothing further is dispatched or toggled — east simply finishes its run.
    run(sim, 200);
    expect(sim.trainState("east")).toBe("parked");
    expect(sim.trainBlock("south")).toBeUndefined();
    expect(sim.trainTileId("south")).toBe("1,2");
  });
});
