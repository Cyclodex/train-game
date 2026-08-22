import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { networkMode, NETWORK_CAPITAL } from "@/modes/network";
import { citizensModeWith, CITIZENS_TREASURY } from "@/modes/citizens";
import {
  passengerFare,
  PASSENGER_FARE_BOARDING,
  PASSENGER_FARE_PER_TILE,
} from "@/sim/economy";
import { createTransit, Rider } from "@/sim/transit";
import { farebox, WEST_STATION, EAST_STATION } from "@/levels/test/scenarios/farebox";
import { edgedemand, EDGE_STATION, PLAIN_STATION } from "@/levels/test/scenarios/edgedemand";
import type { TestScenario } from "@/levels/test/scenario";

// PASSENGERS PAY — phase 2 of the economy convergence: a delivered passenger
// pays a flag fall plus distance, collected once per journey at the moment the
// transit layer counts the delivery. The layer reports WHO was carried whence
// to where (`collectDeliveries`); the game prices it; the ledger banks it.
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

describe("the passenger fare", () => {
  it("is a flag fall plus straight-line distance", () => {
    expect(passengerFare("0,0", "7,0")).toBe(
      PASSENGER_FARE_BOARDING + 7 * PASSENGER_FARE_PER_TILE
    );
    expect(passengerFare("3,2", "10,2")).toBe(passengerFare("10,2", "3,2"));
  });
});

describe("the transit layer reports fare-worthy journeys", () => {
  const STOPS = ["0,0", "5,0", "9,0"];
  function layer() {
    return createTransit({
      isStop: id => STOPS.includes(id),
      demand: Object.fromEntries(STOPS.map(id => [id, { intervalSec: Infinity, max: 16 }])),
    });
  }

  it("keeps the ORIGIN through a change, and drains on collect", () => {
    const t = layer();
    // Two lines meeting at 5,0: a journey 0,0 → 9,0 changes there.
    const a = t.createLine(["0,0", "5,0"]);
    t.createLine(["5,0", "9,0"]);
    expect(t.enqueue("0,0", "9,0")).toBe(true);
    const manifest: Rider[] = [];
    t.exchange({ stopId: "0,0", lineId: a.id, capacity: 8, manifest });
    t.exchange({ stopId: "5,0", lineId: a.id, capacity: 8, manifest });
    // Changed at 5,0 — nothing finished yet.
    expect(t.collectDeliveries()).toEqual([]);
    // The second line carries them home.
    const b = t.lines().find(l => l.stops.includes("9,0"));
    const manifest2: Rider[] = [];
    t.exchange({ stopId: "5,0", lineId: b?.id, capacity: 8, manifest: manifest2 });
    t.exchange({ stopId: "9,0", lineId: b?.id, capacity: 8, manifest: manifest2 });
    // The journey is priced from where they SET OUT, not from the interchange.
    expect(t.collectDeliveries()).toEqual([{ from: "0,0", to: "9,0" }]);
    // Drained: a second collect is empty.
    expect(t.collectDeliveries()).toEqual([]);
  });

  it("a depot terminus records each rider's journey to where they actually got out", () => {
    const t = layer();
    t.deliverRiders(
      [
        { final: "9,0", off: "9,0", from: "0,0" },
        { final: "9,0", off: "9,0", from: "5,0" },
      ],
      "7,0"
    );
    expect(t.delivered()).toBe(2);
    expect(t.collectDeliveries()).toEqual([
      { from: "0,0", to: "7,0" },
      { from: "5,0", to: "7,0" },
    ]);
    // The anonymous count keeps working and prices nothing.
    t.deliver(3);
    expect(t.delivered()).toBe(5);
    expect(t.collectDeliveries()).toEqual([]);
  });
});

describe("the farebox on a network board", () => {
  it("banks exactly the fares of the passengers it delivers", () => {
    const game = createGame(
      farebox.level,
      defsOf(farebox),
      200,
      networkMode,
      1,
      farebox.colors,
      undefined,
      "farebox"
    );
    game.startObjective();
    // Measured over the LIVE run and stopped the moment it ends: fares book
    // only while the objective is playing (#91), so carrying on past the win
    // would count deliveries no fare was taken for and the exact identity
    // below — the point of the test — would dissolve into an inequality.
    for (let t = 0; t < 200 && game.objective.phase === "playing"; t += 0.2) {
      game.advance(0.2);
    }
    const delivered = game.sim.passengersDelivered();
    expect(delivered).toBeGreaterThan(0);
    // Every journey on this board is the single 7-tile hop between the two
    // stations (no walk links, no depot parking — the shuttle bounces), so
    // the takings are EXACTLY fare × delivered. This is the double-collection
    // guard in one line: one fare per journey, never per leg.
    expect(game.money.enabled).toBe(true);
    expect(game.money.earned).toBe(
      delivered * passengerFare(WEST_STATION, EAST_STATION)
    );
    // ...and the books close: opening capital, plus the takings, less what
    // the fleet cost to keep (#91 — this board buys nothing, so its only
    // outgoing is the authored train's wages). Phase 2 and phase 3 in one
    // line, and the ledger sums to the balance exactly as it claims to.
    expect(game.money.spent).toBe(game.money.wagesPaid);
    expect(game.money.balance).toBe(
      NETWORK_CAPITAL + game.money.earned - game.money.spent
    );
  });
});

describe("the farebox under the citizen layer", () => {
  it("opens on the treasury and banks the edge riders' fares overnight", () => {
    const game = createGame(
      edgedemand.level,
      defsOf(edgedemand),
      200,
      citizensModeWith({ secPerDay: 300, startHour: 1 }),
      1,
      edgedemand.colors,
      undefined,
      "edgedemand"
    );
    // Fares book only while the objective is live (#91), and PlayView starts
    // an overlay-less mode for the player — so a headless run must too.
    game.startObjective();
    expect(game.money.enabled).toBe(true);
    expect(game.money.balance).toBe(CITIZENS_TREASURY);
    // 55s of a 300s day: 01:00 → 05:24, before anyone in town wakes — every
    // delivery is an imported edge rider, and each pays the same 9-tile fare.
    run(game, 55);
    const delivered = game.sim.passengersDelivered();
    expect(delivered).toBeGreaterThan(0);
    expect(game.money.balance).toBe(
      CITIZENS_TREASURY + delivered * passengerFare(EDGE_STATION, PLAIN_STATION)
    );
  });
});
