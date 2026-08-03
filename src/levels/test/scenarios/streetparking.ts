import { Position } from "@/types";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import type { ParkingRow } from "@/tiles/parking";

const { Right, Left } = Position;

// MARKED BAYS vs THE WIDE STREET — the same parking, painted two ways.
//
// Two identical streets running east–west, three tiles of kerb parking on each,
// and exactly one difference between them: the lower one's rows carry
// `marking: "none"`.
//
//   TOP    — European: white boxes, one per space. You park IN a bay.
//   BOTTOM — American: the carriageway keeps every one of its own markings and
//            the parking edge has none. You just pull over.
//
// Everything else is the same object: same `parallel` kind, same 60px pitch,
// same manoeuvre, same occupancy. That is why this is a property of PAINT and
// not a new `StallKind` — an unmarked kerb and a marked one are the same
// parking, and a model that forked them would have to keep two of everything in
// step for ever.
//
// The apron and the outer kerb line stay on BOTH. That is what makes the
// unmarked run read as a street that is simply WIDER along here, rather than
// as cars abandoned on the grass — and it is exactly the look the American
// arterial has.
//
// What to watch:
//  1. Cars take spaces on both sides and sit in them. The lower street's cars
//     line up at the same pitch as the upper one's; nothing about the driving
//     changed.
//  2. **The hard limit.** Kerb parking caps at a 2+2 arterial: at 3+3 the kerb
//     sits 84px out and less than a car's width of tile is left, and
//     `validateParking` says so. There is no "just make the street wider".
//
// Design: docs/superpowers/specs/2026-08-04-workplace-parking-design.md

const rows = (marking?: "none"): ParkingRow[] => [
  {
    from: Left,
    side: "right",
    kind: "parallel",
    count: 3,
    align: "pack",
    ...(marking ? { marking } : {}),
  },
];

const street = (parking?: TileCell["parking"]): TileCell => ({
  connections: [],
  road: twoWay(Left, Right),
  terrain: "urban",
  ...(parking ? { parking } : {}),
});

const level: Record<string, TileCell> = {};

// Two independent straights, NOT a loop. A turn tile is narrower than the road
// it meets, so the kerb tapers across the tile beside it and `validateParking`
// rejects a row there — the same reason `/test/parkvariants` is three separate
// streets (KNOWHOW → PARKING).
const MARKED_Y = 2;
const PLAIN_Y = 5;
for (let x = 0; x <= 7; x++) {
  const marked = x >= 2 && x <= 4;
  level[`${x},${MARKED_Y}`] = street(
    marked
      ? { facility: "bays", label: "Bay parking", dwellSec: [25, 60], rows: rows() }
      : undefined,
  );
  level[`${x},${PLAIN_Y}`] = street(
    marked
      ? { facility: "street", label: "Street parking", dwellSec: [25, 60], rows: rows("none") }
      : undefined,
  );
}

// A little ground either side so the streets read as being in a town rather
// than floating on meadow, and so the aprons have a verge to end against.
for (const y of [MARKED_Y - 1, MARKED_Y + 1, PLAIN_Y - 1, PLAIN_Y + 1]) {
  for (let x = 0; x <= 7; x++) {
    if (level[`${x},${y}`]) continue;
    level[`${x},${y}`] = { connections: [], terrain: "urban" };
  }
}
export const streetparking: TestScenario = {
  id: "streetparking",
  name: "Marked bays vs wide street",
  description:
    "The same kerb parking painted two ways: white boxes, and the American street you simply pull over on.",
  level,
  trains: {},
  traffic: { maxCars: 10 },
  size: { cols: 8, rows: 7 },
};
