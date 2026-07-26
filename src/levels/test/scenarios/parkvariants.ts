import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes, oneWay, twoWay } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";

// EVERY KIND OF PARKING, ON ONE PAGE — the gallery for the parking layer.
//
// The per-feature maps each prove one mechanic in isolation; this one exists to
// answer "what can this thing even do?" at a glance, and it is how the two kinds
// nobody could find got a home: ANGLED bays appeared in no level at all, and 90°
// bays existed only inside a car park, never beside a street.
//
// TWO STREETS, because the widths are not interchangeable:
//
//   y=1  a 1+1 street — carries the DEEP kinds. 90° and echelon need a car's
//        length of turn-in clearance (`bayNearPx`) plus their own depth, and at
//        the 200px tile that is 86px and 80px out from the centreline. Beside a
//        2+2 arterial the 90° rank lands at 104px and `validateParking` REJECTS
//        it — over the tile's own half-width. A narrow street is not a
//        simplification here, it is the only place they fit.
//
//   y=3  a 2+2 arterial — the wide-street case. Parallel bays only, which is the
//        documented cap: at 3+3 even those are rejected.
//
// Plus a one-way aisle (y=5) for the two things that are legal only where there
// is no oncoming stream: a rank on the FAR bank, and 90° bays on both banks.
//
// Deliberately NOT authored: a reserved (long/bus/delivery) 90°, echelon or
// garage bay. `needsBigBay` puts those at 110px deep and every context rejects
// them — big bays are a PARALLEL thing (a lay-by), which is what the lorry and
// bus rows below are.

const wide = () => ({ connections: [], road: nWayLanes(Position.Left, Position.Right, 2) });
const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });
const aisle = () => ({ connections: [], road: [oneWay(Position.Left, Position.Right)] });

const row = (r: ParkingRow): ParkingRow => r;

export const parkvariants: TestScenario = {
  id: "parkvariants",
  name: "Every parking variant",
  description:
    "The whole parking layer on one board: kerbside bays, echelon and 90° bays beside a street, a lorry lay-by and a bus lay-by, an in-lane bus halt, an underground garage with separate in and out ramps, and a one-way aisle with bays on both banks. The narrow street carries the deep kinds — a 90° rank does not fit beside the arterial and the validator says so.",
  level: {
    // Three INDEPENDENT streets running edge to edge. No corners joining them:
    // a turn tile is narrower than the road it meets, so the kerb TAPERS across
    // the tile beside it and `validateParking` rejects a row there — correctly,
    // since the bays would not line up with a kerb that is moving. Each street
    // takes its traffic from its own two map edges.

    // --- y=1: the NARROW street. The deep kinds live here. ------------------
    "0,1": street(),
    // ECHELON, both banks — the supermarket forecourt. Authored nowhere before.
    "1,1": {
      ...street(),
      parking: {
        facility: "angled",
        label: "Schrägparken",
        dwellSec: [8, 16],
        rows: [
          row({ from: Position.Left, kind: "angled", count: 6 }),
          row({ from: Position.Right, kind: "angled", count: 6 }),
        ],
      },
    },
    "2,1": street(),
    // 90° BESIDE A STREET — the other combination that existed nowhere. Only a
    // narrow street can carry it; see the header.
    "3,1": {
      ...street(),
      parking: {
        facility: "square",
        label: "Marktplatz",
        dwellSec: [10, 20],
        rows: [
          row({ from: Position.Left, kind: "perpendicular", count: 7 }),
          row({ from: Position.Right, kind: "perpendicular", count: 7 }),
        ],
      },
    },
    "4,1": street(),
    // The in-lane HALT: no bay at all, and the traffic queues behind the bus.
    "5,1": {
      ...street(),
      parking: {
        facility: "halt",
        label: "Haltestelle",
        dwellSec: [6, 12],
        rows: [row({ from: Position.Left, kind: "busstop", count: 1 })],
      },
    },
    "6,1": street(),
    // A lorry lay-by and a bus lay-by facing each other — the two big-bay
    // classes, and the only kinds `needsBigBay` will fit anywhere.
    "7,1": {
      ...street(),
      parking: {
        facility: "yard",
        label: "Lieferhof",
        dwellSec: [12, 24],
        rows: [
          row({ from: Position.Left, kind: "parallel", count: 1, reserved: "long" }),
          row({ from: Position.Right, kind: "parallel", count: 1, reserved: "bus" }),
        ],
      },
    },
    "8,1": street(),
    "9,1": street(),

    // --- y=3: the ARTERIAL. Parallel bays only — the documented cap. --------
    "0,3": wide(),
    "1,3": wide(),
    // Kerbside bays down both kerbs of the wide street.
    "2,3": {
      ...wide(),
      parking: {
        facility: "kerb",
        label: "Hauptstrasse",
        dwellSec: [8, 18],
        rows: [
          row({ from: Position.Left, kind: "parallel", count: 3 }),
          row({ from: Position.Right, kind: "parallel", count: 3 }),
        ],
      },
    },
    "3,3": wide(),
    // A DISABLED rank: painted, counted out of capacity, and never taken — which
    // is what stops a car park reading as 100% usable.
    "4,3": {
      ...wide(),
      parking: {
        facility: "disabled",
        label: "Behindertenplätze",
        dwellSec: [20, 40],
        rows: [row({ from: Position.Left, kind: "parallel", count: 3, reserved: "disabled" })],
      },
    },
    "5,3": wide(),
    // The GARAGE, with a separate OUT ramp on the far bank so departures do not
    // queue behind arrivals. Small on purpose: a facility that never fills never
    // shows a driver being turned away.
    "6,3": {
      ...wide(),
      parking: {
        facility: "garage",
        label: "Kaufhaus P",
        dwellSec: [18, 34],
        rows: [row({ from: Position.Left, kind: "garage", count: 5, exitTo: Position.Right })],
      },
    },
    "7,3": wide(),
    // A DELIVERY bay, and opposite it a kerb row held off the kerb by a verge
    // (`gap`) — the authored clearance that stays GREEN, unlike the paved aisle a
    // turning rank is given.
    "8,3": {
      ...wide(),
      parking: {
        facility: "delivery",
        label: "Lieferzone",
        dwellSec: [10, 20],
        rows: [
          row({ from: Position.Left, kind: "parallel", count: 1, reserved: "delivery" }),
          row({ from: Position.Right, kind: "parallel", count: 3, gap: 0.5 }),
        ],
      },
    },
    "9,3": wide(),

    // --- y=5: the ONE-WAY AISLE. The far-bank cases live here. --------------
    "0,5": aisle(),
    "1,5": {
      ...aisle(),
      parking: {
        facility: "lot",
        label: "Parkplatz",
        dwellSec: [10, 22],
        rows: [
          row({ from: Position.Left, kind: "perpendicular", count: 7 }),
          // FAR BANK. Legal only because a one-way aisle has no oncoming stream
          // to cross to reach it.
          row({ from: Position.Left, side: "left", kind: "perpendicular", count: 7 }),
        ],
      },
    },
    "2,5": aisle(),
    "3,5": {
      ...aisle(),
      parking: {
        facility: "lot",
        label: "Parkplatz",
        rows: [
          row({ from: Position.Left, kind: "angled", count: 6 }),
          row({ from: Position.Left, side: "left", kind: "angled", count: 6 }),
        ],
      },
    },
    "4,5": aisle(),
    // Parallel bays on an aisle, and a lone CENTRED one — `align` is otherwise
    // "pack", which is what makes a long row read as one continuous run instead
    // of a car-sized hole at every tile seam.
    "5,5": {
      ...aisle(),
      parking: {
        facility: "lot",
        label: "Parkplatz",
        rows: [row({ from: Position.Left, kind: "parallel", count: 3 })],
      },
    },
    "6,5": aisle(),
    "7,5": {
      ...aisle(),
      parking: {
        facility: "lot",
        label: "Parkplatz",
        rows: [row({ from: Position.Left, kind: "parallel", count: 1, align: "centre" })],
      },
    },
    "8,5": aisle(),
    "9,5": aisle(),
  },
  trains: {},
  size: { cols: 10, rows: 7 },
  // A mix heavy enough in lorries and coaches that the big bays get used, and a
  // density that fills the small facilities without jamming the narrow street.
  traffic: {
    mix: { car: 1, truck: 0.35, bus: 0.35 },
    spawnInterval: 0.7,
    maxCars: 22,
  },
};
