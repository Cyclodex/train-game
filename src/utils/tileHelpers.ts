import { Position, TileObject, TrainObject, Coordinates } from "@/types";

export function getCoordinatesId(
  options: TrainObject | TileObject | { x: number; y: number }
) {
  return `${options.x},${options.y}`;
}

export function getTileEntrancePosition(
  nextTileCoordinates: Coordinates,
  originCoordinates: Coordinates
) {
  const x = nextTileCoordinates.x - originCoordinates.x;
  const y = nextTileCoordinates.y - originCoordinates.y;
  const directionCode = getCoordinatesId({ x, y });
  switch (directionCode) {
  case "0,0":
    return Position.Center;
  case "0,1":
    return Position.Top;
  case "-1,0":
    return Position.Right;
  case "0,-1":
    return Position.Bottom;
  case "1,0":
      return Position.Left;
  default:
    console.error("getTileEntrancePosition: failed");
    debugger;
    return Position.Center;
  }
}

export function getRelativeCoordinatesOfNextTile(leavingPosition: Position) {
  switch (leavingPosition) {
  case Position.Top:
    return { x: 0, y: -1 };
  case Position.Right:
    return { x: 1, y: 0 };
  case Position.Bottom:
    return { x: 0, y: 1 };
  case Position.Left:
    return { x: -1, y: 0 };
  default:
    return { x: 0, y: 0 };
  }
}

export function getIntersectionSwitch(
  entrancePosition: Position,
  leavingPosition: Position
) {
  const diff = leavingPosition - entrancePosition;
  switch (leavingPosition) {
  case Position.Top:
    return { x: 0, y: -1 };
  case Position.Right:
    return { x: 1, y: 0 };
  case Position.Bottom:
    return { x: 0, y: 1 };
  case Position.Left:
    return { x: -1, y: 0 };
  default:
    return { x: 0, y: 0 };
  }
}
