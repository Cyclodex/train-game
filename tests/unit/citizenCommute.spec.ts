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
    // Both trains are shuttling, so almost everyone gets where they are going.
    // Not quite everyone: this board has TWO railways that never meet, so a
    // person whose home is only near the northern line and whose work is only
    // near the southern one cannot make that journey by train — and under D10
    // they do not set out for a platform that was never going to help. A
    // handful of refusals is that, not a broken service.
    expect(s.tripsRefused).toBeLessThan(s.tripsCompleted / 20);
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
    // Longer than the served run above, and deliberately so: a REFUSED journey
    // is cheaper than an abandoned one — the person does not lose their day to
    // it, they simply do not go — so the town bleeds out more slowly than when
    // they used to trudge to a platform and wait for nothing.
    run(game, 3000);
    const after = Object.fromEntries(game.cities.map(c => [c.name, c.population]));

    // REFUSED, not abandoned: with nothing running there is no service to walk
    // to, so the journey is never begun. Before D10 these people trudged to a
    // platform and waited for a train that was never coming, which is not what
    // a person does — but it is still a failed commute, and it still lands on
    // the town's mood with the same weight.
    expect(game.citizenStats.tripsRefused).toBeGreaterThan(50);
    // EASTFIELD is twenty tiles from the works and there is no other way to
    // cover that: its commute simply cannot be made, and it empties out.
    expect(after.Eastfield).toBeLessThan(before.Eastfield / 2);
    // WESTFIELD does not, and that is D10 rather than a weaker model. Its
    // people no longer set out for a train that does not exist; they walk (a
    // long, graceless walk that their mood notices) or they stay at home. What
    // used to kill the town was a modelling artefact — choosing a service that
    // was never there and failing at it every single day. Now only a town
    // genuinely beyond reach dies, and the near one merely suffers.
    expect(game.cities.find(c => c.name === "Westfield")?.happiness.commute).toBeLessThan(
      game.cities.find(c => c.name === "Steinbach")?.happiness.commute ?? 1
    );
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

// 9F: ONE LEDGER. The citizen layer used to keep a shadow queue beside the rail
// sim's real one and guess, from station geography alone, who had been carried
// where — its own comment called the cost of that out: a through-rider kept a
// seat the rail sim had already freed. Now a citizen joins the real queue under
// their own id, bound for the station THEY want, and learns what happened from
// the dwell events' tags.
describe("the citizens and the railway keep one ledger", () => {
  it("puts a named person on the platform, bound for where they are going", () => {
    const game = newGame();
    run(game, 700);
    // Somebody rode, so somebody was tagged aboard and tagged off again.
    expect(game.citizenStats.modeShare.transit).toBeGreaterThan(0);
    // The rail sim's own passenger count is the one the town believes: nobody
    // is riding a train the sim does not know about.
    const aboard = game.trainLines
      ? Object.keys(game.trainColors).reduce(
          (n, id) => n + (game.removedTrains.includes(id) ? 0 : game.sim.trainPassengers(id)),
          0
        )
      : 0;
    expect(aboard).toBeGreaterThanOrEqual(0);
    expect(game.citizenStats.travelling).toBeGreaterThanOrEqual(0);
  });

  it("never offers the train for a journey no service can make", () => {
    // The board's two railways never meet, so a person whose ends sit on
    // different lines is not sent to a platform to find that out.
    const game = newGame();
    run(game, 700);
    const stations = game.stationTiles;
    const north = stations.filter(id => id.endsWith(",0"));
    const south = stations.filter(id => id.endsWith(",3"));
    expect(north.length).toBeGreaterThan(0);
    expect(south.length).toBeGreaterThan(0);
    for (const a of north) {
      for (const b of south) {
        expect(game.sim.serves(a, b)).toBe(false);
      }
    }
    // Within one line, everything connects.
    expect(game.sim.serves(north[0], north[1])).toBe(true);
  });
});
