import { GameMode, ModeContext, ModeSetup, objectiveFromSpec } from "@/modes/types";
import { Counters, StarSpec } from "@/sim/objectives";

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

export const puzzleMode: GameMode = {
  id: "puzzle",
  label: "Puzzle / Dispatcher",
  description:
    "Route every train to its matching depot. Flip switches and hold signals " +
    "to bring them all home — fast, hands-off, no bounces.",
  setup(ctx: ModeContext): ModeSetup {
    const trainCount = ctx.trains.length;
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: {
        deliveriesRequired: trainCount,
        stars: puzzleStars(trainCount),
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
