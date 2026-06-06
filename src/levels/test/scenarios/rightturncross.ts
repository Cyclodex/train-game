import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { turns } from "@/tiles/lanes";

const { Top: T, Right: R, Bottom: B, Left: L } = Position;

// Right-turn-only cross: cars enter from all four arms but the centre permits
// only the four right turns (Left→Bottom, Bottom→Right, Right→Top, Top→Left).
// Right turns never cross each other, so all four streams flow at once with no
// conflict — the turn-restriction capability the undirected model could not
// express. Arms are two-way so cars arrive from every edge.
const straight = (a: Position, b: Position) => ({
  connections: [],
  road: [turns(a, [b]), turns(b, [a])],
});

export const rightturncross: TestScenario = {
  id: "rightturncross",
  name: "Right-turn-only cross",
  description:
    "A 4-way cross where every approach may only turn right. Cars enter from all four arms and never conflict — the junction needs no signals and never blocks.",
  level: {
    "0,2": straight(L, R),
    "1,2": straight(L, R),
    "3,2": straight(L, R),
    "4,2": straight(L, R),
    "2,0": straight(T, B),
    "2,1": straight(T, B),
    "2,3": straight(T, B),
    "2,4": straight(T, B),
    "2,2": { connections: [], road: [turns(L, [B]), turns(B, [R]), turns(R, [T]), turns(T, [L])] },
  },
  trains: {},
  size: { cols: 5, rows: 5 },
};
