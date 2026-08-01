import { ActiveIntersection, Coordinates } from "@/types";
import { Level, claimKey, connectionsToExitPort } from "@/tiles/model";
import { Port, neighborCoord, oppositePort } from "./topology";
import { getCoordinatesId } from "@/utils/tileHelpers";

// Resolves the active switch arm for an intersection tile at `coordId` entered
// through `entryPort`. Returns undefined for non-intersection tiles.
export type SwitchResolver = (
  coordId: string,
  entryPort: Port
) => ActiveIntersection | undefined;

export interface Traversal {
  // The port the train leaves the current tile through. `Position.Center` means
  // it parks inside a depot; null means the tile has no connection for the entry.
  exitPort: Port | null;
  // The next tile to travel onto, or null when the train parks / leaves the map.
  next: { coord: Coordinates; entryPort: Port } | null;
}

export function resolveExitPort(
  level: Level,
  getSwitch: SwitchResolver,
  coord: Coordinates,
  entryPort: Port
): Port | null {
  const tile = level[getCoordinatesId(coord)];
  if (!tile || tile.connections.length === 0) return null;
  const arm = getSwitch(getCoordinatesId(coord), entryPort);
  return connectionsToExitPort(tile.connections, entryPort, arm);
}

// Given the tile a train is on and the port it entered through, work out where
// it leaves and which tile/port it arrives at next.
export function traverse(
  level: Level,
  getSwitch: SwitchResolver,
  coord: Coordinates,
  entryPort: Port
): Traversal {
  const exitPort = resolveExitPort(level, getSwitch, coord, entryPort);
  if (exitPort === null) return { exitPort: null, next: null };

  const nextCoord = neighborCoord(coord, exitPort);
  if (!nextCoord) return { exitPort, next: null }; // Center: parks in depot

  const nextTile = level[getCoordinatesId(nextCoord)];
  if (!nextTile || nextTile.connections.length === 0)
    return { exitPort, next: null };

  return {
    exitPort,
    next: { coord: nextCoord, entryPort: oppositePort(exitPort) },
  };
}

export type BoundaryCheck = (tileId: string) => boolean;

// Walk forward from a tile (following the train's switches), collecting the
// CLAIM KEYS of the block ahead: every tile up to and including the next signal
// boundary. A claim key is the tile id everywhere except on a flyover, where
// each level of the crossing claims separately (see tiles/model.ts) — so a
// route over the deck never reserves the line running underneath. Stops at a
// depot / map edge / dead end, and is loop- and length-capped so a signal-less
// loop can never run forever.
export function routeToNextSignal(
  level: Level,
  getSwitch: SwitchResolver,
  isBoundary: BoundaryCheck,
  fromCoord: Coordinates,
  fromEntryPort: Port
): string[] {
  const out: string[] = [];
  const visited = new Set<string>();
  let coord = fromCoord;
  let entry = fromEntryPort;
  const MAX = 100;
  for (let i = 0; i < MAX; i++) {
    const t = traverse(level, getSwitch, coord, entry);
    if (!t.next) break; // depot interior / map edge / dead end
    const nextId = getCoordinatesId(t.next.coord);
    out.push(claimKey(level[nextId], nextId, t.next.entryPort));
    if (isBoundary(nextId)) break; // reached the next signal (inclusive)
    const key = `${nextId}:${t.next.entryPort}`;
    if (visited.has(key)) break; // loop with no signal
    visited.add(key);
    coord = t.next.coord;
    entry = t.next.entryPort;
  }
  return out;
}
