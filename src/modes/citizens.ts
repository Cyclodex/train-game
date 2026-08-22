import { GameMode, ModeContext, ModeSetup } from "@/modes/types";
import { createObjectiveTracker, ObjectiveTracker } from "@/sim/objectives";
import { CitizenTuning } from "@/sim/citizens";

// The mode's dials, calibrated against what a train on THIS engine actually
// does. A train cruises at `DEFAULT_SPEED` = 0.5 tiles/sec, so a shuttle on a
// twenty-tile line comes round about every fifty seconds — and a person's
// patience and a person's expectations both have to be set against that, or
// every commuter gives up on a perfectly ordinary railway.
//
//  · `secPerDay` is THE genre dial, and it is now MEASURED rather than picked.
//    See the table below.
//  · `maxWaitSec` must exceed the headway your board can offer, or waiting is a
//    coin flip. A hundred seconds tolerates two missed trains.
//  · `refSpeed` sets what people think a trip "should" take door to door — the
//    yardstick every mood is judged against. Around a third of cruise speed is
//    "a decent journey including getting to the platform and waiting".
// Worked against `threecities`, which is the reference board: a twenty-six tile
// line, so a shuttle comes back round to any given platform about every two
// minutes, and a cross-map commute is around a hundred seconds door to door.
//
// THE DAY LENGTH, CALIBRATED. Measured over 2000 board seconds on the two
// reference boards, median door-to-door, then read against what each journey is
// obviously meant to BE in a real town:
//
//   | journey                  | measured | means, in a real town |
//   |--------------------------|---------:|-----------------------|
//   | walk to a local job      |     18 s | ~12 min               |
//   | drive across the suburb  |     13 s | ~10 min               |
//   | rail commute, city to city |  105 s | ~60-90 min            |
//
// That fixes the exchange rate at roughly 30 real-world seconds per board
// second, so a 24-hour day is about 1800 board seconds. At the old 300 the same
// commute read as EIGHT AND A HALF IN-GAME HOURS: people left home at 07:00 and
// arrived at work after dark, which is what the three-hour departure window in
// `considerTrips` was quietly papering over.
//
// At 1800 the clock finally agrees with the board: the local walk is 14 in-game
// minutes, the drive 10, and the cross-map commute an hour and a half — a long
// intercity haul, which is exactly what it looks like. The cost is that a full
// in-game day is half an hour of real time at 1x, which is why the mode has
// 2x/4x; a city builder is not meant to be watched a day at a sitting.
export const CITIZEN_DAY_SEC = 1800;

// The town's opening treasury. Sized against the build price, not the fares:
// one intercity line on a reference-scale board is ~26 tiles at $1,000/tile
// plus terrain surcharges, so $40,000 buys the line that changes the board and
// a spur beside it — and nothing more. The fares are the refill: at $2 + $3 a
// tile, a hundred ten-tile commutes a day earn ~$3,200/day, so the next line
// is earned in days, not minutes.
export const CITIZENS_TREASURY = 40000;

const TUNING: Partial<CitizenTuning> = {
  secPerDay: CITIZEN_DAY_SEC,
  maxWaitSec: 180,
  assumedHeadwaySec: 50,
  refSpeed: 0.1,
  // Four tiles is the furthest anyone walks end to end. This is the single
  // most sensitive number in the mode and it is worth saying why: at the
  // engine's default of six, the nearest factory to the nearest house on the
  // reference board was EXACTLY six tiles away, so almost everyone walked past
  // the station to work and the railway carried 1% of journeys. A walking
  // maximum is a statement about how far a town is; get it wrong and the whole
  // mode quietly stops being about transport.
  walkMaxTiles: 4,
};

// Citizens — the Transport-Fever mode.
//
// Several towns, people who live in one and work in another, and one question
// the whole thing turns on: can they get there? They walk if it is close, drive
// if a road actually reaches, and take the train when it is the least bad
// option — which, between two towns with no road between them, it is. They time
// the journey, judge it, and move house if you keep failing them.
//
// The player's job is the network. There is no delivery quota and no clock: the
// score is a living population, and the fail state is a shrinking one.
//
// Design: docs/superpowers/specs/2026-08-01-citizens-and-cities-design.md
//
// A driving citizen IS a real car (`roadSim.requestTrip`, 2026-08-02), and since
// 2026-08-04 that car PARKS at the far end and holds a real bay for the working
// day — so a full staff car park costs its owner a walk, and the player a mood.
// See docs/superpowers/specs/2026-08-04-workplace-parking-design.md.
//
// What this mode does NOT do yet: derive staff parking for whatever board it is
// handed. The pass (`tiles/workplaceParking.ts`) is applied in a board's OWN
// data, because `createGame` takes the level it is given rather than the one
// `setup()` returns — see KNOWHOW → WORKPLACE PARKING.
export const citizensMode: GameMode = {
  id: "citizens",
  label: "Citizens",
  description:
    "Towns full of people who need to get to work. Build the network they will actually use.",
  setup(ctx: ModeContext): ModeSetup {
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      // Endless: the objective never completes, so the phase stays Playing and
      // the city cards are the score. Losing people is the failure, and it is
      // visible in the panel rather than in an overlay.
      objective: { deliveriesRequired: Number.POSITIVE_INFINITY },
      citizens: { tuning: TUNING },
      // THE FAREBOX (economy convergence phase 2): the commuting IS the
      // income — every citizen (and edge rider) a service delivers pays a
      // fare. And because an economy prices the BUILD verb (this mode's whole
      // answer to every problem), the town starts with a treasury rather than
      // an empty purse: enough for one solid intercity line on a
      // reference-scale board (~26 tiles at $1,000 plus terrain surcharges),
      // not enough to pave the map — from there the network has to earn its
      // own extensions, which is the converged game's loop. No bankruptcy:
      // an unaffordable build is refused up front, and the failure of this
      // mode stays what it always was, a shrinking town.
      economy: { startingBalance: CITIZENS_TREASURY },
      // NO FLEET WAGES HERE, deliberately (#91). This mode shows no service
      // panel (`hud.passengers` is off), so there is no verb for buying a
      // train and none for withdrawing one — and a recurring charge on a
      // fleet the player cannot change is exactly the constant nobody can act
      // on that the Tycoon doc rejects for the track levy. The build tool is
      // this mode's money sink and the fares are its income; that pair is a
      // decision, and a wage bill on top would only be weather.
      //
      // THE TRIGGER for revisiting: the day Citizens gains a roster (buy a
      // train, put it on a line, withdraw it), wages become a decision here
      // too — `upkeep: { periodSec: CITIZEN_DAY_SEC }` is the one line it
      // needs, billed on the day clock its people already live on.
    };
  },
  controls: {
    switches: true,
    signalHolds: true,
    crossingGate: false,
    // Build is the verb of this mode: the network is the answer to every
    // problem the citizens report.
    build: true,
    dispatch: false,
  },
  createObjective(setup): ObjectiveTracker {
    return createObjectiveTracker(setup.objective);
  },
  fits(caps) {
    // The mode IS the population: without homes there is nobody, and without
    // a workplace nobody has anywhere to go — the board would just sit there.
    return caps.homes > 0 && caps.workplaces > 0
      ? null
      : "Needs towns with homes and workplaces";
  },
  hud: {
    deliveries: true,
    timer: false,
    stars: false,
    startOverlay: false,
    endOverlay: false,
    // The treasury and the takings: what building costs and what the
    // commuters pay back. One line, per the HUD-density rule.
    money: true,
  },
};

/**
 * The same mode with the dials nudged — for TESTS, and only for tests.
 *
 * A calibrated day is 1800 board seconds, which is right for playing and
 * hopeless for asserting anything that takes DAYS: growth, emigration, the
 * mood review. A test that wants to watch five days would have to run nine
 * thousand seconds of simulation.
 *
 * So a test says out loud that it is compressing the clock, instead of the
 * shipped calibration being quietly bent to keep the suite fast. Everything
 * else — speeds, patience, the walking maximum — stays exactly as it ships.
 */
export function citizensModeWith(overrides: Partial<CitizenTuning>): GameMode {
  return {
    ...citizensMode,
    setup(ctx: ModeContext): ModeSetup {
      const base = citizensMode.setup(ctx);
      return { ...base, citizens: { tuning: { ...TUNING, ...overrides } } };
    },
  };
}
