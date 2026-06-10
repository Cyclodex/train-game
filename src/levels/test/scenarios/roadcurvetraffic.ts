import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// An L-shaped two-way road — a horizontal straight, a 90° bend, then a vertical
// straight — open at both far ends so cars spawn from each and meet head-on IN
// the curve. This is the isolation case for two-way flow through a bend: on a
// curve the oncoming car enters through the tile's EXIT port (an adjacent port),
// not the opposite one a straight uses, so the simulation must still recognise it
// as the oncoming lane and let the two streams slide past. The regression this
// guards: that detection used oppositePort(entry), missed the curve, and the two
// directions froze nose-to-nose in the bend (cars piled up, nothing moved).
//
// Watch the apex: cars from the left and from the bottom should glide past each
// other on their own sides of the dashed centre line, never stopping to face off.

export const roadcurvetraffic: TestScenario = {
  id: "roadcurvetraffic",
  name: "Curve: two-way traffic (head-on bend)",
  description:
    "An L-shaped two-way road open at both ends, so cars meet head-on in the 90° bend. They must pass on their own sides of the curve, not deadlock nose-to-nose at the apex.",
  level: {
    "0,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "1,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
    "2,0": { connections: [], road: nWayLanes(Position.Left, Position.Bottom, 2) }, // bend
    "2,1": { connections: [], road: nWayLanes(Position.Top, Position.Bottom, 2) },
    "2,2": { connections: [], road: nWayLanes(Position.Top, Position.Bottom, 2) },
  },
  trains: {},
  size: { cols: 3, rows: 3 },
  traffic: {
    spawnInterval: 0.5,
    maxCars: 12,
  },
};
