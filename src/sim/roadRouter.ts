import { Coordinates } from "@/types";
import { Level } from "@/tiles/model";
import { usableExits, isRoadJunction, type VehicleClass } from "@/tiles/lanes";
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
      // A bus-only street's open end is a destination only buses may take.
      (cls === "bus" || !e.busOnly),
  );
  if (targets.length === 0) return { turns: [], destination: null };

  // Pick a random target exit entry.
  const target = targets[Math.floor(rng() * targets.length)];
  const targetId = getCoordinatesId(target.coord);

  // BFS state: each node is (coord, entryPort) — the tile and how the car
  // arrived. We carry the full path so we can extract turns at the end.
  interface BfsNode {
    coord: Coordinates;
    entryPort: Port;
  }
  interface QueueItem {
    node: BfsNode;
    path: PathStep[];
  }

  const visited = new Set<string>();
  const startStateId = `${spawnId}:${spawnEntry}`;
  visited.add(startStateId);

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
      const connectedBack =
        nextTile?.road &&
        usableExits(nextTile.road, oppositePort(exitPort), cls).length > 0;

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

      // Normal in-grid next tile: advance the BFS.
      const stateId = `${nextId}:${oppositePort(exitPort)}`;
      if (visited.has(stateId)) continue;
      visited.add(stateId);

      queue.push({
        node: { coord: nextCoord, entryPort: oppositePort(exitPort) },
        path: [
          ...path,
          { coord: node.coord, entry: node.entryPort, exit: exitPort },
        ],
      });
    }
  }

  // No path to the chosen target found.
  return { turns: [], destination: null };
}
