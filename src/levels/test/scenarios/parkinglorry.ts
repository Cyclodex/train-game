import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { twoWay } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";

// A BAY SERVES ONE CLASS OF VEHICLE — the thing this map exists to show.
//
// A car park is not a space that anything small enough may use. Sized purely by
// geometry a car takes the lorry bay it fits in with room to spare, a coach takes
// an ordinary kerb space (a bus is 55px, a parallel bay 60px), and an articulated
// lorry rolls down the ramp of an underground garage. All three measured true and
// all three are wrong, and nothing else in the sim can see it: the swept-body
// check only ever compares vehicles within 0.7 lanes of each other, and a bay is
// further off the carriageway than that by construction.
//
// So the street below has both kinds side by side and a mix of traffic to fill
// them: cars queue for the kerb spaces at the west end and cannot touch the lorry
// lay-by at the east end, lorries and coaches do exactly the reverse, and the
// articulated semis drive straight through — two boxes on a hinge do not park in
// a bay at all.

const carBays = (from: Position): ParkingRow => ({
  from,
  kind: "parallel",
  count: 3,
});

// A lorry bay is 110px long, so exactly ONE fits on a 200px tile. That is not a
// limitation to work around — it is what a lay-by looks like.
const lorryBay = (from: Position): ParkingRow => ({
  from,
  kind: "parallel",
  count: 1,
  reserved: "long",
});

const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });

export const parkinglorry: TestScenario = {
  id: "parkinglorry",
  name: "Lorry bays",
  description:
    "Kerb spaces at one end, a lorry lay-by at the other. Cars can only use the car bays and lorries and coaches only the long ones — a bay serves one class of vehicle, never anything that merely fits.",
  level: {
    "0,1": street(),
    // Car kerb spaces, south side. Lorries and coaches drive past these.
    "1,1": {
      ...street(),
      parking: {
        facility: "kerb",
        label: "Marktplatz",
        dwellSec: [9, 18],
        rows: [carBays(Position.Left)],
      },
    },
    "2,1": {
      ...street(),
      parking: { facility: "kerb", rows: [carBays(Position.Left)] },
    },
    "3,1": street(),
    // The lay-by, north side so it reads as a separate facility on its own kerb.
    // Cars cannot take these however empty they stand.
    "4,1": {
      ...street(),
      parking: {
        facility: "yard",
        label: "Lastwagen",
        dwellSec: [12, 24],
        rows: [lorryBay(Position.Right)],
      },
    },
    "5,1": {
      ...street(),
      parking: { facility: "yard", rows: [lorryBay(Position.Right)] },
    },
    "6,1": street(),
  },
  trains: {},
  size: { cols: 7, rows: 3 },
  // Heavy on the big vehicles, or the lay-by would stand empty for the whole run
  // and prove nothing. The semis are in deliberately: they never park anywhere.
  traffic: {
    mix: { car: 1, truck: 1, bus: 0.7, semi: 0.4 },
    spawnInterval: 0.9,
    maxCars: 12,
  },
};
