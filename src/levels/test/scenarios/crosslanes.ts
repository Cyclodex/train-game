import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, nWayLanes } from "@/tiles/lanes";

// A 4-way cross where the arms have DIFFERENT lane counts: a 1-lane north–south
// road crosses a 3-lane east–west road. This is the case that used to break — a
// car carried its approach lane straight across and everyone piled into exit lane
// 0. Now each vehicle lands in the exit lane that MATCHES its movement:
//   • a 1-lane car turning left fans out to the inner (left) lane of the 3-lane arm,
//   • turning right hugs the kerb lane,
//   • going straight keeps the kerb lane;
//   • a 3-lane car turning onto the 1-lane arm merges down to its single lane.
// Toggle Debug to watch each car ease into its matched lane just past the cross.
const T = Position.Top;
const B = Position.Bottom;
const L = Position.Left;
const R = Position.Right;

// The crossroads centre: 3-lane east–west approaches and 1-lane north–south
// approaches, every lane permitting straight + both turns (no dedicated turn
// lanes — the point here is the EXIT lane matching, not approach sorting).
function centre(): Lane[] {
  const ew = (from: Position, straight: Position): Lane[] =>
    Array.from({ length: 3 }, (_, i) => ({ from, to: [straight, T, B], index: i }));
  return [
    ...ew(L, R),
    ...ew(R, L),
    { from: T, to: [B, L, R], index: 0 }, // 1-lane north approach
    { from: B, to: [T, L, R], index: 0 }, // 1-lane south approach
  ];
}

const ewArm = () => ({ connections: [], road: nWayLanes(L, R, 3) });
const nsArm = () => ({ connections: [], road: nWayLanes(T, B, 1) });

export const crosslanes: TestScenario = {
  id: "crosslanes",
  name: "Cross: unequal lanes (1↔3) match the exit lane",
  description:
    "A 1-lane north–south road crosses a 3-lane east–west road. Cars fan out into " +
    "the exit lane their turn implies (left→inner, right/straight→kerb) and merge " +
    "down when turning onto the 1-lane arm, instead of all piling into lane 0. " +
    "Toggle Debug to watch each car ease into its matched lane past the cross.",
  level: {
    // East–west 3-lane road.
    "0,3": ewArm(),
    "1,3": ewArm(),
    "2,3": ewArm(),
    "3,3": { connections: [], road: centre() },
    "4,3": ewArm(),
    "5,3": ewArm(),
    "6,3": ewArm(),
    // North–south 1-lane road.
    "3,0": nsArm(),
    "3,1": nsArm(),
    "3,2": nsArm(),
    "3,4": nsArm(),
    "3,5": nsArm(),
    "3,6": nsArm(),
  },
  trains: {},
  size: { cols: 7, rows: 7 },
  // Steady flow from every edge so both the fan-out (1→3) and the merge (3→1) are
  // on show at once.
  traffic: { spawnInterval: 0.7, maxCars: 16 },
};
