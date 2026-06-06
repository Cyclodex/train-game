import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// Two-lane (right-hand traffic): a single straight road open at both ends. Cars
// spawn from both edges — some eastbound, some westbound — and pass each other on
// opposite sides of the dashed centreline instead of freezing nose-to-nose.
//
// This is the isolated demonstration of the directional lane model: there is no
// junction, so nothing but the lane separation keeps the two streams flowing.
// Junction turn arbitration is covered by roadjunction / roadcross.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });

export const roadtwolane: TestScenario = {
  id: "roadtwolane",
  name: "Two-lane road: opposing traffic",
  description:
    "A straight road open at both ends. Cars enter from both edges and pass each other in opposite lanes (right-hand traffic) instead of deadlocking head-on.",
  level: {
    "0,1": road([Position.Left, Position.Right]),
    "1,1": road([Position.Left, Position.Right]),
    "2,1": road([Position.Left, Position.Right]),
    "3,1": road([Position.Left, Position.Right]),
    "4,1": road([Position.Left, Position.Right]),
  },
  trains: {},
  size: { cols: 5, rows: 3 },
};
