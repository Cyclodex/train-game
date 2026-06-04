import { describe, it, expect } from "vitest";
import {
  getTrainDirection,
  getLeavingTrainCoordinates,
} from "@/utils/trainHelpers";
import { Position, Route, TrainDirection } from "@/types";

describe("getTrainDirection", () => {
  it("derives the travel direction from origin -> next (y increases downward)", () => {
    const origin = { x: 2, y: 2 };
    expect(getTrainDirection({ x: 3, y: 2 }, origin)).toBe(TrainDirection.Right);
    expect(getTrainDirection({ x: 1, y: 2 }, origin)).toBe(TrainDirection.Left);
    expect(getTrainDirection({ x: 2, y: 3 }, origin)).toBe(TrainDirection.Down);
    expect(getTrainDirection({ x: 2, y: 1 }, origin)).toBe(TrainDirection.Up);
  });

  it("returns None when there is no single-step movement", () => {
    expect(getTrainDirection({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(
      TrainDirection.None
    );
  });
});

describe("getLeavingTrainCoordinates", () => {
  it("adds the route's leaving-position delta to the origin", () => {
    const origin = { x: 3, y: 3 };
    const route = { leavesAtPosition: Position.Bottom } as Route;
    expect(getLeavingTrainCoordinates(route, origin)).toEqual({ x: 3, y: 4 });
  });

  it("returns the origin tile for a Center (depot) leave", () => {
    const origin = { x: 5, y: 0 };
    const route = { leavesAtPosition: Position.Center } as Route;
    expect(getLeavingTrainCoordinates(route, origin)).toEqual({ x: 5, y: 0 });
  });
});
