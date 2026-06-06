import { Level } from "@/tiles/model";
import { TrainDef } from "@/game";
import { ColorAssignment } from "@/utils/colorAssignment";
import {
  ObjectiveSpec,
  ObjectiveTracker,
  Observation,
  createObjectiveTracker,
} from "@/sim/objectives";

// Which existing player controls a mode enables. The sim already implements all
// of these; a mode only gates whether the view exposes them.
export interface ModeControls {
  switches: boolean; // flip junction switches
  signalHolds: boolean; // hold/release + force-green signals
  crossingGate: boolean; // manual level-crossing gate (Crossing Keeper, later)
  build: boolean; // edit the board (Sandbox)
}

// Which readouts/overlays the HUD shows for this mode. A pure view hint.
export interface HudDescriptor {
  deliveries: boolean; // "N/M delivered" card
  timer: boolean; // elapsed (or remaining) time
  stars: boolean; // star pips
  startOverlay: boolean; // Ready screen with a Start button
  endOverlay: boolean; // Won/Lost screen with Retry
}

// What a mode hands back from setup(): the board, trains, optional pinned colours,
// and the objective spec the tracker will run.
export interface ModeSetup {
  levelId: string;
  level: Level;
  trains: TrainDef[];
  colors?: ColorAssignment;
  objective: ObjectiveSpec;
}

// Inputs available to setup(): the board the view currently has (default board,
// editor handoff, or a procgen seed). Modes may ignore these and supply their own.
export interface ModeContext {
  level: Level;
  trains: TrainDef[];
  levelId: string;
}

// Optional per-tick source of new trains/demand (Time Attack / Endless). Puzzle
// and Sandbox return none. Headless + deterministic, driven by scaled dt: each
// step advances its own clock by dt and returns the trains that became due this
// tick (the ids must exist in setup.trains so colours/DOM are already assigned).
// game.ts performs the actual injection (resolving colour + sprite lengths and
// calling sim.addTrain), so the spawner stays a pure schedule cursor.
export interface Spawner {
  step(dt: number): TrainDef[];
  // Re-arm to the start of the schedule (called from game.reset()).
  reset(): void;
}

export interface GameMode {
  id: string;
  label: string;
  description: string;
  setup(ctx: ModeContext): ModeSetup;
  controls: ModeControls;
  createObjective(setup: ModeSetup): ObjectiveTracker;
  createSpawner?(setup: ModeSetup): Spawner;
  hud: HudDescriptor;
}

// The default createObjective for any mode that just runs the tracker over its
// spec (Puzzle, and most future modes).
export function objectiveFromSpec(setup: ModeSetup): ObjectiveTracker {
  return createObjectiveTracker(setup.objective);
}

// Re-export the per-tick observation shape so modes/game.ts share one definition.
export type { Observation };
export type { TrainDef };
