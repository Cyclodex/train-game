import { Position, ActiveIntersection, Coordinates } from "@/types";

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

// Curve connections per rotation (mirrors TileCurve.initRoutes).
const CURVE: Record<number, Partial<Record<Port, Port>>> = {
  0: { [Position.Top]: Position.Right, [Position.Right]: Position.Top },
  1: { [Position.Right]: Position.Bottom, [Position.Bottom]: Position.Right },
  2: { [Position.Bottom]: Position.Left, [Position.Left]: Position.Bottom },
  3: { [Position.Left]: Position.Top, [Position.Top]: Position.Left },
};

// Intersection: entry port + switch arm -> exit port (mirrors the allRoutes
// table in TileIntersectionComplete.initRoutes).
const INTERSECTION: Record<number, Record<number, Port>> = {
  [Position.Top]: {
    [ActiveIntersection.Left]: Position.Right,
    [ActiveIntersection.Straight]: Position.Bottom,
    [ActiveIntersection.Right]: Position.Left,
  },
  [Position.Right]: {
    [ActiveIntersection.Left]: Position.Bottom,
    [ActiveIntersection.Straight]: Position.Left,
    [ActiveIntersection.Right]: Position.Top,
  },
  [Position.Bottom]: {
    [ActiveIntersection.Left]: Position.Left,
    [ActiveIntersection.Straight]: Position.Top,
    [ActiveIntersection.Right]: Position.Right,
  },
  [Position.Left]: {
    [ActiveIntersection.Left]: Position.Top,
    [ActiveIntersection.Straight]: Position.Right,
    [ActiveIntersection.Right]: Position.Bottom,
  },
};

export interface ExitOptions {
  switchArm?: ActiveIntersection;
}

// The port a train leaves through, given the tile kind, its rotation, the port
// it entered, and (for intersections) the active switch arm. Returns null when
// there is no connection for that entry.
export function tileExitPort(
  component: string,
  rotation: number,
  entryPort: Port,
  opts: ExitOptions = {}
): Port | null {
  switch (component) {
    case "TileStraight": {
      const vertical = rotation % 2 === 0;
      if (vertical) {
        if (entryPort === Position.Top) return Position.Bottom;
        if (entryPort === Position.Bottom) return Position.Top;
        return null;
      }
      if (entryPort === Position.Right) return Position.Left;
      if (entryPort === Position.Left) return Position.Right;
      return null;
    }
    case "TileCurve":
      return CURVE[((rotation % 4) + 4) % 4][entryPort] ?? null;
    case "TileDepot": {
      const outer = ((rotation % 4) + 4) % 4; // Top/Right/Bottom/Left
      if (entryPort === Position.Center) return outer as Port;
      if (entryPort === outer) return Position.Center;
      return null;
    }
    case "TileIntersectionComplete": {
      if (opts.switchArm === undefined) return null;
      return INTERSECTION[entryPort]?.[opts.switchArm] ?? null;
    }
    default:
      return null;
  }
}
