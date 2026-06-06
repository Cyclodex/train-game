import { GameMode } from "@/modes/types";
import { puzzleMode } from "@/modes/puzzle";
import { crossingKeeperMode } from "@/modes/crossing-keeper";
import { timeAttackMode } from "@/modes/time-attack";
import { sandboxMode } from "@/modes/sandbox";
import { dailyMode } from "@/modes/daily";

// The mode menu. Add a mode by dropping a file in `modes/` and appending it
// here (mirrors the /test SCENARIOS registry). Order is the picker order.
export const MODES: GameMode[] = [
  dailyMode,
  puzzleMode,
  crossingKeeperMode,
  timeAttackMode,
  sandboxMode,
];

export const DEFAULT_MODE_ID = puzzleMode.id;

export function modeById(id: string | undefined | null): GameMode {
  return MODES.find(m => m.id === id) ?? MODES[0];
}

export type { GameMode } from "@/modes/types";
