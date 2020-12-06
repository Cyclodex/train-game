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

export enum Possition {
  "Top" = "T",
  "Right" = "R",
  "Bottom" = "B",
  "Left" = "L",
}

export enum Rotations {
  "tr",
  "rb",
  "bl",
  "lt",
}

export interface TileObject {
  id: string;
  component: string;
  x: number;
  y: number;
  train?: TrainObject | null;
  rotation?: Rotations;
}
