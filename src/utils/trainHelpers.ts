import { Coordinates, Route, TrainDirection } from "@/types";
import {
  getCoordinatesId,
  getRelativeCoordinatesOfNextTile,
} from "./tileHelpers";

export function getTrainDirection(next: Coordinates, origin: Coordinates) {
  const x = next.x - origin.x;
  const y = next.y - origin.y;
  const directionCode = getCoordinatesId({ x, y });
  switch (directionCode) {
  case "0,1":
    return TrainDirection.Down;
  case "-1,0":
    return TrainDirection.Left;
  case "0,-1":
    return TrainDirection.Up;
  case "1,0":
      return TrainDirection.Right;
  default:
    console.error("getTrainDirection: failed");
    debugger;
    return TrainDirection.Down;
  }
}

export function getLeavingTrainCoordinates(
  trainRoute: Route,
  origin: Coordinates
) {
  if (trainRoute) {
    const coordinatesChange = getRelativeCoordinatesOfNextTile(
      trainRoute.leavesAtPosition
    );
    const nextTileCoordinates = {
      x: origin.x + coordinatesChange.x,
      y: origin.y + coordinatesChange.y,
    };
    return nextTileCoordinates;
  }
  console.error("getLeavingTrainCoordinates: no route");
  // debugger;
  return { x: 0, y: 0 };
}
