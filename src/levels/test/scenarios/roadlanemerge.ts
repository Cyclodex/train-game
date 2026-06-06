import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes, fromPairs } from "@/tiles/lanes";

// Lane merge: a 2-lane-per-direction road narrows to 1-lane-per-direction.
// A car in lane 1 is clamped to lane 0 when entering the narrow section; no crash.
export const roadlanemerge: TestScenario = {
  id: "roadlanemerge",
  name: "Lane merge: 2→1 lane",
  description:
    "A 2-lane road narrows to 1 lane mid-map. Cars in lane 1 are clamped to lane 0 at the merge; traffic keeps flowing without a crash.",
  level: {
    "0,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "1,1": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "2,1": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
    "3,1": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
    "4,1": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
  },
  trains: {},
  size: { cols: 5, rows: 3 },
};
