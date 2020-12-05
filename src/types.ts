export interface TrainObject {
  id: string;
  x: number;
  y: number;
}

export interface TileObject {
  id: string;
  component: string;
  x: number;
  y: number;
  train?: TrainObject | null;
}
