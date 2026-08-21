import { Coordinates } from "@/types";
import { Level } from "@/tiles/model";
import {
  usableExits,
  isRoadJunction,
  lanesFrom,
  bikeLaneIndices,
  type VehicleClass,
} from "@/tiles/lanes";
import { Port, neighborCoord, oppositePort } from "./topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { RoadEntry } from "./road";

// A single routing decision at a road junction: which arm the car takes when it
// leaves the junction tile. The car uses this to pick among the junction's exits
// instead of always taking the first one (which would hard-code one route).
export interface RouteTurn {
  junctionId: string;
  exitArm: Port;
}

// One step along the BFS path — the tile the BFS visited and how it was
// traversed (entry → exit).
interface PathStep {
  coord: Coordinates;
  entry: Port;
  exit: Port;
}

// Build the RouteTurns list from the resolved BFS path: only tiles that are
// road junctions contribute a turn (straight/curve tiles are irrelevant to
// the car's route choices).
function extractTurns(level: Level, path: PathStep[]): RouteTurn[] {
  const turns: RouteTurn[] = [];
  for (const step of path) {
    const id = getCoordinatesId(step.coord);
    if (isRoadJunction(level[id]?.road)) {
      turns.push({ junctionId: id, exitArm: step.exit });
    }
  }
  return turns;
}

/**
 * BFS from `(spawnCoord, spawnEntry)` through the road port-graph to a
 * randomly-chosen target entry that is not the spawn entry itself.
 *
 * Returns the sequence of RouteTurns needed at junctions along the path, or
 * `[]` when no targets exist or no path is found.
 *
 * @param level       The full tile map.
 * @param spawnCoord  The tile the car spawns on.
 * @param spawnEntry  The port the car enters through (from the map edge).
 * @param allEntries  All map-edge road entries (includes the spawn entry).
 * @param rng         A seeded [0, 1) uniform random function.
 * @param cls         The vehicle's lane-access class. A "car" routes only over
 *                    car lanes (bus-only lanes are impassable); a "bus" may also
 *                    traverse bus lanes — so only a bus can be routed through a
 *                    bus-only street (the bus shortcut). Defaults to "car", which
 *                    preserves the original car-only BFS exactly.
 */
// Return value of planRoute: the junction turns and the chosen destination entry.
export interface RoutePlan {
  turns: RouteTurn[];
  destination: RoadEntry | null;
}

// Is the street tile at `id`, approached via `entry`, one a BIKE avoids? A
// 3-lane arterial without a cycle lane or shoulder: bikes shun big roads unless
// they get their own space — realistic, and the player's incentive to paint a
// cycle lane on the arterial. Counted per approach over CARRIAGEWAY lanes
// (general + bus; the half-width cycle lane / shoulder is an add-on beside the
// carriageway, exactly the ➕ tool's budget rule). Junctions are movements, not
// streets — never avoided.
function bikeAvoidsStreet(level: Level, id: string, entry: Port): boolean {
  const road = level[id]?.road;
  if (!road?.length || isRoadJunction(road)) return false;
  const carriageway = lanesFrom(road, entry).filter(
    l => l.kind !== "cycle" && l.kind !== "shoulder",
  ).length;
  return carriageway >= 3 && bikeLaneIndices(road, entry).length === 0;
}

export function planRoute(
  level: Level,
  spawnCoord: Coordinates,
  spawnEntry: Port,
  allEntries: RoadEntry[],
  rng: () => number,
  cls: VehicleClass = "car",
): RoutePlan {
  // Filter out the spawn entry itself so the car doesn't immediately target
  // the hole it just entered through.
  const spawnId = getCoordinatesId(spawnCoord);
  const targets = allEntries.filter(
    e =>
      !(getCoordinatesId(e.coord) === spawnId && e.entryPort === spawnEntry) &&
      // A bus-only street's open end is a destination only buses (and bikes,
      // which bus gates admit) may take.
      (cls !== "car" || !e.busOnly),
  );
  if (targets.length === 0) return { turns: [], destination: null };

  // Pick a random target exit entry.
  const target = targets[Math.floor(rng() * targets.length)];
  const targetId = getCoordinatesId(target.coord);

  // One BFS pass over the class-usable road graph. With `avoidArterials` the
  // expansion skips tiles a bike shuns (3-lane streets without a cycle lane or
  // shoulder) — except the target's own tile, which the bike must be allowed to
  // reach however wide its street is.
  const search = (avoidArterials: boolean): RoutePlan | null => {
    // BFS state: each node is (coord, entryPort) — the tile and how the car
    // arrived. We carry the full path so we can extract turns at the end.
    interface QueueItem {
      node: { coord: Coordinates; entryPort: Port };
      path: PathStep[];
    }

    const visited = new Set<string>([`${spawnId}:${spawnEntry}`]);
    const queue: QueueItem[] = [
      { node: { coord: spawnCoord, entryPort: spawnEntry }, path: [] },
    ];

    while (queue.length > 0) {
      const item = queue.shift()!;
      const { node, path } = item;

      const tile = level[getCoordinatesId(node.coord)];
      if (!tile?.road || tile.road.length === 0) continue;

      // Only traverse lanes this vehicle class may use (a car skips bus-only lanes;
      // a bus may take them, so only a bus is routed through a bus-only street).
      const exits = usableExits(tile.road, node.entryPort, cls);

      for (const exitPort of exits) {
        // Center has no map-edge neighbour — skip.
        const nextCoord = neighborCoord(node.coord, exitPort);
        if (!nextCoord) continue;

        const nextId = getCoordinatesId(nextCoord);
        const nextTile = level[nextId];
        const nextEntry = oppositePort(exitPort);
        const connectedBack =
          nextTile?.road && usableExits(nextTile.road, nextEntry, cls).length > 0;

        if (!connectedBack) {
          // Off-grid or dead-end: check whether this is our target exit.
          if (
            getCoordinatesId(node.coord) === targetId &&
            exitPort === target.entryPort
          ) {
            // Found the target — build the full path and return its turns.
            return {
              turns: extractTurns(level, [
                ...path,
                { coord: node.coord, entry: node.entryPort, exit: exitPort },
              ]),
              destination: target,
            };
          }
          // Not our target — this exit leads nowhere useful, skip.
          continue;
        }

        // The avoidance pass steers round arterials it can go round; the target
        // tile is exempt (a destination on a wide street is still a destination).
        if (
          avoidArterials &&
          nextId !== targetId &&
          bikeAvoidsStreet(level, nextId, nextEntry)
        )
          continue;

        // Normal in-grid next tile: advance the BFS.
        const stateId = `${nextId}:${nextEntry}`;
        if (visited.has(stateId)) continue;
        visited.add(stateId);

        queue.push({
          node: { coord: nextCoord, entryPort: nextEntry },
          path: [
            ...path,
            { coord: node.coord, entry: node.entryPort, exit: exitPort },
          ],
        });
      }
    }

    // No path to the chosen target found under these constraints.
    return null;
  };

  // A bike first looks for a route that stays off 3-lane streets without a
  // cycle lane or shoulder. A soft penalty, not a hard ban: when no such route
  // exists (the arterial is the only way), the plain pass below routes it
  // anyway and the bike holds the kerb lane. The second pass draws no RNG, so
  // the spawn/route streams stay untouched for every other vehicle.
  if (cls === "bike") {
    const avoiding = search(true);
    if (avoiding) return avoiding;
  }
  return search(false) ?? { turns: [], destination: null };
}

// --- Routing to a place ON the map (parking) ---------------------------------
//
// `planRoute` above answers "how do I drive off the map again". Parking asks a
// different question: "how do I get to a tile I want to STOP on". The graph and
// the turn extraction are identical; only the goal test changes — from "this exit
// leads off the grid" to "I am standing on one of these (tile, approach) states".
//
// One BFS over a SET of goals, not one per facility: the search is breadth-first,
// so the first goal it reaches is the NEAREST one, which is both the realistic
// choice and cheaper than N separate searches. The caller decides WHICH car park
// to aim at (and skips the full ones); this only finds the way there.

// A place a car can drive to: a tile, entered through a given port.
export interface RouteGoal {
  coord: Coordinates;
  entryPort: Port;
}

export interface GoalRoutePlan {
  turns: RouteTurn[];
  // The goal actually reached, or null when none is reachable.
  goal: RouteGoal | null;
}

export function planRouteToGoals(
  level: Level,
  spawnCoord: Coordinates,
  spawnEntry: Port,
  goals: RouteGoal[],
  cls: VehicleClass = "car",
): GoalRoutePlan {
  if (goals.length === 0) return { turns: [], goal: null };
  const goalKeys = new Map<string, RouteGoal>();
  for (const g of goals) goalKeys.set(`${getCoordinatesId(g.coord)}:${g.entryPort}`, g);

  const startKey = `${getCoordinatesId(spawnCoord)}:${spawnEntry}`;
  // Standing on the goal already — no turns needed. The caller must handle this
  // (a car that spawns on the very tile it wants to park on), or it would drive
  // a lap of the map to reach where it started.
  const here = goalKeys.get(startKey);
  if (here) return { turns: [], goal: here };

  interface QueueItem {
    coord: Coordinates;
    entryPort: Port;
    path: PathStep[];
  }
  const visited = new Set<string>([startKey]);
  const queue: QueueItem[] = [{ coord: spawnCoord, entryPort: spawnEntry, path: [] }];

  while (queue.length > 0) {
    const { coord, entryPort, path } = queue.shift()!;
    const tile = level[getCoordinatesId(coord)];
    if (!tile?.road || tile.road.length === 0) continue;

    for (const exitPort of usableExits(tile.road, entryPort, cls)) {
      const nextCoord = neighborCoord(coord, exitPort);
      if (!nextCoord) continue; // Center has no neighbour
      const nextId = getCoordinatesId(nextCoord);
      const nextTile = level[nextId];
      const nextEntry = oppositePort(exitPort);
      if (
        !nextTile?.road?.length ||
        usableExits(nextTile.road, nextEntry, cls).length === 0
      )
        continue; // off-grid / dead end — never a parking goal

      const stateId = `${nextId}:${nextEntry}`;
      const nextPath = [...path, { coord, entry: entryPort, exit: exitPort }];
      const goal = goalKeys.get(stateId);
      if (goal) return { turns: extractTurns(level, nextPath), goal };
      if (visited.has(stateId)) continue;
      visited.add(stateId);
      queue.push({ coord: nextCoord, entryPort: nextEntry, path: nextPath });
    }
  }
  return { turns: [], goal: null };
}
