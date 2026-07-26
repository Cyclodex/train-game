import {
  GameMode,
  ModeContext,
  ModeSetup,
  Spawner,
  TrainDef,
  objectiveFromSpec,
} from "@/modes/types";
import { Counters, StarSpec } from "@/sim/objectives";

// One scheduled departure: at sim-time `atSec`, the train `def` is injected and
// leaves its depot. The whole schedule is predefined data (not random), so a run
// is identical every play and scores are replayable/comparable. Colours are
// assigned up front for the full roster (game.ts), so a spawned train is already
// correctly coloured — there is no on-the-fly colour problem.
export interface SpawnEvent {
  atSec: number;
  def: TrainDef;
}

// Derive the predefined schedule from the mode's trains: every train carrying a
// spawnAtSec (>0) is a scheduled arrival, sorted by time for a deterministic
// cursor. Trains without a spawnAtSec are the init trains (present at t=0); they
// are not in the schedule (game.ts seeds them into the sim directly).
export function scheduleFor(trains: TrainDef[]): SpawnEvent[] {
  return trains
    .filter(t => (t.spawnAtSec ?? 0) > 0)
    .map(t => ({ atSec: t.spawnAtSec as number, def: t }))
    .sort((a, b) => a.atSec - b.atSec || a.def.id.localeCompare(b.def.id));
}

// A deterministic cursor over a predefined schedule. Accumulates sim time and,
// on each step, returns the trains whose atSec has been reached this tick. No
// randomness: identical schedule + identical dt sequence → identical run.
export function createScheduleSpawner(schedule: SpawnEvent[]): Spawner {
  const sorted = [...schedule].sort(
    (a, b) => a.atSec - b.atSec || a.def.id.localeCompare(b.def.id)
  );
  let elapsed = 0;
  let next = 0; // index of the next not-yet-spawned event
  return {
    step(dt: number): TrainDef[] {
      elapsed += dt;
      const due: TrainDef[] = [];
      while (next < sorted.length && sorted[next].atSec <= elapsed) {
        due.push(sorted[next].def);
        next += 1;
      }
      return due;
    },
    reset() {
      elapsed = 0;
      next = 0;
    },
  };
}

// The most trains allowed in play at once before the level is lost (overflow).
// A backlog cap: let too many pile up undelivered and the yard gridlocks. Small
// boards keep this tight; for now a flat, testable cap.
const MAX_ACTIVE_TRAINS = 4;

function timeAttackStars(starTime: number, calmActive: number): StarSpec[] {
  return [
    {
      id: "speedrun",
      label: "Speedrun",
      predicate: (c: Counters) => c.elapsedSec <= starTime,
    },
    {
      // Never let the backlog climb past a calm threshold — rewards keeping the
      // yard flowing rather than merely surviving the overflow cap.
      id: "no-overflow",
      label: "Free flowing",
      predicate: (c: Counters) => (c.peakActive ?? 0) <= calmActive,
    },
    {
      id: "perfect-colours",
      label: "Perfect colours",
      predicate: (c: Counters) => c.mismatchedArrivals === 0,
    },
  ];
}

// Time Attack / Rush: trains arrive on a predefined, deterministic schedule and
// the player must clear them all before the backlog overflows. Dispatch only
// (switches + signal holds); no building, no crossing gate. The schedule is data
// (no random spawning — that is reserved for a future Endless mode), so every
// run is identical and scores are replayable/comparable across players.
export const timeAttackMode: GameMode = {
  id: "time-attack",
  label: "Time Attack / Rush",
  description:
    "Trains arrive on a fixed schedule — clear them all to their depots " +
    "before the backlog piles up and the yard gridlocks.",
  setup(ctx: ModeContext): ModeSetup {
    const trainCount = ctx.trains.length;
    const initialActive = ctx.trains.filter(t => !(t.spawnAtSec ?? 0)).length;
    // Star time scaled to the roster: ~8s per train plus the last departure, so
    // late arrivals don't make the speedrun star unreachable.
    const lastSpawn = ctx.trains.reduce(
      (m, t) => Math.max(m, t.spawnAtSec ?? 0),
      0
    );
    const starTime = Math.max(20, trainCount * 8) + lastSpawn;
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: {
        deliveriesRequired: trainCount,
        initialActiveTrains: initialActive,
        fail: { maxActiveTrains: MAX_ACTIVE_TRAINS },
        // "Free flowing": keep the peak backlog at or below half the cap.
        stars: timeAttackStars(starTime, Math.max(1, Math.floor(MAX_ACTIVE_TRAINS / 2))),
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
};
