import { Position, Coordinates } from "@/types";

// A "port" is the side of a tile a train enters or leaves through.
export type Port = Position;

export function oppositePort(port: Port): Port {
  switch (port) {
    case Position.Top:
      return Position.Bottom;
    case Position.Bottom:
      return Position.Top;
    case Position.Left:
      return Position.Right;
    case Position.Right:
      return Position.Left;
    default:
      return Position.Center;
  }
}

// The neighbouring tile reached by leaving through `exitPort` (y grows downward).
// Center has no neighbour (it is the inside of a depot).
export function neighborCoord(
  coord: Coordinates,
  exitPort: Port
): Coordinates | null {
  switch (exitPort) {
    case Position.Top:
      return { x: coord.x, y: coord.y - 1 };
    case Position.Right:
      return { x: coord.x + 1, y: coord.y };
    case Position.Bottom:
      return { x: coord.x, y: coord.y + 1 };
    case Position.Left:
      return { x: coord.x - 1, y: coord.y };
    default:
      return null;
  }
}
