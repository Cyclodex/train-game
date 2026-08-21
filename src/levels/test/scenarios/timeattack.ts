import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { timeAttackMode } from "@/modes/time-attack";

// Time Attack's predefined schedule in isolation: three short lanes, one train
// each, arriving on a fixed timetable (t=0, 3s, 6s) rather than all at once. The
// first train is present from the start; the next two are injected by the mode's
// spawner at their spawnAtSec. Each routes straight to its matching destination
// depot, so the board is trivially winnable once every train has departed — what
// it demonstrates is the staggered, deterministic spawn, not routing pressure.
// Depot rotations: 1 opens Right, 3 opens Left (see straight.ts).
export const timeattack: TestScenario = {
  id: "timeattack",
  name: "Time Attack schedule",
  description:
    "Trains arrive on a fixed timetable (t=0, 3s, 6s), each routing to its depot.",
  // Run under the Rush variant so the scheduled spawner actually injects t2/t3
  // (Sandbox has no spawner, so they would never appear). A mode OBJECT since
  // #113: Time Attack is a puzzle variant now, not a registered picker mode.
  mode: timeAttackMode,
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("depot", 3),
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    "2,1": expandKind("depot", 3),
    "0,2": expandKind("depot", 1),
    "1,2": expandKind("straight", 1),
    "2,2": expandKind("depot", 3),
  },
  trains: {
    // Present from the start (init train).
    t1: mkTrain("t1", 0, 0, "people", 1, "2,0"),
    // Injected by the spawner partway through the run.
    t2: mkTrain("t2", 0, 1, "people", 1, "2,1", 3),
    t3: mkTrain("t3", 0, 2, "fraight", 1, "2,2", 6),
  },
};
