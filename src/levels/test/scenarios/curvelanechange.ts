import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// A car that is STILL CHANGING LANES when it reaches a bend. The mechanic here
// is not the bend and not the lane change — it is the seam between them: a
// vehicle mid-change sits at a FRACTIONAL lane (0.49 of the way across), and the
// curve has to place it at the matching fraction of the way between the two
// lanes it is straddling, on both of its seams and all the way round the arc.
//
// It is its own scenario because the other bends cannot show it: `roadcurveloops`
// and `roadcurvetraffic` have an approach only two tiles long, so a car has
// always settled into its lane before it reaches the corner and the fractional
// case is never driven. This one gives the approach SIX tiles and turns
// overtaking up, so there is always someone still sliding across when the road
// turns under them.
//
// The regression it guards (fixed 2026-08-05): the turn's exit-lane offset was
// picked with `Math.round(entryLane)`, i.e. a STEP function of the continuous
// lane position. The tick a car's fractional lane crossed .5 mid-curve, its whole
// exit offset flipped a lane and the drawn point snapped up to a third of a lane
// sideways with nothing in the simulation having moved. Watch the apex: a car
// easing between the two lanes must keep easing through the bend, never twitch.
// Pinned registry-wide by tests/unit/sim/laneContinuity.spec.ts.

const twoLane = (a: Position, b: Position): Level[string] => ({
  connections: [],
  road: nWayLanes(a, b, 2),
});

export const curvelanechange: TestScenario = {
  id: "curvelanechange",
  name: "Curve: mid-lane-change into a bend",
  description:
    "A long 2-lane-each-way approach into a 90° bend, with overtaking turned up so " +
    "cars are still sliding between lanes when the road turns. A car straddling two " +
    "lanes must glide through the curve, not snap sideways at the fraction it is on.",
  level: {
    "0,0": twoLane(Position.Left, Position.Right),
    "1,0": twoLane(Position.Left, Position.Right),
    "2,0": twoLane(Position.Left, Position.Right),
    "3,0": twoLane(Position.Left, Position.Right),
    "4,0": twoLane(Position.Left, Position.Right),
    "5,0": twoLane(Position.Left, Position.Right),
    "6,0": twoLane(Position.Left, Position.Bottom), // the bend
    "6,1": twoLane(Position.Top, Position.Bottom),
    "6,2": twoLane(Position.Top, Position.Bottom),
    "6,3": twoLane(Position.Top, Position.Bottom),
  },
  trains: {},
  size: { cols: 7, rows: 4 },
  traffic: { spawnInterval: 0.5, maxCars: 14, overtakeFraction: 0.8 },
};
