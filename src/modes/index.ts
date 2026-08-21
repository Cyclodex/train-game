import { GameMode } from "@/modes/types";
import { puzzleMode } from "@/modes/puzzle";
import { sandboxMode } from "@/modes/sandbox";
import { tycoonMode } from "@/modes/tycoon";
import { citizensMode } from "@/modes/citizens";
import { networkMode } from "@/modes/network";

// The mode menu — the five pillars (#113). Add a mode by dropping a file in
// `modes/` and appending it here (mirrors the /test SCENARIOS registry). Order
// is the picker order.
//
// Deliberately NOT in the picker:
//  · Daily — a BOARD SOURCE, not a ruleset: `?board=daily` runs today's
//    generated board under the daily ruleset (modes/daily.ts, unregistered);
//    the picker offers it as the "Today's challenge" chip.
//  · Time Attack — a PUZZLE VARIANT: any board whose trains carry a
//    `spawnAtSec` gets the spawner, backlog cap and rush stars from Puzzle
//    itself (modes/time-attack.ts keeps the variant's name for scenarios).
//  · Crossing Keeper — retired from the picker (#112 deprioritised): its
//    manual gate was never built, and its crossing counters live on in
//    sim/objectives.ts for a future scoring overlay.
export const MODES: GameMode[] = [
  puzzleMode,
  tycoonMode,
  networkMode,
  citizensMode,
  sandboxMode,
];

export const DEFAULT_MODE_ID = puzzleMode.id;

export function modeById(id: string | undefined | null): GameMode {
  // Fall back to the designated default mode (not merely the first picker entry),
  // so picker order can change without altering what plain `/play` loads.
  return (
    MODES.find(m => m.id === id) ??
    MODES.find(m => m.id === DEFAULT_MODE_ID) ??
    MODES[0]
  );
}

export type { GameMode } from "@/modes/types";
