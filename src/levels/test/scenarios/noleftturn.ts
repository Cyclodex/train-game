import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { turns } from "@/tiles/lanes";

const { Top: T, Right: R, Bottom: B, Left: L } = Position;

// No-left-turn cross: every approach may go straight or turn right, but left
// turns are banned (a common real-world junction rule). Directed lanes express
// this by simply omitting the left-turn exit from each approach's `to` list — so
// the route planner can never plan a left turn and the sim never offers one.
// Unlike the right-turn-only cross, this junction still carries conflicting
// movements (the perpendicular straights), so the arbiter still has work to do.
const straight = (a: Position, b: Position) => ({
  connections: [],
  road: [turns(a, [b]), turns(b, [a])],
});

export const noleftturn: TestScenario = {
  id: "noleftturn",
  name: "No-left-turn cross",
  description:
    "A 4-way cross where every approach may go straight or right, but never left. The banned turns are simply absent from each lane, so cars only ever go straight or right.",
  level: {
    "0,2": straight(L, R),
    "1,2": straight(L, R),
    "3,2": straight(L, R),
    "4,2": straight(L, R),
    "2,0": straight(T, B),
    "2,1": straight(T, B),
    "2,3": straight(T, B),
    "2,4": straight(T, B),
    // Straight + right only: L->{R,B}, R->{L,T}, T->{B,L}, B->{T,R}.
    "2,2": {
      connections: [],
      road: [turns(L, [R, B]), turns(R, [L, T]), turns(T, [B, L]), turns(B, [T, R])],
    },
  },
  trains: {},
  size: { cols: 5, rows: 5 },
};
