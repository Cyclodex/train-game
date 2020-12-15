import { TrainDirection, TrainObject } from "@/types";
import { getCoordinatesId } from "./tileHelpers";

export function getTrainDirection(
  train: TrainObject,
  trainOrigin: TrainObject
) {
  const x = train.x - trainOrigin.x;
  const y = train.y - trainOrigin.y;
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
