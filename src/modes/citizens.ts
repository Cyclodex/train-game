import { GameMode, ModeContext, ModeSetup } from "@/modes/types";
import { createObjectiveTracker, ObjectiveTracker } from "@/sim/objectives";
import { CitizenTuning } from "@/sim/citizens";
import { deriveWorkplaceParking } from "@/tiles/workplaceParking";
import { deriveWorkplaceBikeRacks } from "@/tiles/workplaceBikeRacks";

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
const TUNING: Partial<CitizenTuning> = {
  secPerDay: 1800,
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
// Since 2026-08-21, `setup()` derives the forecourt LADDER for whatever board
// it is handed: three staff car bays at every works' gate, then a six-stand
// bike rack beside them. The transform reaches /play through PlayView's
// `setup.level` promotion; TestStage and unit tests hand `createGame` the
// scenario's own level, which is why every scenario still applies the passes
// in its OWN data — see KNOWHOW → WORKPLACE PARKING.
export const citizensMode: GameMode = {
  id: "citizens",
  label: "Citizens",
  description:
    "Towns full of people who need to get to work. Build the network they will actually use.",
  setup(ctx: ModeContext): ModeSetup {
    // THE PARKING LADDER, derived for the board the mode is handed: the car
    // pass first (three staff bays claim the gate kerb), the bike pass right
    // after (the rack yields it and lands one tile along). Both passes are
    // idempotent and hand back the SAME object when there is nothing to lay,
    // so a board that already derived its parking in its own data — every
    // /test scenario does — passes through untouched and PlayView's
    // `setup.level !== ctx.level` promotion stays off.
    //
    // Seed: the passes' default (1) matches `gameConfig.colorSeed`'s default,
    // which is what the citizen world falls back to (`citizenSetup.seed ??
    // colorSeed` in game.ts). Today the seed only spreads plot DENSITY —
    // work/shop kinds are seed-independent — so a custom colorSeed cannot
    // misplace a forecourt.
    const level = deriveWorkplaceBikeRacks(deriveWorkplaceParking(ctx.level));
    return {
      levelId: ctx.levelId,
      level,
      trains: ctx.trains,
      // Endless: the objective never completes, so the phase stays Playing and
      // the city cards are the score. Losing people is the failure, and it is
      // visible in the panel rather than in an overlay.
      objective: { deliveriesRequired: Number.POSITIVE_INFINITY },
      citizens: { tuning: TUNING },
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
  hud: {
    deliveries: true,
    timer: false,
    stars: false,
    startOverlay: false,
    endOverlay: false,
    money: false,
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
