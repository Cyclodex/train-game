import { GameMode, ModeContext, ModeSetup, objectiveFromSpec } from "@/modes/types";
import { Counters, StarSpec } from "@/sim/objectives";
import { generateLevel } from "@/tiles/generate";
import { assignColors } from "@/utils/colorAssignment";
import { makeRng } from "@/utils/globalHelpers";
import { trainsFromRoutes } from "@/levelStore";
import { TrainDef } from "@/game";

// Board size for the daily generated level. Fixed so every player gets the same
// board size regardless of device; seeds drive all variety.
const DAILY_WIDTH = 7;
const DAILY_HEIGHT = 6;
const DAILY_DEPOT_PAIRS = 3; // 3 pairs → 3 trains, a comfortable routing puzzle

// Convert a calendar date string (YYYY-MM-DD) to a stable integer seed. Uses a
// simple, deterministic hash over the digits so same date always → same seed.
// Different dates produce different seeds (the year-month-day combo fans out widely).
export function dateToSeed(date: string): number {
  // Strip non-digits so "2026-06-15" → "20260615".
  const digits = date.replace(/\D/g, "");
  // FNV-1a (32-bit) over the digit characters: deterministic, well-distributed.
  let h = 0x811c9dc5;
  for (let i = 0; i < digits.length; i++) {
    h ^= digits.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
    h = h >>> 0; // keep it unsigned 32-bit
  }
  // Ensure the result is a positive integer (makeRng uses `seed >>> 0` but we
  // keep this explicit for clarity in tests).
  return h >>> 0;
}

// Return today's date as "YYYY-MM-DD" in the local time zone. Injected as a
// parameter so tests can pass a fixed date without mocking Date.
export function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The level-id used for per-date best-score persistence.
export function dailyLevelId(date: string): string {
  return `daily:${date}`;
}

// Reuse Puzzle's stars verbatim: Speedrun / Hands-off / Perfect-colours. Daily
// is Puzzle on a date-seeded generated board — the same three challenges apply.
function dailyStars(trainCount: number): StarSpec[] {
  const starTime = Math.max(20, trainCount * 8);
  return [
    {
      id: "speedrun",
      label: "Speedrun",
      predicate: (c: Counters) => c.elapsedSec <= starTime,
    },
    {
      id: "hands-off",
      label: "Hands off",
      predicate: (c: Counters) => c.manualHolds + c.manualGreens === 0,
    },
    {
      id: "perfect-colours",
      label: "Perfect colours",
      predicate: (c: Counters) => c.mismatchedArrivals === 0,
    },
  ];
}

// Build TrainDef[] from a TrainsDefinition (mirrors PlayView's buildTrainDefs).
// Kept local so the mode is self-contained and doesn't import from a view.
function toTrainDefs(trains: ReturnType<typeof trainsFromRoutes>): TrainDef[] {
  return Object.values(trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type as "people" | "fraight",
    wagonIds: (t.wagons ?? []).map(w => w.id),
  }));
}

// Daily / Score Challenge: a date maps to a stable seed → same board for every
// player on the same day. Wraps Puzzle's objective (deliver all + 3 stars) on a
// freshly generated board. `setup()` ignores the context's board entirely and
// derives its own from the date seed.
export const dailyMode: GameMode = {
  id: "daily",
  label: "Daily Challenge",
  description:
    "Today's puzzle — the same board for every player. Route all trains home, " +
    "earn stars for speed, restraint, and perfect colour-matching.",

  setup(_ctx: ModeContext): ModeSetup {
    const date = todayString();
    const seed = dateToSeed(date);
    const levelId = dailyLevelId(date);

    const generated = generateLevel(seed, {
      width: DAILY_WIDTH,
      height: DAILY_HEIGHT,
      depotPairs: DAILY_DEPOT_PAIRS,
    });

    const trainsDef = trainsFromRoutes(generated.routes);
    const trainDefs = toTrainDefs(trainsDef);

    // Assign colours deterministically from the same seed so every player gets
    // identical depot/train colours. A second makeRng call with the same seed
    // produces the same stream as the first — colours are reproducible.
    const colors = assignColors(generated.level, trainDefs, makeRng(seed));

    return {
      levelId,
      level: generated.level,
      trains: trainDefs,
      colors,
      objective: {
        deliveriesRequired: trainDefs.length,
        stars: dailyStars(trainDefs.length),
      },
    };
  },

  controls: {
    switches: true,
    signalHolds: true,
    crossingGate: false,
    build: false,
  },

  createObjective: objectiveFromSpec,

  hud: {
    deliveries: true,
    timer: true,
    stars: true,
    startOverlay: true,
    endOverlay: true,
  },
};

