import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { oneWay } from "@/tiles/lanes";

// One-way street: every tile carries a single eastbound lane (Left -> Right).
// There is no westbound lane, so cars only ever flow east — the first capability
// the directed model unlocks that the undirected one could not express.
export const roadoneway: TestScenario = {
  id: "roadoneway",
  name: "One-way street",
  description:
    "A one-way road: every tile has a single Left→Right lane, so traffic only ever flows east. Nothing spawns or routes against it.",
  level: {
    "0,1": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    "1,1": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    "2,1": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    "3,1": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    "4,1": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
  },
  trains: {},
  size: { cols: 5, rows: 3 },
};
