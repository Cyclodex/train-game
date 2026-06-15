import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// Constant pace & coupling through bends — the isolated demonstrator for the road
// driven-length fixes (#36 / #37).
//
// A small rectangular loop (curve corners, a straight on each side) fed by one
// stub, driven at low density by a mix weighted toward articulated semis. With
// only two or three vehicles circulating forever you can watch, in isolation:
//
//  • #36 — a vehicle keeps a STEADY pace all the way round. Before the fix a car
//    visibly slowed on every bend (its per-tile progress ignored the curve's true
//    arc length, so a curve took as long as a full straight); now the advance is
//    normalised to each segment's real driven length, so straights and curves run
//    at one constant world speed (a small, bounded corner ease aside).
//  • #37 — a semi's trailer stays COUPLED to its cab through every corner. Before
//    the fix the cab and trailer were spaced by the tile CENTRELINE while drawn on
//    the lane-offset corner fillet, so the trailer drifted off the cab on each
//    bend; now they are spaced by the real driven lane path and hold a constant
//    gap.
//
// Enable Debug to see the driving lines. No rail, so no trains.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });

export const curvepace: TestScenario = {
  id: "curvepace",
  name: "Curve pace & coupling (semi loop)",
  description:
    "A semi and a car circulate a small curve loop forever — watch the steady pace round every bend (#36) and the trailer staying coupled to the cab through the corners (#37).",
  level: {
    // --- Clockwise loop ring (3×3 inner, rows/cols 1–3) ---
    "1,1": road([Position.Bottom, Position.Right]), // NW corner: north → east
    "2,1": road([Position.Left, Position.Right], [Position.Top, Position.Bottom]), // top straight + feed T
    "3,1": road([Position.Left, Position.Bottom]), // NE corner: east → south
    "3,2": road([Position.Top, Position.Bottom]), // right straight
    "3,3": road([Position.Top, Position.Left]), // SE corner: south → west
    "2,3": road([Position.Right, Position.Left]), // bottom straight
    "1,3": road([Position.Right, Position.Top]), // SW corner: west → north
    "1,2": road([Position.Bottom, Position.Top]), // left straight
    // --- Single feed stub (open end at the top edge) joining the top T ---
    "2,0": road([Position.Top, Position.Bottom]),
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  // Low density so the vehicles never queue — each circulates the loop in the
  // clear, making the pace and the cab/trailer gap easy to eyeball. Heavy on semis
  // so the articulation case is the one on show; the loop is closed, so once it
  // holds `maxCars` it stays a steady carousel.
  traffic: {
    mix: { car: 1, semi: 3 },
    spawnInterval: 1.5,
    maxCars: 3,
    spawnEntries: [{ coord: { x: 2, y: 0 }, entryPort: Position.Top }],
  },
};
