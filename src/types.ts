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

export enum Position {
  "Top" = "T",
  "Right" = "R",
  "Bottom" = "B",
  "Left" = "L",
}

export enum Rotations {
  "Top",
  "Right",
  "Bottom",
  "Left",
}

export interface PossibleRoutesPerRotation {
  [index: number]: PossibleRoutes;
}

export interface PossibleRoutes {
  [index: string]: {
    path: string;
    leavesAtPosition: Position;
    rotate?: number;
  };
}

export interface TileObject {
  component: string;
  x: number;
  y: number;
  train?: TrainObject | null;
  rotation?: Rotations;
}
