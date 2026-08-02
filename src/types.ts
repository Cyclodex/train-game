export interface Coordinates {
  x: number;
  y: number;
}

export interface TrainsDefinition {
  [index: string]: TrainObject;
}

export interface TrainObject extends Coordinates {
  test?: string;
  id: string;
  direction?: TrainDirection;
  status?: TrainStatus;
  animation?: any;
  wagons?: Wagon[];
  visual?: HTMLElement | null;
  routeDestinations?: RouteDestinations[];
  currentRouteDestination?: number;
  type: "people" | "fraight";
  trainColor?: string;
  // Time Attack: when set (>0), this train is injected by the mode's spawner at
  // this sim-time instead of being present from the start (a predefined schedule).
  spawnAtSec?: number;
  // The LINE this train serves (network mode): station tile ids, in order,
  // cycled for ever. Unlike `routeDestinations` — metadata the sim never reads
  // — a line IS read by the sim: the train routes itself from stop to stop.
  line?: string[];
}

export interface RouteDestinations {
  to: string;
  routes?: CheckedRoutesString | CheckedRoutesObject;
  selectedRouteIndex?: number;
  selectedRoute?: CheckedRoutesString | CheckedRoutesObject;
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
  "Init",
  "EnteringDepot",
  "LeavingDepot",
}

export enum TrainDirection {
  "None" = "N",
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
  "Center",
}

export enum Rotations {
  "Top",
  "Right",
  "Bottom",
  "Left",
}
export interface ActiveIntersectionPerPosition {
  [index: number]: ActiveIntersection;
}

export interface DisabledIntersectionsPerPosition {
  [index: number]: ActiveIntersection[];
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
  activeRoutes?: ActiveIntersectionPerPosition;
  disabledRoutes?: DisabledIntersectionsPerPosition;
  trafficLights?: TrafficLight[];
  enableTrafficLight?: boolean;
}

export interface CheckStatusFeedback {
  status: number;
  nextCoordinates: Coordinates;
  hasTrafficLight: boolean;
  possibleRoutes: CheckStatusPossibleRoutes;
}

export interface CheckStatusPossibleRoutes {
  [index: string]: CheckStatusRoute;
}
export interface CheckStatusRoute extends Route {
  nextCoordinates: Coordinates;
  intersectionSwitchPosition: ActiveIntersection;
}

export interface CheckedRoutesString {
  [index: string]: string[];
}

export interface CheckedRoutesObject {
  [index: string]: CheckedRoutesPossiblePath[];
}

export interface CheckedRoutesPossiblePath {
  entrancePosition: Position;
  leavesAtPosition: Position;
}

export enum TileStatus {
  "Free",
  "Reserved",
  "Blocked",
}
