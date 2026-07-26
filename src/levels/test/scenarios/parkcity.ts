import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { twoWay, nWayLanes, oneWay, type Lane } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";

const { Top, Right, Bottom, Left } = Position;

// PARKSTADT — a small downtown where every kind of parking exists at once, so the
// whole feature can be watched working together rather than one mechanic at a
// time. The isolated demos are `/test/parkingkerb` and `/test/parkinglot`; this is
// the world they add up to.
//
// What is here, and why each earns its place:
//
//   • A 2+2 AVENUE with parallel bays down both kerbs — the wide American street
//     the feature started from. It caps at 2+2 at this tile size, and that is the
//     right answer: the kerb of a 3+3 boulevard leaves less room than a car is
//     wide, and `validateParking` says so rather than painting bays into the
//     neighbour's garden.
//   • A SURFACE CAR PARK behind the shops: a one-way aisle looping in off the
//     avenue and back out, 90° ranks down both banks. Its aisles are ordinary road
//     lanes — the router drives the rows with the same code that drives a street.
//   • The DEPARTMENT STORE'S UNDERGROUND GARAGE: six slots behind a ramp in the
//     kerb. Small on purpose, because a facility that cannot fill never shows the
//     behaviour that matters — a driver arriving to find it full and going
//     somewhere else. Watch the sign flip to VOLL and the traffic re-route.
//   • A LORRY LAY-BY, a DELIVERY bay and a BUS STOP — three big bays serving three
//     different kinds of traffic, and none of them interchangeable. Plus DISABLED
//     bays nothing may use: a car park is never 100% usable, and the permanently
//     empty spaces are what make it look like a real one.
//   • A rail line across the bottom with two depots, crossing both side streets —
//     so the parking traffic has to share the city with the trains.
//
// Layout (x right, y down):
//
//        0    3         6      9   12        15
//   0    ·    ║         ·      ·   ║         ·      ║ = side street
//   3   ═╪════╬═════════╬══════╬═══╬═════════╪═     ╬ = junction
//   4    ·    ║         ▼      ▲   ║  P  P   ·      ═ = the avenue (2+2)
//   5    ·    ║         ╚══▬▬══╝   ║         ·      ▬ = car-park aisle + ranks
//   7   ─┼────╫─────────────────────╫────────┼─     ─ = the back street
//  10   ═█════X═════════════════════X════════█═     X = level crossing, █ = depot
//  11    ·    ║                     ║        ·

const COLS = 16;
const ROWS = 12;

const AVENUE_Y = 3; // the 2+2 shopping street
const BACK_Y = 7; // a plain two-way back street
const SIDE_X = [3, 12]; // the two side streets, top to bottom
const RAIL_Y = 10;

// The car park's aisle: in at x=6, east along y=5, out at x=9.
const LOT_IN_X = 6;
const LOT_OUT_X = 9;
const LOT_AISLE_Y = 5;

// A real four-way junction: every arm reaches every OTHER arm. Authoring only the
// opposite-port pairs makes a crossroads nobody can turn at, and the registry's
// junction sync cannot rescue it — it only re-distributes exits a lane already
// reaches. (demoworld.ts learned this the hard way; the same rule applies here.)
function fourWayCross(): Lane[] {
  const arms = [Top, Right, Bottom, Left];
  return arms.map(from => ({ from, to: arms.filter(p => p !== from), index: 0 }));
}

// A T-junction on the avenue with one arm going south (into or out of the car park).
function teeSouth(): Lane[] {
  return [
    { from: Left, to: [Right, Bottom], index: 0 },
    { from: Left, to: [Right, Bottom], index: 1 },
    { from: Right, to: [Left, Bottom], index: 0 },
    { from: Right, to: [Left, Bottom], index: 1 },
    { from: Bottom, to: [Left, Right], index: 0 },
  ];
}

// Three ordinary spaces fit a tile. A reserved bay that needs a BIG one — a
// delivery lorry, a coach — takes most of the tile on its own, so it authors its
// own count rather than inheriting the car figure.
const kerbBays = (
  from: Position,
  reserved?: ParkingRow["reserved"],
  count = 3,
): ParkingRow => ({
  from,
  kind: "parallel",
  count,
  ...(reserved ? { reserved } : {}),
});

const rank = (side: "right" | "left"): ParkingRow => ({
  from: Left,
  side,
  kind: "perpendicular",
  count: 7,
});

function build(): Level {
  const level: Level = {};
  const put = (x: number, y: number, cell: Level[string]) => {
    level[`${x},${y}`] = cell;
  };

  // --- Rail: a line across the bottom, a depot at each end -------------------
  // Straight track only under a crossing: a crossing may never sit on a curve, a
  // junction or a depot.
  put(0, RAIL_Y, expandKind("depot", 1)); // opens east
  put(COLS - 1, RAIL_Y, expandKind("depot", 3)); // opens west
  for (let x = 1; x < COLS - 1; x++) {
    const crossing = SIDE_X.includes(x);
    put(x, RAIL_Y, {
      ...expandKind("straight", 1),
      ...(crossing ? { road: twoWay(Top, Bottom) } : {}),
    });
  }
  // One signal each side of the middle so both trains can share the line without
  // one of them locking every crossing on it for a whole lap.
  for (const x of [5, 10]) {
    const cell = level[`${x},${RAIL_Y}`];
    if (cell && !cell.road) level[`${x},${RAIL_Y}`] = { ...cell, signals: [Left, Right] };
  }

  // --- Streets ----------------------------------------------------------------
  // Laid onto cells the rail has not claimed; the crossings above already carry
  // their road, so this never overwrites one.
  const road = (x: number, y: number, lanes: Lane[]) => {
    if (level[`${x},${y}`]) return;
    put(x, y, { connections: [], road: lanes });
  };

  // The avenue: two lanes each way, the length of the city.
  for (let x = 0; x < COLS; x++) {
    if (SIDE_X.includes(x)) road(x, AVENUE_Y, fourWayCross());
    else if (x === LOT_IN_X || x === LOT_OUT_X) road(x, AVENUE_Y, teeSouth());
    else road(x, AVENUE_Y, nWayLanes(Left, Right, 2));
  }
  // The back street: one lane each way.
  for (let x = 0; x < COLS; x++) {
    road(x, BACK_Y, SIDE_X.includes(x) ? fourWayCross() : twoWay(Left, Right));
  }
  // A lorry lay-by behind the shops. A long bay is 110px, so exactly ONE fits per
  // tile — which is what a lay-by looks like. Cars cannot use these however empty
  // they stand, and lorries and coaches cannot use anything else on the map: a bay
  // serves one class of vehicle, never anything that merely fits inside it.
  for (const x of [6, 7]) {
    const cell = level[`${x},${BACK_Y}`];
    level[`${x},${BACK_Y}`] = {
      ...cell,
      parking: {
        facility: "lorry",
        label: "Lieferhof",
        dwellSec: [25, 50],
        rows: [{ from: Left, kind: "parallel", count: 1, reserved: "long" }],
      },
    };
  }
  // A BUS STOP on the far kerb of the back street, facing the lorry lay-by across
  // the road — two big bays side by side serving completely different traffic,
  // which is the point. Coaches only, and a halt is not parking: its dwell is
  // seconds, the passengers get on and the bus goes.
  for (const x of [9, 10]) {
    const cell = level[`${x},${BACK_Y}`];
    level[`${x},${BACK_Y}`] = {
      ...cell,
      parking: {
        facility: "busstop",
        label: "Haltestelle",
        dwellSec: [6, 12],
        rows: [{ from: Right, kind: "parallel", count: 1, reserved: "bus" }],
      },
    };
  }
  // The two side streets, top to bottom.
  for (const x of SIDE_X) {
    for (let y = 0; y < ROWS; y++) road(x, y, twoWay(Top, Bottom));
  }

  // --- Kerbside parking on the avenue ----------------------------------------
  // Both kerbs, west of the car park. Each row is served by the approach whose
  // RIGHT it lies on — eastbound traffic parks on the south kerb, westbound on the
  // north — so nobody crosses oncoming traffic to reach a space.
  for (const x of [1, 2, 4, 5]) {
    const cell = level[`${x},${AVENUE_Y}`];
    level[`${x},${AVENUE_Y}`] = {
      ...cell,
      parking: {
        facility: "kerb-west",
        label: "Hauptstrasse",
        // A kerbside space churns — that is what makes a street look alive next to
        // a garage whose cars sit for minutes.
        dwellSec: [12, 26],
        rows: [kerbBays(Left), kerbBays(Right)],
      },
    };
  }

  // --- The department store: garage + its reserved bays ----------------------
  // The ramp is on the eastbound kerb; the store's delivery bay and its disabled
  // bays are on the far kerb, where they stay empty (nothing issues a permit yet,
  // which is exactly why they read as the real thing).
  level[`13,${AVENUE_Y}`] = {
    ...level[`13,${AVENUE_Y}`],
    parking: {
      facility: "garage",
      label: "Kaufhaus",
      dwellSec: [40, 75],
      rows: [
        { from: Left, kind: "garage", count: 6 },
        kerbBays(Right, "disabled"),
      ],
    },
  };
  level[`14,${AVENUE_Y}`] = {
    ...level[`14,${AVENUE_Y}`],
    parking: {
      facility: "kerb-east",
      label: "Kaufhausstrasse",
      dwellSec: [14, 30],
      // The store's loading bay: one lorry's worth of kerb, and lorries ONLY — a
      // coach that would also fit is not making a delivery.
      rows: [kerbBays(Left, "delivery", 1), kerbBays(Right)],
    },
  };

  // --- The surface car park ---------------------------------------------------
  // In off the avenue at LOT_IN_X, east along the aisle, back out at LOT_OUT_X.
  // The loop is not decoration: there is no U-turn anywhere in the lane model, so
  // a dead-ended aisle would trap any driver who found the car park full.
  const lotOnly = (x: number, y: number, lanes: Lane[]) =>
    put(x, y, { connections: [], road: lanes, parking: { facility: "lot" } });

  lotOnly(LOT_IN_X, 4, [oneWay(Top, Bottom)]);
  lotOnly(LOT_IN_X, LOT_AISLE_Y, [oneWay(Top, Right)]);
  for (let x = LOT_IN_X + 1; x < LOT_OUT_X; x++) {
    put(x, LOT_AISLE_Y, {
      connections: [],
      road: [oneWay(Left, Right)],
      parking: {
        facility: "lot",
        label: "Parkhof",
        dwellSec: [18, 40],
        rows: [rank("right"), rank("left")],
      },
    });
  }
  lotOnly(LOT_OUT_X, LOT_AISLE_Y, [oneWay(Left, Top)]);
  lotOnly(LOT_OUT_X, 4, [oneWay(Bottom, Top)]);

  // --- Terrain: the city blocks the streets run between ----------------------
  // Cosmetic, but it is what turns a road diagram into a town. Painted only on
  // cells nothing is built on — terrain-only cells are legal and count toward the
  // world's extents like any other.
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (level[`${x},${y}`]) continue;
      // Built-up between the avenue and the back street; parkland at the fringes.
      const downtown = y > AVENUE_Y && y < BACK_Y;
      const outskirts = y > BACK_Y && y < RAIL_Y;
      put(x, y, { connections: [], terrain: downtown ? "urban" : outskirts ? "forest" : "grass" });
    }
  }

  return level;
}

export const parkcity: TestScenario = {
  id: "parkcity",
  name: "Parkstadt (the city)",
  description:
    "A downtown with every kind of parking at once: kerbside bays down a 2+2 avenue, a surface car park looping off it, a department store's underground garage, reserved delivery and disabled bays — and trains crossing the side streets below.",
  level: build(),
  trains: {
    cityA: mkTrain("cityA", 0, RAIL_Y, "people", 3, `${COLS - 1},${RAIL_Y}`),
    cityB: mkTrain("cityB", COLS - 1, RAIL_Y, "fraight", 2, `0,${RAIL_Y}`),
  },
  size: { cols: COLS, rows: ROWS },
  // A city carries more than cars. The lorries and coaches are what make the
  // lay-by mean anything; the semis never park at all and simply drive through.
  traffic: {
    mix: { car: 1, truck: 0.45, bus: 0.3, semi: 0.15 },
    spawnInterval: 0.8,
    maxCars: 34,
  },
};
