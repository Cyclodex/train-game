import {
  GameMode,
  ModeContext,
  ModeSetup,
  Spawner,
  objectiveFromSpec,
} from "@/modes/types";
import { Counters, StarSpec } from "@/sim/objectives";
import { createScheduleSpawner, scheduleFor } from "@/modes/schedule";

// A star time scaled to the board: a generous baseline so small boards stay
// achievable. Tuned per-board later; for now ~8s per train to deliver.
function starTimeFor(trainCount: number): number {
  return Math.max(20, trainCount * 8);
}

function puzzleStars(trainCount: number): StarSpec[] {
  const starTime = starTimeFor(trainCount);
  return [
    {
      id: "speedrun",
      label: `Speedrun (${starTime}s)`,
      hint: "Get every train home inside the time",
      predicate: (c: Counters) => c.elapsedSec <= starTime,
    },
    {
      id: "hands-off",
      label: "Hands off",
      hint: "Win without holding or forcing a single signal",
      predicate: (c: Counters) => c.manualHolds + c.manualGreens === 0,
    },
    {
      id: "perfect-colours",
      label: "Perfect colours",
      hint: "No train ever arrives at the wrong station",
      predicate: (c: Counters) => c.mismatchedArrivals === 0,
    },
  ];
}

// --- the Rush variant (formerly the Time Attack mode, #113) ------------------
//
// A board whose trains carry a spawnAtSec IS the rush: the schedule is board
// data, so Puzzle reads it off the roster instead of asking for its own mode.
// Boards without scheduled trains keep the classic Puzzle objective unchanged.

// The most trains allowed in play at once before the level is lost (overflow).
// A backlog cap: let too many pile up undelivered and the yard gridlocks.
export const MAX_ACTIVE_TRAINS = 4;

function rushStars(starTime: number, calmActive: number): StarSpec[] {
  return [
    {
      id: "speedrun",
      label: `Speedrun (${starTime}s)`,
      hint: "Clear the whole schedule inside the time",
      predicate: (c: Counters) => c.elapsedSec <= starTime,
    },
    {
      // Never let the backlog climb past a calm threshold — rewards keeping the
      // yard flowing rather than merely surviving the overflow cap.
      id: "no-overflow",
      label: `Free flowing (max ${calmActive})`,
      hint: "Never let more than that many trains be running at once",
      predicate: (c: Counters) => (c.peakActive ?? 0) <= calmActive,
    },
    {
      id: "perfect-colours",
      label: "Perfect colours",
      hint: "No train ever arrives at the wrong station",
      predicate: (c: Counters) => c.mismatchedArrivals === 0,
    },
  ];
}

export const puzzleMode: GameMode = {
  id: "puzzle",
  label: "Puzzle / Dispatcher",
  description:
    "Route every train to its matching depot. Flip switches and hold signals " +
    "to bring them all home — fast, hands-off, no bounces.",
  setup(ctx: ModeContext): ModeSetup {
    const trainCount = ctx.trains.length;
    const scheduled = ctx.trains.filter(t => (t.spawnAtSec ?? 0) > 0);
    if (scheduled.length === 0) {
      // The classic puzzle: everyone is on the board from t=0.
      return {
        levelId: ctx.levelId,
        level: ctx.level,
        trains: ctx.trains,
        objective: {
          deliveriesRequired: trainCount,
          stars: puzzleStars(trainCount),
        },
      };
    }
    // Rush: scheduled arrivals plus a backlog cap. Star time gets the last
    // departure added, so late arrivals don't make the speedrun unreachable.
    const initialActive = trainCount - scheduled.length;
    const lastSpawn = ctx.trains.reduce(
      (m, t) => Math.max(m, t.spawnAtSec ?? 0),
      0
    );
    const starTime = starTimeFor(trainCount) + lastSpawn;
    // The cap can never sit BELOW the board's own starting backlog. The tracker
    // seeds `active` from initialActiveTrains and fails on the first observe()
    // when it exceeds the cap — so a board with 5 unscheduled trains plus one
    // scheduled arrival would be lost at t=0, before the player touched
    // anything. Since #113 this ruleset is reached implicitly (any roster with
    // a spawnAtSec), not by choosing a mode, so the board author never opted in.
    const overflowCap = Math.max(MAX_ACTIVE_TRAINS, initialActive + 1);
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: {
        deliveriesRequired: trainCount,
        initialActiveTrains: initialActive,
        fail: { maxActiveTrains: overflowCap },
        // "Free flowing": keep the peak backlog at or below half the cap.
        stars: rushStars(
          starTime,
          Math.max(1, Math.floor(MAX_ACTIVE_TRAINS / 2))
        ),
      },
    };
  },
  controls: {
    switches: true,
    signalHolds: true,
    crossingGate: false,
    build: false,
    dispatch: false,
  },
  createObjective: objectiveFromSpec,
  // Inert on classic boards (an empty schedule spawns nothing); on a board with
  // spawnAtSec trains this is the Rush variant's clock. game.ts holds scheduled
  // trains out of the init seeding regardless of mode, so the pair is exact.
  createSpawner(setup: ModeSetup): Spawner {
    return createScheduleSpawner(scheduleFor(setup.trains));
  },
  hud: {
    deliveries: true,
    timer: true,
    stars: true,
    startOverlay: true,
    endOverlay: true,
    money: false,
  },
  fits(caps) {
    // Zero trains would mean deliveriesRequired 0 — an instantly-won board.
    return caps.trains > 0 ? null : "Needs a train to deliver";
  },
};
