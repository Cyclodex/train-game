import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { citizensMode, citizensModeWith } from "@/modes/citizens";
import { sandboxMode } from "@/modes/sandbox";
import { threecities } from "@/levels/test/scenarios/threecities";

// The citizen layer meets the actual railway. Like park & ride, this runs in
// `game.advance()` — the headless world step — which is what makes the whole
// loop provable without a browser: real trains, real platforms, real dwells,
// and people whose journeys those dwells begin and end.
//
// If the citizen tick ever moves into the render mirror (the rAF / hidden-tab
// trap), this spec goes silent red.
function defsOf() {
  return Object.values(threecities.trains).map<TrainDef>(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
  }));
}

// A DAY-COMPRESSED mode for the tests below that are about what happens over
// several days — growth, emigration, an equilibrium. The shipped day is 1800
// board seconds (calibrated so a cross-map commute reads as about an hour of
// the in-game clock), and at that length "five days" would be nine thousand
// seconds of simulation. Compressing it is stated out loud here rather than the
// shipped calibration being bent to keep the suite fast.
const fiveDayMode = citizensModeWith({ secPerDay: 300 });

function newGame(mode = citizensMode) {
  return createGame(
    threecities.level,
    defsOf(),
    200,
    mode,
    1,
    threecities.colors,
    undefined,
    "threecities"
  );
}

function run(game: ReturnType<typeof createGame>, seconds: number) {
  for (let t = 0; t < seconds; t += 0.2) game.advance(0.2);
}

describe("three cities: the citizens commute on the real railway", () => {
  it("populates the board's towns, with jobs concentrated in the works town", () => {
    const game = newGame();
    expect(game.citizenStats.enabled).toBe(true);
    expect(game.cities.map(c => c.name).sort()).toEqual([
      "Eastfield",
      "Steinbach",
      "Westfield",
    ]);
    expect(game.citizenStats.population).toBeGreaterThan(50);
    const steinbach = game.cities.find(c => c.name === "Steinbach");
    const westfield = game.cities.find(c => c.name === "Westfield");
    // Steinbach is where the works are; Westfield has only its parade of shops.
    expect(steinbach?.jobs.total).toBeGreaterThan(westfield?.jobs.total ?? 0);
  });

  it("puts commuters on the platform and the trains carry them", () => {
    const game = newGame();
    run(game, 700); // a full day: the morning peak, the journeys, the way home
    const s = game.citizenStats;
    // `modeShare` counts COMPLETED trips, and a transit trip can only complete
    // by being boarded and set down again — which happens solely on a real
    // `DwellEvent` out of `sim.step`. A non-zero train slice is therefore proof
    // that these people rode an actual train, not a parallel bookkeeping.
    expect(s.modeShare.transit).toBeGreaterThan(0);
    expect(s.tripsCompleted).toBeGreaterThan(0);
    // Both trains are shuttling, so nobody is stranded with no way to travel.
    expect(s.tripsRefused).toBe(0);
    expect(s.tripsAbandoned).toBe(0);
  });

  it("a railway that runs makes the towns happy about their commute", () => {
    // Several days of ordinary service. The commute bar is the network's report
    // card, and with both shuttles running it should be comfortably positive.
    const game = newGame();
    run(game, 900);
    expect(Math.max(...game.cities.map(c => c.happiness.commute))).toBeGreaterThan(0.5);
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(20);
    // And a happy, well-connected board grows rather than shrinks.
    expect(game.citizenStats.population).toBeGreaterThan(50);
  });

  it("carries the majority of journeys by rail once the towns are out of walking reach", () => {
    const game = newGame(fiveDayMode);
    run(game, 1500); // five in-game days, at the compressed day length
    const s = game.citizenStats;
    // The headline number of the whole mode: most journeys on this board are
    // made by train, because the jobs are genuinely out of walking reach of the
    // houses. If this drops toward zero, check the walking maximum and the town
    // spacing before anything else — see the design doc's calibration note.
    expect(s.modeShare.transit).toBeGreaterThan(0.4);
    expect(s.tripsAbandoned).toBe(0);
    expect(s.population).toBeGreaterThan(120); // opened around 110 and grew
  });

  it("empties the commuter towns when no train ever runs — and spares the one that walks", () => {
    // The same board and the same people, with no trains on it at all. This is
    // the pair to the test above, and together they are the mode: the ONLY
    // difference between a board that grows and a board that hollows out is
    // whether the railway runs.
    const game = createGame(
      threecities.level,
      [], // no trains
      200,
      fiveDayMode, // same compressed clock as its pair above
      1,
      threecities.colors,
      undefined,
      "threecities"
    );
    const before = Object.fromEntries(game.cities.map(c => [c.name, c.population]));
    run(game, 1500);
    const after = Object.fromEntries(game.cities.map(c => [c.name, c.population]));

    expect(game.citizenStats.tripsAbandoned).toBeGreaterThan(50);
    // Westfield and Eastfield commute to Steinbach and cannot: they hollow out.
    //
    // NOT to nothing, and the floor is the point. Since life stages landed, a
    // quarter of each town is children and retired residents whose whole day is
    // a walk to the café and back — journeys this board makes perfectly well
    // with no train on it at all. They stay, and they are right to: what a dead
    // railway costs a town is its COMMUTERS, not its population. Before stages
    // every non-worker was an idle mood that drifted down with everyone else's,
    // and the town emptied to a rounding error.
    expect(after.Westfield).toBeLessThan(before.Westfield * 0.65);
    expect(after.Eastfield).toBeLessThan(before.Eastfield * 0.65);
    // Steinbach's work is next door to its houses, so it walks and survives.
    expect(after.Steinbach).toBeGreaterThanOrEqual(before.Steinbach * 0.8);
    // And the commute bar says why, before the population does.
    const stranded = game.cities.filter(c => c.name !== "Steinbach");
    const steinbach = game.cities.find(c => c.name === "Steinbach");
    for (const c of stranded) {
      expect(c.happiness.commute).toBeLessThan(steinbach?.happiness.commute ?? 1);
    }
  });

  it("leaves every other mode exactly as it was — no cities, no citizen layer", () => {
    const game = createGame(
      threecities.level,
      defsOf(),
      200,
      sandboxMode,
      1,
      threecities.colors,
      undefined,
      "threecities"
    );
    expect(game.citizenStats.enabled).toBe(false);
    expect(game.cities).toHaveLength(0);
    // ...and the board still runs: Sandbox keeps the synthetic station demand
    // it always had, so the trains still have someone to carry.
    run(game, 60);
    expect(game.citizenStats.population).toBe(0);
  });

  it("reset gives the same town back, not a different one", () => {
    const game = newGame();
    const before = game.citizenStats.population;
    run(game, 300);
    game.reset();
    expect(game.citizenStats.population).toBe(before);
    expect(game.citizenStats.tripsCompleted).toBe(0);
  });
});
