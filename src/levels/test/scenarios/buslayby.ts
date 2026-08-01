import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { twoWay } from "@/tiles/lanes";

// ONE STRAIGHT, ONE LAY-BY. Nothing else.
//
// `busstops` shows the halt and the bay TOGETHER, because their difference is the
// point of that map. This one is for watching a single coach do the whole move —
// swing in off the taper, stand, and pull out forwards — with no second stop, no
// junction and no car park anywhere near it to explain away what you are seeing.
//
// Which is exactly what it was needed for: a bus was reported jumping backwards
// as it rejoined the road, and on a city map that is one vehicle among fifty. The
// sim tracks a car's NOSE (`headProgress`) while a manoeuvre curve carries its
// CENTRE, so every seam between the two moves the sprite half a body length —
// a fifth of a tile for a coach. Here it is the only thing on screen.

const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });

export const buslayby: TestScenario = {
  id: "buslayby",
  name: "Bus lay-by",
  description:
    "A single coach bay on an otherwise empty street. Watch one bus do the whole move: it swings out of the lane along the taper, stands while the traffic flows past, then noses back out forwards — never in reverse, and never jumping as it changes between the bay and the road.",
  level: {
    "0,1": street(),
    "1,1": street(),
    "2,1": {
      ...street(),
      parking: {
        facility: "layby",
        label: "Bucht",
        // A stop is a pause, not parking: short enough that the cycle repeats
        // several times in the time anyone watches.
        dwellSec: [6, 11],
        rows: [{ from: Position.Left, kind: "parallel", count: 1, reserved: "bus" }],
      },
    },
    "3,1": street(),
    "4,1": street(),
  },
  trains: {},
  size: { cols: 5, rows: 3 },
  // Buses-first, and few enough vehicles that the bay is the thing you look at.
  traffic: {
    mix: { car: 1, bus: 1.4 },
    spawnInterval: 1.1,
    maxCars: 7,
  },
};
