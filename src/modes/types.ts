import { Level } from "@/tiles/model";
import { TrainDef } from "@/game";
import { ColorAssignment } from "@/utils/colorAssignment";
import {
  ObjectiveSpec,
  ObjectiveTracker,
  Observation,
  createObjectiveTracker,
} from "@/sim/objectives";
import { EconomySpec, FareSpec } from "@/sim/economy";
import { CalendarSetup } from "@/sim/calendar";
import { CitizenTuning } from "@/sim/citizens";

// Which existing player controls a mode enables. The sim already implements all
// of these; a mode only gates whether the view exposes them.
export interface ModeControls {
  switches: boolean; // flip junction switches
  signalHolds: boolean; // hold/release + force-green signals
  // Manual level-crossing gate. FALSE IN EVERY SHIPPED MODE since Crossing
  // Keeper was retired from the picker (#121), and nothing in the view reads it
  // any more — the worst-car-wait readout it used to gate was removed with the
  // mode. The flag (and the `maxCarWaitSec`/`carsDelivered`/`crossingIncidents`
  // counters in `sim/objectives.ts`, which the road frame still fills every
  // tick) stays for the road-scoring mode that revives them; see
  // `docs/road-future-improvements.md` §1.
  crossingGate: boolean;
  build: boolean; // edit the board (Sandbox)
  // Trains wait in their depot until the player sends them (Tycoon). This is the
  // ONLY switch that turns the sim's `waitForDispatch` on — leave it false and
  // trains depart immediately, exactly as every mode before this one did.
  dispatch: boolean;
}

// Which readouts/overlays the HUD shows for this mode. A pure view hint.
export interface HudDescriptor {
  deliveries: boolean; // "N/M delivered" card
  // "N/M carried" card — the network mode's readout, replacing the delivery
  // card rather than joining it (one progress number per mode). Optional so
  // every mode written before stations existed needs no change.
  passengers?: boolean;
  timer: boolean; // elapsed (or remaining) time
  stars: boolean; // star pips
  startOverlay: boolean; // Ready screen with a Start button
  endOverlay: boolean; // Won/Lost screen with Retry
  // Balance readout + the per-train fare badges. Deliberately the whole money
  // HUD in one flag: the design doc's §5.5 warning is against TV2's chrome
  // density, so this is one card and one badge per train, nothing else.
  money: boolean;
}

// A mode's economy, handed to game.ts by setup(). Omitted → no ledger at all:
// no fares, no balance, the money counters stay 0 and the HUD shows nothing.
export interface EconomySetup extends EconomySpec {
  // The fare each train carries, by train id. A train with no entry is simply
  // worth nothing — useful for scenery//test trains that only exist to move.
  fares?: Record<string, FareSpec>;
  // The SECOND clock (design doc §1.3): an in-game calendar and the annual
  // upkeep levied on the track the player laid. Omitted → no calendar and no
  // tax, which is every board that has not been tuned for one; the money HUD
  // then shows the balance line alone, exactly as before.
  calendar?: CalendarSetup;
}

// The citizen layer, handed to game.ts by setup(). Omitted → no cities, no
// people, and the station spawn schedule keeps working exactly as before.
//
// Present → the board's towns are populated with citizens who live, work,
// choose how to travel and judge the result. The synthetic per-station demand
// (`stationDemandOf`) is turned OFF in that case, because the citizens ARE the
// demand and two sources would double-count the platform.
export interface CitizenSetup {
  // Overrides on the citizen sim's tuning (day length, speeds, patience). The
  // day length is the genre dial — see sim/citizens.ts DEFAULT_TUNING.
  tuning?: Partial<CitizenTuning>;
  // Seed for the population: who lives where, who owns a car, who works across
  // the map. Defaults to the game's colour seed so a board is reproducible.
  seed?: number;
}

// What a mode hands back from setup(): the board, trains, optional pinned colours,
// and the objective spec the tracker will run.
export interface ModeSetup {
  levelId: string;
  level: Level;
  trains: TrainDef[];
  colors?: ColorAssignment;
  objective: ObjectiveSpec;
  economy?: EconomySetup;
  citizens?: CitizenSetup;
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
  // Why this mode cannot run on a board — a one-line reason for the picker —
  // or null when it fits. Judged over the board's DERIVED capabilities
  // (modes/compat.ts), so nobody maintains per-board mode lists. Omitted →
  // the mode runs anywhere (Sandbox, and modes that generate their own board
  // like Daily). See #114.
  fits?(caps: import("@/modes/compat").BoardCapabilities): string | null;
}

// The default createObjective for any mode that just runs the tracker over its
// spec (Puzzle, and most future modes).
export function objectiveFromSpec(setup: ModeSetup): ObjectiveTracker {
  return createObjectiveTracker(setup.objective);
}

// Re-export the per-tick observation shape so modes/game.ts share one definition.
export type { Observation };
export type { TrainDef };
