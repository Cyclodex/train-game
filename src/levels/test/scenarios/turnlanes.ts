import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { oneWay, turns, Lane } from "@/tiles/lanes";

// Turn lanes + lane sorting (sub-projects F and G). A 2-lane one-way road runs
// north into a T-junction whose approach has dedicated turn lanes: the kerb lane
// (index 0, the car's right) may only turn right (east); the inner lane (index 1)
// may only turn left (west). Cars spawn at the bottom, get a random destination
// (the west or east arm), and SORT THEMSELVES into the lane that permits their
// turn (F) by changing lanes on the approach tiles (G) before reaching the
// junction. The debug overlay (toggle Debug) shows the per-lane turn arrows.

const T = Position.Top;
const B = Position.Bottom;
const L = Position.Left;
const R = Position.Right;

// One-way northbound (Bottom → Top) road with `n` lanes.
function northbound(n: number): Lane[] {
  return Array.from({ length: n }, (_, i) => ({ from: B, to: [T], index: i }));
}

export const turnlanes: TestScenario = {
  id: "turnlanes",
  name: "Turn lanes (lane sorting)",
  description:
    "A 2-lane one-way approach to a T-junction: the kerb lane turns right, the " +
    "inner lane turns left. Cars sort into the correct lane before the junction " +
    "(F), changing lanes to get there (G). Toggle Debug for the per-lane arrows.",
  level: {
    // Northbound 2-lane approach (cars spawn at the bottom edge of 2,4).
    "2,4": { connections: [], road: northbound(2) },
    "2,3": { connections: [], road: northbound(2) },
    "2,2": { connections: [], road: northbound(2) },
    // T-junction: kerb lane 0 → right (east); inner lane 1 → left (west).
    "2,1": { connections: [], road: [turns(B, [R], 0), turns(B, [L], 1)] },
    // West arm (outbound to the left edge) and east arm (outbound to the right).
    "1,1": { connections: [], road: [oneWay(R, L)] },
    "0,1": { connections: [], road: [oneWay(R, L)] },
    "3,1": { connections: [], road: [oneWay(L, R)] },
    "4,1": { connections: [], road: [oneWay(L, R)] },
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  // Spawn only from the south edge: the one-way approach means the junction's
  // own Bottom port would otherwise be auto-detected as a dead-end entry, putting
  // cars ON the junction with no room to sort.
  traffic: {
    spawnInterval: 0.7,
    maxCars: 8,
    spawnEntries: [{ coord: { x: 2, y: 4 }, entryPort: Position.Bottom }],
  },
};
