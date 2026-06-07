import { Coordinates } from "@/types";
import { Level } from "@/tiles/model";
import { exitsFrom, isRoadJunction } from "@/tiles/lanes";
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
 */
export function planRoute(
  level: Level,
  spawnCoord: Coordinates,
  spawnEntry: Port,
  allEntries: RoadEntry[],
  rng: () => number,
): RouteTurn[] {
  // Filter out the spawn entry itself so the car doesn't immediately target
  // the hole it just entered through.
  const spawnId = getCoordinatesId(spawnCoord);
  const targets = allEntries.filter(
    e => !(getCoordinatesId(e.coord) === spawnId && e.entryPort === spawnEntry),
  );
  if (targets.length === 0) return [];

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

    // Every exit partner for this entry port.
    const exits = exitsFrom(tile.road, node.entryPort);

    for (const exitPort of exits) {
      // Center has no map-edge neighbour — skip.
      const nextCoord = neighborCoord(node.coord, exitPort);
      if (!nextCoord) continue;

      const nextId = getCoordinatesId(nextCoord);
      const nextTile = level[nextId];
      const connectedBack =
        nextTile?.road &&
        exitsFrom(nextTile.road, oppositePort(exitPort)).length > 0;

      if (!connectedBack) {
        // Off-grid or dead-end: check whether this is our target exit.
        if (
          getCoordinatesId(node.coord) === targetId &&
          exitPort === target.entryPort
        ) {
          // Found the target — build the full path and return its turns.
          return extractTurns(level, [
            ...path,
            { coord: node.coord, entry: node.entryPort, exit: exitPort },
          ]);
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
  return [];
}
