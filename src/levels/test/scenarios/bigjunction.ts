import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { turns, nWayLanes, Lane } from "@/tiles/lanes";

// Big signalised-style crossroads with dedicated turn lanes (sub-projects F + G).
// Every arm is a THREE-lane two-way road and the central junction assigns one
// movement to each inbound lane:
//   • lane 0 (kerb / right-hand side of travel) → turn RIGHT
//   • lane 1 (middle)                            → go STRAIGHT
//   • lane 2 (inner / centre-adjacent)           → turn LEFT
// Cars spawn from all four edges, draw a random destination arm, and SORT
// themselves into the lane that permits their turn on the 3-tile approach before
// reaching the junction. This is purely data — no engine feature is needed; it is
// the `turnlanes` T-junction generalised to a full 4-way × 3-lane crossroads.
// Toggle Debug for the per-lane turn arrows and (hover/click a car) its route.
//
// Turn directions per approach (a car enters via `from` and drives toward the
// opposite side; "right"/"left" are relative to that travel direction):
//   from Bottom (going north): right→Right,  straight→Top,    left→Left
//   from Top    (going south): right→Left,   straight→Bottom, left→Right
//   from Left   (going east) : right→Bottom, straight→Right,  left→Top
//   from Right  (going west) : right→Top,    straight→Left,   left→Bottom
const { Top, Right, Bottom, Left } = Position;

// A straight 3-lane two-way arm (each lane simply continues into/out of the
// junction; the lane *sorting* is forced by the junction's per-lane turns).
const vertArm = () => ({ connections: [], road: nWayLanes(Top, Bottom, 3) });
const horzArm = () => ({ connections: [], road: nWayLanes(Left, Right, 3) });

// The crossroads: 12 directed lanes (3 inbound lanes × 4 arms), each lane wired to
// exactly one exit so right/straight/left are dedicated lanes.
const crossroads = (): { connections: []; road: Lane[] } => ({
  connections: [],
  road: [
    turns(Bottom, [Right], 0), turns(Bottom, [Top], 1), turns(Bottom, [Left], 2),
    turns(Top, [Left], 0), turns(Top, [Bottom], 1), turns(Top, [Right], 2),
    turns(Left, [Bottom], 0), turns(Left, [Right], 1), turns(Left, [Top], 2),
    turns(Right, [Top], 0), turns(Right, [Left], 1), turns(Right, [Bottom], 2),
  ],
});

export const bigjunction: TestScenario = {
  id: "bigjunction",
  name: "Big junction: 3-lane turn lanes (R / straight / L)",
  description:
    "A 4-way crossroads where every arm has three lanes — kerb lane turns right, " +
    "middle goes straight, inner lane turns left. Cars sort into the correct lane " +
    "before the junction. Toggle Debug for per-lane turn arrows and car routes.",
  level: {
    // Top arm (north): 3-tile 3-lane approach down to the junction.
    "3,0": vertArm(),
    "3,1": vertArm(),
    "3,2": vertArm(),
    // Bottom arm (south).
    "3,4": vertArm(),
    "3,5": vertArm(),
    "3,6": vertArm(),
    // Left arm (west).
    "0,3": horzArm(),
    "1,3": horzArm(),
    "2,3": horzArm(),
    // Right arm (east).
    "4,3": horzArm(),
    "5,3": horzArm(),
    "6,3": horzArm(),
    // The central crossroads with dedicated turn lanes.
    "3,3": crossroads(),
  },
  trains: {},
  size: { cols: 7, rows: 7 },
  // A steady flow so the lane-sorting is easy to watch (the test world's Cars
  // slider still scales density live).
  traffic: { spawnInterval: 0.9, maxCars: 12 },
};
