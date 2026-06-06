import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Car-following / queue spacing at a level crossing (Bahnübergang).
//
// A long horizontal road (row y=3, x=0..6) crosses a vertical rail at (3,3). A
// people-train bounces forever between two *mismatched* depots — (3,0) green and
// (3,5) blue, train red — so neither lets it park. Every pass closes the gate at
// (3,3); cars spawning one-way from the left edge pile up behind it and, with the
// car-following model, pack bumper-to-bumper instead of leaving a whole tile of
// air between them. When the train clears the crossing the gate opens and the
// queue flushes, then re-forms on the next pass — a repeating spacing demo.
export const carqueue: TestScenario = {
  id: "carqueue",
  name: "Car queue spacing",
  description:
    "Road cars pile up at a closed crossing and pack bumper-to-bumper; the queue flushes each time the bouncing train clears the gate.",
  level: {
    // Vertical rail the train bounces along, crossing the road at (3,3).
    "3,0": expandKind("depot", 2), // opens south
    "3,1": expandKind("straight", 0), // vertical rail
    "3,2": expandKind("straight", 0),
    "3,3": {
      ...expandKind("straight", 0), // vertical rail …
      road: [[Position.Left, Position.Right]], // … crossing the horizontal road
    },
    "3,4": expandKind("straight", 0),
    "3,5": expandKind("depot", 0), // opens north
    // Horizontal road approaching the crossing from the left and leaving right.
    "0,3": { connections: [], road: [[Position.Left, Position.Right]] },
    "1,3": { connections: [], road: [[Position.Left, Position.Right]] },
    "2,3": { connections: [], road: [[Position.Left, Position.Right]] },
    "4,3": { connections: [], road: [[Position.Left, Position.Right]] },
    "5,3": { connections: [], road: [[Position.Left, Position.Right]] },
    "6,3": { connections: [], road: [[Position.Left, Position.Right]] },
  },
  trains: {
    train1: mkTrain("train1", 3, 0, "people", 3, "3,5"),
  },
  colors: {
    depotColors: {
      "3,0": "green", // start — mismatch, so it bounces back out on return
      "3,5": "blue", // destination — mismatch, so it bounces straight back
    },
    trainColors: {
      train1: "red", // matches neither depot → perpetual bounce across the road
    },
  },
  size: { cols: 7, rows: 6 },
};
