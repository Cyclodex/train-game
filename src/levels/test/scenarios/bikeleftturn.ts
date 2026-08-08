import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes, oneWayLanes, turns } from "@/tiles/lanes";

// A bike NEVER rides the inner lane — not even for a left turn. Eastbound
// traffic on this 2-lane street is forced left (north) at the T-junction, so
// the left-turn lane discipline sends every CAR to the inner lane on the
// approach; the bikes are exempt and take the turn from the kerb lane (the
// outermost lane that permits the move). Westbound traffic runs straight
// through the other way to keep the junction honest (streams that cross).

const { Left: L, Right: R, Top: T, Bottom: B } = Position;

const street = (): Level[string] => ({
  connections: [],
  road: nWayLanes(L, R, 2),
});

export const bikeleftturn: TestScenario = {
  id: "bikeleftturn",
  name: "Bikes hold the kerb at a left turn",
  description:
    "Eastbound traffic is forced to turn left at the T. Cars sort into the " +
    "inner lane on the approach (left-turn lane discipline); bikes are exempt " +
    "and stay on the kerb lane all the way through the turn — a bike never " +
    "rides an inner lane.",
  level: {
    "0,1": street(),
    "1,1": street(),
    // The T-junction: eastbound (from L) may only go north; westbound (from R)
    // runs straight through. Three road ports = a real junction, so the
    // turn-lane sorting (branch F) fires on the approach.
    "2,1": {
      connections: [],
      road: [turns(L, [T], 0), turns(L, [T], 1), turns(R, [L], 0), turns(R, [L], 1)],
    },
    // Westbound feed — one-way toward the junction, matching its R-port lanes.
    "3,1": { connections: [], road: oneWayLanes(R, L, 2) },
    // The northbound exit arm, off the top edge.
    "2,0": { connections: [], road: oneWayLanes(B, T, 2) },
  },
  trains: {},
  size: { cols: 4, rows: 3 },
  traffic: { spawnInterval: 0.9, maxCars: 10, overtakeFraction: 0.5, mix: { car: 1, bike: 0.6 } },
};
