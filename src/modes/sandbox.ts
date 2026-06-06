import { GameMode, ModeContext, ModeSetup } from "@/modes/types";
import { createObjectiveTracker, ObjectiveTracker } from "@/sim/objectives";

// Sandbox / Creative: free play. The objective never completes (an impossibly
// high requirement) so the phase stays Playing and there is no win/lose — the
// player just runs the board. Build is enabled for a future editor-as-mode.
export const sandboxMode: GameMode = {
  id: "sandbox",
  label: "Sandbox",
  description: "Free play. No goal, no clock — just run the railway.",
  setup(ctx: ModeContext): ModeSetup {
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: { deliveriesRequired: Number.POSITIVE_INFINITY },
    };
  },
  controls: {
    switches: true,
    signalHolds: true,
    crossingGate: false,
    build: true,
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
  },
};
