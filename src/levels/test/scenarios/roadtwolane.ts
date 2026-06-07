import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Two-lane-per-direction road: each direction has 2 physical lanes.
// Opposing streams use opposite sides of the centre divider; same-direction cars in
// different lanes ride side-by-side without following each other.
// This upgrades the old single-lane two-way demo to exercise the full Lane.index model.
export const roadtwolane: TestScenario = {
  id: "roadtwolane",
  name: "Two-lane road: 2 lanes per direction",
  description:
    "A 2-lane-per-direction straight road open at both ends. Cars spawn from both edges and ride their own lane; same-direction cars in different lanes flow independently without stacking.",
  level: {
    "0,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "1,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "2,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "3,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "4,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
  },
  trains: {},
  size: { cols: 5, rows: 3 },
};
