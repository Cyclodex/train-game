import { Spawner, TrainDef } from "@/modes/types";

// One scheduled departure: at sim-time `atSec`, the train `def` is injected and
// leaves its depot. The whole schedule is predefined data (not random), so a run
// is identical every play and scores are replayable/comparable. Colours are
// assigned up front for the full roster (game.ts), so a spawned train is already
// correctly coloured — there is no on-the-fly colour problem.
export interface SpawnEvent {
  atSec: number;
  def: TrainDef;
}

// Derive the predefined schedule from a board's trains: every train carrying a
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
