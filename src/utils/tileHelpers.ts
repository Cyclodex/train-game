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
    return Position.Top;
  }
}
