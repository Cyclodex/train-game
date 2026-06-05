import { Position, TrainsDefinition, TrainStatus } from "@/types";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";

// The original hand-authored level, now expressed in the connection model.
export const DEFAULT_LEVEL: Level = {
  "0,0": expandKind("curve", 1),
  "1,0": expandKind("straight", 1, { signals: true }),
  "2,0": expandKind("cross", 0, {
    disable: [
      [Position.Top, Position.Bottom],
      [Position.Top, Position.Right],
      [Position.Left, Position.Top],
    ],
  }),
  "3,0": expandKind("cross", 0, {
    disable: [
      [Position.Top, Position.Bottom],
      [Position.Top, Position.Right],
      [Position.Left, Position.Top],
    ],
  }),
  "4,0": expandKind("straight", 1),
  "5,0": expandKind("depot", 3),
  "6,0": expandKind("depot", 2),
  "0,1": expandKind("cross", 0, {
    disable: [
      [Position.Left, Position.Right],
      [Position.Bottom, Position.Left],
      [Position.Left, Position.Top],
    ],
  }),
  "1,1": expandKind("depot", 3),
  "2,1": expandKind("straight", 0, { signals: true }),
  "3,1": expandKind("curve", 0),
  "4,1": expandKind("straight", 1, { signals: true }),
  "5,1": expandKind("straight", 1),
  "6,1": expandKind("cross", 0, {
    disable: [
      [Position.Left, Position.Right],
      [Position.Top, Position.Right],
      [Position.Right, Position.Bottom],
    ],
  }),
  "0,2": expandKind("straight", 0),
  "1,2": expandKind("depot", 1),
  "2,2": expandKind("cross", 0),
  "3,2": expandKind("straight", 1),
  "4,2": expandKind("straight", 1, { signals: true }),
  "5,2": expandKind("straight", 1),
  "6,2": expandKind("cross", 0, {
    disable: [
      [Position.Left, Position.Right],
      [Position.Top, Position.Right],
      [Position.Right, Position.Bottom],
    ],
  }),
  "0,3": expandKind("curve", 0),
  "1,3": expandKind("straight", 1),
  "2,3": expandKind("cross", 0, {
    disable: [
      [Position.Top, Position.Right],
      [Position.Left, Position.Top],
      [Position.Bottom, Position.Left],
      [Position.Right, Position.Bottom],
    ],
  }),
  "3,3": expandKind("straight", 1),
  "4,3": expandKind("cross", 0, {
    disable: [
      [Position.Top, Position.Bottom],
      [Position.Top, Position.Right],
      [Position.Left, Position.Top],
    ],
  }),
  "5,3": expandKind("cross", 0, {
    disable: [
      [Position.Top, Position.Bottom],
      [Position.Top, Position.Right],
      [Position.Left, Position.Top],
    ],
  }),
  "6,3": expandKind("cross", 0, {
    disable: [
      [Position.Left, Position.Right],
      [Position.Top, Position.Right],
      [Position.Right, Position.Bottom],
    ],
  }),
  "0,4": expandKind("depot", 1),
  "1,4": expandKind("straight", 1),
  "2,4": expandKind("cross", 0),
  // Level crossing (Bahnübergang) stub: horizontal rail (on train1's route)
  // with a vertical road crossing it. The road layer is the shared seam
  // (`road?: PortPair[]`); PlayView overlays the crossing furniture + cars.
  "3,4": { ...expandKind("straight", 1), road: [[Position.Top, Position.Bottom]] },
  "4,4": expandKind("curve", 3),
  "5,4": expandKind("depot", 0),
  "6,4": expandKind("straight", 0),
  "2,5": expandKind("curve", 0),
  "3,5": expandKind("straight", 1, { signals: true }),
  "4,5": expandKind("straight", 1),
  "5,5": expandKind("straight", 1),
  "6,5": expandKind("curve", 3),
};

export function defaultTrains(): TrainsDefinition {
  return {
    train1: {
      id: "train1",
      x: 0,
      y: 4,
      status: TrainStatus.LeavingDepot,
      type: "people",
      wagons: [
        { id: "wagonA1", type: "people" },
        { id: "wagonA2", type: "people" },
        { id: "wagonA3", type: "people" },
        { id: "wagonA4", type: "people" },
      ],
      routeDestinations: [{ to: "5,0" }],
      currentRouteDestination: 0,
    },
    train2: {
      id: "train2",
      x: 1,
      y: 2,
      status: TrainStatus.LeavingDepot,
      type: "fraight",
      wagons: [
        { id: "wagonB1", type: "fraight" },
        { id: "wagonB2", type: "fraight" },
      ],
      routeDestinations: [{ to: "5,4" }],
      currentRouteDestination: 0,
    },
  };
}
