export interface TrainObject {
  id: string;
  x: number;
  y: number;
  direction?: TrainDirection;
}

export enum TrainDirection {
  "Up" = "U",
  "Right" = "R",
  "Down" = "D",
  "Left" = "L",
}

export interface TileObject {
  id: string;
  component: string;
  x: number;
  y: number;
  train?: TrainObject | null;
}
