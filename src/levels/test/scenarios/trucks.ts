import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";

// Cargo trucks: the three road-vehicle kinds — a car, a longer rigid truck, and
// an articulated cab + trailer semi — sharing a road and a junction.
//
// A long horizontal road (row y=2, x=0..5) carries an eastbound stream that
// queues at a 4-way junction at (2,2), where a northbound stream (column x=2)
// crosses. The mix is weighted toward trucks and semis so all three lengths are
// visible at once: you can watch them pack bumper-to-bumper in the queue, the
// trailer of a semi bend through the curve of the junction, and — the point of
// the junction here — a trailer straddling the crossing tile keep the
// perpendicular car out until the whole rig is clear (full-body occupancy, not
// just the cab/tail). No rail, so the scenario has no trains.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: ports });

export const trucks: TestScenario = {
  id: "trucks",
  name: "Cargo trucks",
  description:
    "Cars, longer rigid trucks, and articulated cab + trailer semis queue on a road and take turns through a junction; a trailer blocks the crossing until it clears.",
  level: {
    // Horizontal road, west→east, with a long approach so a mixed queue forms.
    "0,2": road([Position.Left, Position.Right]),
    "1,2": road([Position.Left, Position.Right]),
    "3,2": road([Position.Left, Position.Right]),
    "4,2": road([Position.Left, Position.Right]),
    "5,2": road([Position.Left, Position.Right]),
    // Vertical road, north–south, crossing the horizontal one.
    "2,0": road([Position.Top, Position.Bottom]),
    "2,1": road([Position.Top, Position.Bottom]),
    "2,3": road([Position.Top, Position.Bottom]),
    "2,4": road([Position.Top, Position.Bottom]),
    // The junction: both roads pass straight through.
    "2,2": road([Position.Left, Position.Right], [Position.Top, Position.Bottom]),
  },
  trains: {},
  size: { cols: 6, rows: 5 },
  // Heavy on the big rigs so the longer kinds are the stars of this scenario, and
  // a brisk spawn so the eastbound approach stays queued.
  traffic: {
    mix: { car: 1, truck: 2, semi: 2 },
    spawnInterval: 1.2,
    maxCars: 10,
  },
};
