import { describe, it, expect } from "vitest";
import { createGame } from "@/game";
import {
  networkMode,
  NETWORK_CAPITAL,
  WAGE_PERIOD_SEC,
  NETWORK_WAGES,
} from "@/modes/network";
import { VEHICLE_PRICE, wagesFor, periodsDue } from "@/sim/economy";
import {
  vehiclecosts,
  WEST_STATION,
  EAST_STATION,
} from "@/levels/test/scenarios/vehiclecosts";
import { itSlow } from "./support/tier";

// ROLLING STOCK COSTS MONEY (#91, economy convergence phase 3): buying one is
// priced, keeping one is billed per period, and an idle vehicle is therefore a
// mistake rather than a free reflex. The counterpart of phase 2's farebox —
// together they are the trade-off the network mode never had.

function game() {
  const g = createGame(
    vehiclecosts.level,
    [], // an empty shed: the fleet is the decision
    200,
    networkMode,
    1,
    undefined,
    undefined,
    "vehiclecosts"
  );
  g.startObjective();
  return g;
}
function lineStops(g: ReturnType<typeof createGame>): string[] {
  const id = g.createLine([WEST_STATION, EAST_STATION]);
  return g.lines.find(l => l.id === id)?.stops ?? [];
}
const run = (g: ReturnType<typeof createGame>, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.2) g.advance(0.2);
};

describe("what a vehicle costs to buy", () => {
  it("opens on capital for exactly one train and change for a bus", () => {
    const g = game();
    expect(g.money.enabled).toBe(true);
    expect(g.money.balance).toBe(NETWORK_CAPITAL);
    expect(g.vehiclePrice("train")).toBe(VEHICLE_PRICE.train);
    expect(g.canBuyVehicle("train")).toBe(true);
  });

  it("charges for a train, and then refuses the second — the decision", () => {
    const g = game();
    expect(g.buyTrain(lineStops(g))).not.toBeNull();
    // The HUD's balance moves on the PURCHASE, not on the next tick: a mirror
    // that only refreshes inside advance() left the figure stale on a paused
    // board, which is precisely when somebody is deciding what to buy.
    expect(g.money.balance).toBe(NETWORK_CAPITAL - VEHICLE_PRICE.train);
    // The purse now holds less than a train: the order is REFUSED outright,
    // and nothing half-bought is left behind.
    expect(g.canBuyVehicle("train")).toBe(false);
    const before = g.money.balance;
    expect(g.buyTrain([])).toBeNull();
    expect(g.money.balance).toBe(before);
    expect(Object.keys(g.sim.trains)).toHaveLength(1);
  });

  it("an empty wallet REFUSES where a busy shed only delays", () => {
    const g = game();
    const stops = lineStops(g);
    expect(g.buyTrain(stops)).not.toBeNull();
    // The shed is now occupied by the train that just rolled out, and a second
    // order would QUEUE there rather than fail — but this board cannot afford
    // one, so what the player meets first is the price. The two refusals are
    // different answers and must not be confused (#91): a full shed still
    // takes the money and delays the departure.
    expect(g.money.spent).toBe(VEHICLE_PRICE.train);
    expect(g.buyTrain(stops)).toBeNull();
    // Refused before anything was created: no queued order, no ghost roster
    // entry, and not a penny more spent.
    expect(g.money.spent).toBe(VEHICLE_PRICE.train);
    expect(g.queuedTrains).toHaveLength(0);
  });

  it("charges for a bus too, at the cheaper price", () => {
    const g = game();
    const before = g.money.balance;
    const bus = g.buyBus();
    expect(bus).not.toBeNull();
    expect(g.money.balance).toBe(before - VEHICLE_PRICE.bus);
  });
});

describe("what a fleet costs to keep", () => {
  it("bills the fleet once a period, at the size it is then", () => {
    const g = game();
    g.buyTrain(lineStops(g));
    // The HUD says what the CURRENT fleet will cost next period.
    expect(g.money.wagesPerPeriod).toBe(NETWORK_WAGES.train);
    expect(g.money.wagesPaid).toBe(0);

    run(g, WAGE_PERIOD_SEC + 1);
    expect(periodsDue({ periodSec: WAGE_PERIOD_SEC }, WAGE_PERIOD_SEC + 1)).toBe(1);
    expect(g.money.wagesPaid).toBe(NETWORK_WAGES.train);
    // Only the WAGES total is pinned here. The first fare lands somewhere
    // around the first minute (the train has to reach a platform, load, and
    // then reach somebody's destination), so asserting income this early
    // would be pinning the timetable, not the bill. The farebox has its own
    // spec for that.
  });

  it("stops billing for a vehicle the moment it is withdrawn", () => {
    const g = game();
    const bus = g.buyBus();
    expect(g.money.wagesPerPeriod).toBe(NETWORK_WAGES.bus);
    g.removeBus(bus as string);
    // An empty fleet bills nothing, and the saving shows BEFORE the period
    // turns — which is what makes withdrawing one a decision rather than an
    // act of faith.
    expect(g.money.wagesPerPeriod).toBe(0);
    run(g, WAGE_PERIOD_SEC + 1);
    expect(g.money.wagesPaid).toBe(0);
  });

  it("prices a mixed fleet from the mode's own rates", () => {
    const spec = { periodSec: WAGE_PERIOD_SEC, perVehicle: NETWORK_WAGES };
    expect(wagesFor(spec, { train: 2, bus: 1 })).toBe(
      2 * (NETWORK_WAGES.train ?? 0) + (NETWORK_WAGES.bus ?? 0)
    );
    expect(wagesFor(spec, {})).toBe(0);
  });

  it("neither fares nor wages accrue once the run is over", () => {
    const g = game();
    g.buyTrain(lineStops(g));
    run(g, 500); // past the win at ~382s
    expect(g.objective.phase).not.toBe("playing");
    const earned = g.money.earned;
    const wages = g.money.wagesPaid;
    run(g, 200);
    // A won board left running used to go on EARNING while its wages, which
    // are gated on the live run, did not — free money, booked at a clock that
    // had already stopped.
    expect(g.money.earned).toBe(earned);
    expect(g.money.wagesPaid).toBe(wages);
  });
});

describe("the trade-off, measured", () => {
  // MEASURED on this board, one train, 2026-08-22 (the figures the rates in
  // modes/network.ts were set against):
  //   won at 382s · carried 48 · earned $2,688 · wages $720 over 6 periods
  //   opening $9,600 − $8,000 for the train + fares − wages = $3,568 closing
  // So a busy train clears its keep about 3.7x over, and does NOT pay back its
  // purchase in a single run — the fleet is a capital decision, which is the
  // whole point. If either half of that inverts, the rates have moved.
  itSlow("a busy train clears its own wages several times over", () => {
    const g = game();
    g.buyTrain(lineStops(g));
    run(g, 500);
    const { earned, wagesPaid } = g.money;
    expect(wagesPaid).toBeGreaterThan(0);
    expect(earned).toBeGreaterThan(wagesPaid * 2);
    // ...and a real slice of the purchase price is back in the purse.
    expect(earned).toBeGreaterThan(VEHICLE_PRICE.train / 4);
    // The board is winnable on ONE train at these rates: if a single train can
    // no longer clear the target, the demand dial and the wages are fighting.
    expect(g.objective.phase).toBe("won");
  });
});
