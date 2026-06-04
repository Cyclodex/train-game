import { LevelDefinition, ActiveIntersection, Coordinates } from "@/types";
import { Port, tileExitPort, neighborCoord, oppositePort } from "./topology";
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
  level: LevelDefinition,
  getSwitch: SwitchResolver,
  coord: Coordinates,
  entryPort: Port
): Port | null {
  const tile = level[getCoordinatesId(coord)];
  if (!tile || !tile.component) return null;
  const rotation = tile.rotation ?? 0;
  const switchArm = getSwitch(getCoordinatesId(coord), entryPort);
  return tileExitPort(tile.component, rotation, entryPort, { switchArm });
}

// Given the tile a train is on and the port it entered through, work out where
// it leaves and which tile/port it arrives at next.
export function traverse(
  level: LevelDefinition,
  getSwitch: SwitchResolver,
  coord: Coordinates,
  entryPort: Port
): Traversal {
  const exitPort = resolveExitPort(level, getSwitch, coord, entryPort);
  if (exitPort === null) return { exitPort: null, next: null };

  const nextCoord = neighborCoord(coord, exitPort);
  if (!nextCoord) return { exitPort, next: null }; // Center: parks in depot

  const nextTile = level[getCoordinatesId(nextCoord)];
  if (!nextTile || !nextTile.component) return { exitPort, next: null };

  return { exitPort, next: { coord: nextCoord, entryPort: oppositePort(exitPort) } };
}
