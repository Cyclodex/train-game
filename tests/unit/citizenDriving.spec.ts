import { describe, it, expect } from "vitest";
import { createGame } from "@/game";
import { citizensMode, citizensModeWith } from "@/modes/citizens";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { threecities } from "@/levels/test/scenarios/threecities";

// A driving citizen IS a car on the road — not a person on a stopwatch who
// happens to be labelled "car". The distinction is observable: `driving` counts
// people who are, at this instant, an actual vehicle in the actual traffic
// model, and their journey ends when that vehicle arrives.
// The shipped mode by default. `tuning` is for the two kinds of test the
// calibrated clock does not suit: one that needs to watch the daily RHYTHM
// (which wants a short day and a midnight start), and one that needs several
// DAYS to pass (growth, emigration). A test that compresses the clock says so
// rather than the shipped calibration being bent to keep the suite fast.
function newGame(scenario = citizencars, tuning?: Parameters<typeof citizensModeWith>[0]) {
  return createGame(
    scenario.level,
    [],
    200,
    tuning ? citizensModeWith(tuning) : citizensMode,
    1,
    scenario.colors,
    undefined,
    scenario.id
  );
}

function run(game: ReturnType<typeof createGame>, seconds: number, onTick?: () => void) {
  for (let t = 0; t < seconds; t += 0.2) {
    game.advance(0.2);
    onTick?.();
  }
}

describe("citizens drive real cars", () => {
  it("puts residents on the road as vehicles, not as timers", () => {
    const game = newGame();
    let peak = 0;
    run(game, 1200, () => {
      peak = Math.max(peak, game.citizenStats.driving);
    });
    // People were vehicles in traffic...
    expect(peak).toBeGreaterThan(5);
    // ...and those journeys completed as car trips.
    expect(game.citizenStats.modeShare.car).toBeGreaterThan(0.4);
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(50);
  });

  it("nobody is driving at 3am — the road fills when people leave for work", () => {
    // About the daily RHYTHM, so it sets its own clock: a 300s day starting at
    // midnight, which puts the small hours in the first ~60 seconds. The
    // shipped mode opens at 07:00 precisely so a player never has to wait
    // through the quiet part — which is the part this test is checking.
    const game = newGame(citizencars, { secPerDay: 300, startHour: 0 });
    run(game, 50);
    expect(game.citizenStats.driving).toBe(0);
    let peakMorning = 0;
    run(game, 130, () => {
      peakMorning = Math.max(peakMorning, game.citizenStats.driving);
    });
    expect(peakMorning).toBeGreaterThan(0);
  });

  it("a board with no roads still works — the driving leg falls back to its clock", () => {
    // threecities is deliberately road-free. Nothing may dispatch a car there,
    // and nothing may break: the mode simply has no car trips to make.
    const game = newGame(threecities);
    run(game, 600);
    expect(game.citizenStats.driving).toBe(0);
    expect(game.citizenStats.modeShare.car).toBe(0);
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(0);
  });

  it("a town with only roads strands the people who cannot drive", () => {
    // The second lesson of the citizencars board, and an honest one: with no
    // railway and no bus, every resident without a car is refused their commute
    // outright.
    //
    // What the town does about it is the interesting part, and it is not what
    // you would guess: it does not shrink. It CHURNS. The stranded leave, more
    // arrive (the town reads as happy, because the people still in it all own
    // cars), and those without cars are stranded in turn — a car-only town
    // quietly self-selects for drivers while its population holds steady.
    // So `access` is measured as the DIP, never the end state: at equilibrium
    // the survivors' access reads fine and the refusal count is the only thing
    // still telling the truth.
    // Several DAYS of churn, so the clock is compressed: at the shipped 1800s
    // day, 1200 board seconds is two thirds of one day and the equilibrium this
    // test is about has not happened yet.
    const game = newGame(citizencars, { secPerDay: 300 });
    let worstAccess = 1;
    run(game, 1200, () => {
      const brookfield = game.cities.find(c => c.name === "Brookfield");
      if (brookfield) worstAccess = Math.min(worstAccess, brookfield.happiness.access);
    });
    expect(game.citizenStats.tripsRefused).toBeGreaterThan(50);
    expect(worstAccess).toBeLessThan(0.7);
  });
});
