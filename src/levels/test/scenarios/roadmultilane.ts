import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Three-lane-per-direction road: demonstrates multi-lane rendering and that
// same-direction cars in different lane slots don't block each other.
export const roadmultilane: TestScenario = {
  id: "roadmultilane",
  name: "Multi-lane road: 3 lanes per direction",
  description:
    "A 3-lane-per-direction straight road. Six parallel streams flow simultaneously; a car in lane 2 never waits behind a car in lane 0 going the same way.",
  level: {
    "0,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
    "1,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
    "2,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
    "3,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
    "4,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
  },
  trains: {},
  size: { cols: 5, rows: 3 },
  traffic: {
    spawnInterval: 0.4,
    maxCars: 16,
  },
};
