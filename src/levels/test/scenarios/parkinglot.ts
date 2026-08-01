import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { oneWay, turns, twoWay } from "@/tiles/lanes";

// SURFACE CAR PARK + UNDERGROUND GARAGE — the two facility shapes, side by side,
// so a car has a real choice between them and can be watched making it.
//
// THE UNIFICATION THIS MAP EXISTS TO PROVE: a car park's aisles are ORDINARY
// one-way road lanes. There is no second graph and no second follower model — the
// router drives the rows of the car park with exactly the code that drives a
// street, and `parking` only ever adds the bays beside them. The lot below is
// built entirely out of `oneWay`, and the 90° bays on both banks are legal only
// because a one-way aisle has no oncoming stream to cross.
//
// The aisle is a LOOP: in off the street, along the rows, back out to the street.
// That is not decoration. There is no U-turn anywhere in the lane model, so a
// dead-ended aisle is a car trap — a driver who finds the car park full drives to
// the end and has nowhere to go. `validateParking` rejects a car park with no way
// back to the road network for exactly this reason.
//
// The garage is deliberately TINY — four slots. A facility that cannot fill never
// shows the behaviour the whole feature is about: a driver arriving to find it
// full and going somewhere else instead. The surface car park is full-size, so
// between them the map shows both a car park working and a car park turning
// people away.

const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });

// A rank of 90° bays along one bank of the aisle. SEVEN is what fits on a tile at
// a 28px pitch, and painting fewer does not read as a small car park — it reads as
// a car park someone forgot to finish, with two lonely bays and 140px of blank
// tarmac beside them. So the surface car park is full-size and looks it; the
// GARAGE across the street is the small facility (four slots), and it is the one
// that fills up and sends drivers elsewhere.
const rank = (side: "right" | "left") =>
  ({ from: Position.Left, side, kind: "perpendicular" as const, count: 7 });

// An aisle tile: a single eastbound lane with a rank of bays on each bank.
const aisle = () => ({
  connections: [],
  road: [oneWay(Position.Left, Position.Right)],
  parking: {
    facility: "lot",
    label: "Parkplatz Nord",
    // Short stays on purpose. This is a DEMO map, and the registry-wide sweep
    // watches it for 40 simulated seconds — a car park whose cars sit for half a
    // minute completes barely one park-and-leave cycle in that window, which
    // proves nothing about turnover. The city (`/test/parkcity`) uses realistic
    // dwells; this one is tuned to show the whole cycle quickly.
    dwellSec: [8, 18] as [number, number],
    rows: [rank("right"), rank("left")],
  },
});

// A tile that belongs to the car park but carries no bays — an entry ramp or a
// turning head. It joins the facility so the sim can tell when a car has driven
// the WHOLE car park without finding a space, which is what triggers the search
// for an alternative. Without these the car would look like it had left the car
// park the moment it left the last row of bays.
const aisleOnly = (road: ReturnType<typeof oneWay>[]) => ({
  connections: [],
  road,
  parking: { facility: "lot" },
});

export const parkinglot: TestScenario = {
  id: "parkinglot",
  name: "Car park & garage",
  description:
    "A one-way surface car park with 90° bays on both banks of its aisle, plus a department-store garage across the street. Cars pick one, park, and leave — and avoid whichever is full.",
  level: {
    // --- The street ---------------------------------------------------------
    "0,0": street(),
    // Turn-in to the car park.
    "1,0": {
      connections: [],
      road: [
        turns(Position.Left, [Position.Right, Position.Bottom]),
        turns(Position.Right, [Position.Left, Position.Bottom]),
      ],
    },
    "2,0": street(),
    // The department store: a ramp in the kerb leading to four underground slots.
    // The car vanishes into the building and reappears from the same ramp later —
    // capacity is a number, not geometry, because the slots are not on the map.
    "3,0": {
      ...street(),
      parking: {
        facility: "garage",
        label: "Kaufhaus P",
        // A garage holds its cars far longer than a kerb does. Authoring dwell per
        // FACILITY is what lets the two read differently at a glance: the street
        // churns while the garage sits.
        dwellSec: [16, 30],
        rows: [{ from: Position.Left, kind: "garage" as const, count: 4 }],
      },
    },
    // Way back out of the car park onto the street.
    "4,0": {
      connections: [],
      road: [
        turns(Position.Left, [Position.Right]),
        turns(Position.Right, [Position.Left]),
        turns(Position.Bottom, [Position.Left, Position.Right]),
      ],
    },
    "5,0": street(),

    // --- The car park -------------------------------------------------------
    "1,1": aisleOnly([oneWay(Position.Top, Position.Bottom)]), // ramp down
    "1,2": aisleOnly([oneWay(Position.Top, Position.Right)]), // into the rows
    "2,2": aisle(),
    "3,2": aisle(),
    "4,2": aisleOnly([oneWay(Position.Left, Position.Top)]), // turning head
    "4,1": aisleOnly([oneWay(Position.Bottom, Position.Top)]), // ramp back up
  },
  trains: {},
  size: { cols: 6, rows: 3 },
  traffic: { spawnInterval: 1.0, maxCars: 12 },
};
