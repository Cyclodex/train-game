import { Level } from "@/tiles/model";
import { TrainObject, TrainsDefinition, TrainStatus } from "@/types";
import { ColorAssignment } from "@/utils/colorAssignment";
import { TrainRoute } from "@/tiles/validate";
import { TrafficConfig } from "@/sim/road";

// A single, self-contained feature demo for the /test world. Each scenario is a
// tiny map that shows exactly one mechanic; see the registry in `index.ts`.
export interface TestScenario {
  id: string; // url slug, e.g. "signals"
  name: string; // human label shown in the picker
  description: string; // one line shown under the picker
  level: Level;
  trains: TrainsDefinition;
  // Pin depot/train colours (e.g. to force a depot-mismatch bounce). When
  // omitted, createGame's seeded auto-assignment is used.
  colors?: ColorAssignment;
  // Explicit grid size; defaults to the level's derived extents.
  size?: { cols: number; rows: number };
  // Per-level road-traffic settings (busyness + vehicle mix). Omitted → the
  // game's all-cars default. Used by the trucks scenario to force a heavy
  // truck/semi mix.
  traffic?: TrafficConfig;
}

// Build a train that starts in the depot at (x,y), leaves outward, and routes to
// the single destination depot `to`. `wagonCount` wagons of the train's type.
export function mkTrain(
  id: string,
  x: number,
  y: number,
  type: "people" | "fraight",
  wagonCount: number,
  to: string,
  // Time Attack: when set (>0), the train is injected by the mode's spawner at
  // this sim-time instead of being present from the start (a predefined schedule).
  spawnAtSec?: number
): TrainObject {
  return {
    id,
    x,
    y,
    status: TrainStatus.LeavingDepot,
    type,
    wagons: Array.from({ length: wagonCount }, (_, i) => ({
      id: `${id}w${i + 1}`,
      type,
    })),
    routeDestinations: [{ to }],
    currentRouteDestination: 0,
    ...(spawnAtSec !== undefined && { spawnAtSec }),
  };
}

// The grid extents a scenario renders at: its explicit `size`, or one past the
// largest x/y present in the level.
export function scenarioGrid(scenario: TestScenario): {
  cols: number;
  rows: number;
} {
  if (scenario.size) return scenario.size;
  let cols = 1;
  let rows = 1;
  for (const id of Object.keys(scenario.level)) {
    const [x, y] = id.split(",").map(Number);
    cols = Math.max(cols, x + 1);
    rows = Math.max(rows, y + 1);
  }
  return { cols, rows };
}

// The train routes a scenario implies, for validation: each train's start depot
// to each of its destinations.
export function scenarioRoutes(scenario: TestScenario): TrainRoute[] {
  const routes: TrainRoute[] = [];
  for (const train of Object.values(scenario.trains)) {
    const from = `${train.x},${train.y}`;
    for (const dest of train.routeDestinations ?? []) {
      routes.push({ from, to: dest.to });
    }
  }
  return routes;
}
