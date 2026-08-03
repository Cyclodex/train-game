import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkLineTrain } from "@/levels/test/scenario";

const town = (): TileCell => ({ connections: [], terrain: "urban" });
const stationEW = (): TileCell => ({
  connections: [[Position.Left, Position.Right]],
  role: "station",
});
const stationNS = (): TileCell => ({
  connections: [[Position.Top, Position.Bottom]],
  role: "station",
});

// THE NETWORK MODE: a RING through four town stations, served by one train
// that drives itself.
//
// The shape is the point. There is exactly ONE depot, and it is not a
// destination — it is where the train was ordered from (Transport Fever's
// idea). The train leaves it once, joins the ring, and then runs the line for
// ever: no colour matching, no "everyone home", no second depot to aim at. A
// ring needs no turn-back at all, so the board is track, platforms and the
// towns that fill them.
//
// The line is authored here as a list of stops; the sim plans the route to each
// one in turn (sim/railRouter.ts), which is the same thing an "assign this
// train to this line" UI will do at run time.
//
// The towns are sized against ONE train, and the arithmetic that matters is
// not capacity — a 24-seat train clears any of these platforms in one call —
// but LAP TIME: a station is served once a lap, so its crowd peaks at roughly
// (arrival rate x lap time). A ring of four stops takes ~45s, so a station
// beside four town tiles peaks around eight or nine waiting. Ring the East
// station with six and it tops out at the overflow limit with no margin,
// which is how the first cut of this board was built.
export const networkmode: TestScenario = {
  id: "networkmode",
  name: "Network mode",
  description:
    "One train, one depot, a ring of four town stations — keep the platforms clear.",
  modeId: "network",
  level: {
    // --- the ring -----------------------------------------------------------
    "1,1": expandKind("curve", 1), // ┌
    "2,1": stationEW(), // North station
    "3,1": expandKind("straight", 1),
    "4,1": expandKind("curve", 2), // ┐

    "1,2": stationNS(), // West station
    "4,2": stationNS(), // East station

    // Where the depot spur meets the ring: a T, so a train can pull out of the
    // shed and turn either way onto the line.
    "1,3": {
      connections: [
        [Position.Top, Position.Bottom], // the ring, running north-south
        [Position.Left, Position.Top], // out of the shed, northbound
        [Position.Left, Position.Bottom], // out of the shed, southbound
      ],
    },
    "4,3": expandKind("straight", 0),

    "1,4": expandKind("curve", 0), // └
    "2,4": stationEW(), // South station
    "3,4": expandKind("straight", 1),
    "4,4": expandKind("curve", 3), // ┘

    // --- the depot: a spur off the ring, and the only one on the board ------
    "0,3": expandKind("depot", 1),

    // --- the towns the passengers come from ---------------------------------
    "2,0": town(),
    "3,0": town(),
    "0,1": town(),
    "0,2": town(),
    "5,2": town(),
    "2,5": town(),
    "3,5": town(),
  },
  trains: {
    // Ordered at the depot, then in service on the ring for ever.
    circle: mkLineTrain("circle", 0, 3, "people", 4, ["2,1", "4,2", "2,4", "1,2"]),
  },
  colors: {
    depotColors: { "0,3": "blue" },
    trainColors: { circle: "green" },
  },
  size: { cols: 6, rows: 6 },
};
