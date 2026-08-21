import { GameMode } from "@/modes/types";
import { puzzleMode } from "@/modes/puzzle";

// Time Attack / Rush is a PUZZLE VARIANT, not a picker mode (#113): the
// schedule is board data (`spawnAtSec` on the trains), and puzzleMode reads it
// off the roster — scheduled boards get the spawner, the backlog cap and the
// rush stars from Puzzle itself. This wrapper keeps the variant's NAME for the
// /test scenario card and for anything that wants to speak about the ruleset,
// while sharing every byte of Puzzle's behaviour.
//
// The schedule helpers live in modes/schedule.ts; re-exported here so existing
// imports keep working.
export { scheduleFor, createScheduleSpawner } from "@/modes/schedule";
export type { SpawnEvent } from "@/modes/schedule";

export const timeAttackMode: GameMode = {
  ...puzzleMode,
  id: "time-attack",
  label: "Time Attack / Rush",
  description:
    "Trains arrive on a fixed schedule — clear them all to their depots " +
    "before the backlog piles up and the yard gridlocks.",
};
