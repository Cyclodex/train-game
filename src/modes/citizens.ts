import { GameMode, ModeContext, ModeSetup } from "@/modes/types";
import { createObjectiveTracker, ObjectiveTracker } from "@/sim/objectives";
import { CitizenTuning } from "@/sim/citizens";

// The mode's dials, calibrated against what a train on THIS engine actually
// does. A train cruises at `DEFAULT_SPEED` = 0.5 tiles/sec, so a shuttle on a
// twenty-tile line comes round about every fifty seconds — and a person's
// patience and a person's expectations both have to be set against that, or
// every commuter gives up on a perfectly ordinary railway.
//
//  · `secPerDay` is THE genre dial: short makes a twitchy throughput game, long
//    a planning one. Four minutes leaves room for a real journey inside a day.
//  · `maxWaitSec` must exceed the headway your board can offer, or waiting is a
//    coin flip. A hundred seconds tolerates two missed trains.
//  · `refSpeed` sets what people think a trip "should" take door to door — the
//    yardstick every mood is judged against. Around a third of cruise speed is
//    "a decent journey including getting to the platform and waiting".
// Worked against `threecities`, which is the reference board: a twenty-six tile
// line, so a shuttle comes back round to any given platform about every two
// minutes, and a cross-map commute is around a hundred seconds door to door.
const TUNING: Partial<CitizenTuning> = {
  secPerDay: 300,
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
// What this mode does NOT do (deliberately, phase A): spawn a real car for
// every driving citizen. Driving is a timer here; the road sim still runs its
// own ambient traffic. Wiring the two together needs an origin/destination
// spawn API on `road.ts` — design doc §9 phase B.
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
