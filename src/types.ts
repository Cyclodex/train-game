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
  "Top",
  "Right",
  "Bottom",
  "Left",
}

export enum Rotations {
  "Top",
  "Right",
  "Bottom",
  "Left",
}

export enum ActiveIntersection {
  "Left",
  "Straight",
  "Right",
}

export interface TrafficLight {
  direction: TrafficLightDirection;
  signal: TrafficLightSignal;
}

export enum TrafficLightDirection {
  "Disabled",
  "Forward",
  "Backward",
}

export enum TrafficLightSignal {
  "Disabled",
  "Red",
  "Green",
}

export interface PossibleRoutesPerRotation {
  [index: number]: PossibleRoutes;
}

export interface PossibleRoutes {
  [index: string]: Route;
}

export interface Route {
  path: string;
  leavesAtPosition: Position;
  rotate?: number;
  trafficLight?: TrafficLight;
}

export interface TileObject {
  component: string;
  x: number;
  y: number;
  train?: TrainObject | null;
  rotation?: Rotations;
  activeRoute?: number;
  disabledRoutes?: number[];
  trafficLights?: TrafficLight[];
}
