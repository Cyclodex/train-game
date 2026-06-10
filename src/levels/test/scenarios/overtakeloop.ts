import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes, oneWay } from "@/tiles/lanes";

// Same-direction overtaking on a BIG closed loop — a long, 3-lane-each-way "O"
// so faster drivers have plenty of road to pull out, pass a slow leader, and
// tuck back in before the next bend. Unlike the short straight `overtaketwolane`
// demo, here the road never ends: cars enter once from a single on-ramp and then
// circulate forever, so you watch a perpetual overtaking carousel rather than a
// one-shot pass.
//
// Layout — a rectangular ring with 4-tile straights top & bottom (the overtaking
// stretches) and 3-tile sides, curve corners, and one on-ramp merging into the
// top straight:
//
//        (3,0) on-ramp ↓
//   (1,1)─(2,1)─[3,1]─(4,1)─(5,1)─(6,1)       [3,1] = merge T-junction
//     │                              │
//   (1,2)                          (6,2)
//   (1,3)                          (6,3)        sides: Top↔Bottom, 3 lanes
//   (1,4)                          (6,4)
//     │                              │
//   (1,5)─(2,5)─(3,5)─(4,5)─(5,5)─(6,5)
//
// Cars are injected clockwise from the ramp; the loop's bidirectional lanes mean
// the counter-clockwise lanes render but stay empty (the carousel fills one way),
// exactly like `carcircle`. `overtakeFraction` is turned up so passing is easy to
// watch on the long straights.

const N = 3; // lanes per direction

const straightLR = (): Level[string] => ({
  connections: [],
  road: nWayLanes(Position.Left, Position.Right, N),
});
const straightTB = (): Level[string] => ({
  connections: [],
  road: nWayLanes(Position.Top, Position.Bottom, N),
});
const curve = (a: Position, b: Position): Level[string] => ({
  connections: [],
  road: nWayLanes(a, b, N),
});

export const overtakeloop: TestScenario = {
  id: "overtakeloop",
  name: "Overtaking (3-lane loop)",
  description:
    "A big closed loop, 3 lanes each way, with long top & bottom straights and " +
    "one on-ramp. Cars circulate clockwise forever; faster drivers pull into the " +
    "inner lanes to pass slow leaders on the straights, then return — a perpetual " +
    "overtaking carousel.",
  level: {
    // --- Corners (clockwise flow: top L→R, right T→B, bottom R→L, left B→T) ---
    "1,1": curve(Position.Bottom, Position.Right), // NW: up the left side → east
    "6,1": curve(Position.Left, Position.Bottom), // NE: east → down the right side
    "6,5": curve(Position.Top, Position.Left), // SE: down → west along the bottom
    "1,5": curve(Position.Right, Position.Top), // SW: west → up the left side

    // --- Top straight (the on-ramp merges at 3,1) ---
    "2,1": straightLR(),
    "3,1": {
      // Through traffic (both directions, 3 lanes) PLUS a single on-ramp lane
      // entering from the Top stub and merging into the eastbound (→Right) flow.
      connections: [],
      road: [...nWayLanes(Position.Left, Position.Right, N), oneWay(Position.Top, Position.Right)],
    },
    "4,1": straightLR(),
    "5,1": straightLR(),

    // --- Bottom straight ---
    "2,5": straightLR(),
    "3,5": straightLR(),
    "4,5": straightLR(),
    "5,5": straightLR(),

    // --- Left & right sides ---
    "1,2": straightTB(),
    "1,3": straightTB(),
    "1,4": straightTB(),
    "6,2": straightTB(),
    "6,3": straightTB(),
    "6,4": straightTB(),

    // --- On-ramp stub: one-way southbound, open at the top map edge (spawn) ---
    "3,0": { connections: [], road: [oneWay(Position.Top, Position.Bottom)] },
  },
  trains: {},
  size: { cols: 7, rows: 6 },
  // Fill the loop from the single ramp; once full (~16) it stays full, so fast
  // cars keep catching and overtaking slow ones lap after lap.
  traffic: {
    spawnInterval: 0.8,
    maxCars: 16,
    overtakeFraction: 0.85,
    spawnEntries: [{ coord: { x: 3, y: 0 }, entryPort: Position.Top }],
  },
};
