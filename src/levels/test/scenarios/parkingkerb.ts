import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";

// KERBSIDE PARKING — the wide-street case the whole feature starts from.
//
// A 2+2 arterial with parallel bays down both kerbs. Cars arrive, peel out of the
// kerb lane into a bay, sit there, and later reverse out and drive on. What this
// map is for is the CYCLE: parking must be something traffic passes through, not
// a hole it drains into.
//
// Why parallel and not 90° bays: at the native 200px tile a 2+2 road puts its
// kerb 56px from the centreline, leaving 44px to the tile edge. A parallel bay is
// 26px deep and fits; a 90° bay is 48px and does not. That is the correct answer
// rather than a limitation — an American arterial with kerb parking IS 2+2 — and
// `validateParking` rejects the alternative rather than painting bays into the
// neighbour's garden.
//
// THREE bays per tile — the most a 60px parallel pitch fits on a 200px tile, so
// the rank runs the length of the kerb instead of leaving a third of it blank.
// Twelve spaces in all, which is few enough that the street can genuinely fill
// them: a car park that cannot fill never shows the behaviour the whole feature
// is about — a driver arriving to find it full and going somewhere else.
const bays = (from: Position, count = 3): ParkingRow => ({
  from,
  kind: "parallel",
  count,
});

// A two-way, two-lanes-each-way street running east-west.
const street = () => ({
  connections: [],
  road: nWayLanes(Position.Left, Position.Right, 2),
});

export const parkingkerb: TestScenario = {
  id: "parkingkerb",
  name: "Kerbside parking",
  description:
    "A 2+2 street with parallel bays down both kerbs. Cars pull in, stay a while, then reverse out and drive on — parking as a cycle, not a sink.",
  level: {
    "0,1": street(),
    // Bays on both kerbs. Each row is served by the approach whose RIGHT it lies
    // on: eastbound traffic (entering via Left) parks on the south kerb,
    // westbound (entering via Right) on the north — so both banks are reached
    // without anyone crossing oncoming traffic.
    "1,1": {
      ...street(),
      parking: {
        facility: "kerb",
        label: "Hauptstrasse",
        // A kerbside bay churns: short stays are what make a street look busy.
        dwellSec: [10, 22],
        rows: [bays(Position.Left), bays(Position.Right)],
      },
    },
    "2,1": {
      ...street(),
      parking: {
        facility: "kerb",
        rows: [bays(Position.Left), bays(Position.Right)],
      },
    },
    "3,1": street(),
    "4,1": street(),
  },
  trains: {},
  size: { cols: 5, rows: 3 },
  traffic: { spawnInterval: 1.1, maxCars: 10 },
};
