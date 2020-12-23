export interface Coordinates {
  x: number;
  y: number;
}

export interface TrainsDefinition {
  [index: string]: TrainObject;
}

export interface TrainObject extends Coordinates {
  id: string;
  direction?: TrainDirection;
  status?: TrainStatus;
  animation?: any;
  wagons?: Wagon[];
  visual?: HTMLElement | null;
}

export interface Wagon {
  id: string;
  type: string;
  weight?: number;
  units?: number;
  animation?: any;
  visual?: HTMLElement | null;
}

export enum TrainStatus {
  "Stopping",
  "Stopped",
  "Started",
  "Running",
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
  rails?: string[];
  leavesAtPosition: Position;
  rotate?: number;
  trafficLight?: TrafficLight;
  disabled?: boolean;
}

export interface LevelDefinition {
  [index: string]: TileObject;
}

export interface TileObject extends Coordinates {
  component: string;
  train?: TrainObject | null;
  rotation?: Rotations;
  activeRoute?: number;
  disabledRoutes?: number[];
  trafficLights?: TrafficLight[];
}

export interface CheckStatusFeedback {
  status: number;
  nextCoordinates: Coordinates;
  hasTrafficLight: boolean;
}

export enum TileStatus {
  "Free",
  "Reserved",
  "Blocked",
}
