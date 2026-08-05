import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TrainObject, TrainsDefinition, TrainStatus } from "@/types";
import { ColorAssignment } from "@/utils/colorAssignment";
import { TrainRoute } from "@/tiles/validate";
import { TrafficConfig } from "@/sim/road";
import type { GameMode } from "@/modes/types";

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
  // Run the scenario under a specific game mode (by id) instead of free-play
  // Sandbox. Needed for mechanics that only exist in a mode — e.g. Time Attack's
  // scheduled spawner. Omitted → Sandbox (the free-play default for demos).
  modeId?: string;
  // ...or a mode OBJECT, when the scenario needs one with its dials turned.
  // Takes precedence over `modeId`.
  //
  // What this is for, concretely: a board whose subject is a CYCLE rather than a
  // state. The citizens mode runs a day in half an hour of real time, which is
  // right for a session and useless for a demonstration — `/test/homeparking` is
  // about cars being at home at night and at work by day, and at the default
  // clock a visitor sees one hour of one morning and nothing ever changes.
  mode?: GameMode;
  // This board is DELIBERATELY incomplete: it opens with a gap the player buys
  // track across in play (Train Valley M3 — `buildgap`, `lakevalley-open`).
  // The registry test (tests/unit/levels/testScenarios.spec.ts) normally fails
  // any map with dangling track, an unreachable route or a severed depot —
  // which is exactly what an authored gap looks like — so this flag makes it
  // skip THOSE THREE issue types for this scenario only. Every other rule
  // (blocked terrain, trains-in-depots, grid fit) still applies here, and
  // every other scenario keeps the full validation.
  allowIncomplete?: boolean;
}

// A closed loop of track round the rectangle (x0,y0)-(x1,y1): curves at the
// four corners, straights along the sides. The shape a network board wants,
// because a ring needs no turn-back — a train can run it for ever, so a board
// needs exactly one depot (where the train was ordered) and no destination at
// all. Overwrite individual tiles afterwards to place stations on it.
export function railRing(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Level {
  const out: Level = {};
  for (let x = x0; x <= x1; x++) {
    out[`${x},${y0}`] = expandKind("straight", 1);
    out[`${x},${y1}`] = expandKind("straight", 1);
  }
  for (let y = y0; y <= y1; y++) {
    out[`${x0},${y}`] = expandKind("straight", 0);
    out[`${x1},${y}`] = expandKind("straight", 0);
  }
  out[`${x0},${y0}`] = expandKind("curve", 1); // ┌ right + bottom
  out[`${x1},${y0}`] = expandKind("curve", 2); // ┐ bottom + left
  out[`${x1},${y1}`] = expandKind("curve", 3); // ┘ left + top
  out[`${x0},${y1}`] = expandKind("curve", 0); // └ top + right
  return out;
}

// A train IN SERVICE on a line: it starts in the depot at (x,y) and then runs
// the given stops for ever, routing itself between them (sim/railRouter.ts).
// The depot is only where it comes from — there is no destination depot, which
// is why this helper takes no `to`. The network mode's shape.
export function mkLineTrain(
  id: string,
  x: number,
  y: number,
  type: "people" | "fraight",
  wagonCount: number,
  line: string[]
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
    line,
    // Validation reads this to check the board is connected; the first stop is
    // the honest answer to "where is this train trying to get to".
    routeDestinations: line.length ? [{ to: line[0] }] : [],
    currentRouteDestination: 0,
  };
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
