import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkLineTrain } from "@/levels/test/scenario";

const town = (): TileCell => ({ connections: [], terrain: "urban" });
const stationEW = (name: string): TileCell => ({
  connections: [[Position.Left, Position.Right]],
  role: "station",
  stationName: name,
});
const stationNS = (name: string): TileCell => ({
  connections: [[Position.Top, Position.Bottom]],
  role: "station",
  stationName: name,
});

// CHANGING TRAINS: two lines that overlap at exactly one platform.
//
// The mechanic in isolation. Nordstadt and Weststadt are on the WEST line only,
// Südhafen on the EAST line only, so nobody can ride between them directly —
// they change at KREUZPLATZ, the one station both lines call at. Watch a dot
// leave one train there, wait on the platform, and leave again on the other.
//
// This is the shape phase 8 could not carry anyone across at all: boarding then
// asked only whether THIS line called at the passenger's destination, so a
// network of two lines moved fewer people than one enormous line would have.
//
// TWO DEPOTS, one at each side, and that is not decoration. A train can only
// reverse in a depot, so the direction it leaves its shed in is the direction it
// runs for ever. Both sheds are placed so the short way to the line's first stop
// sends its train CLOCKWISE round the ring — two trains sent opposite ways meet
// head-on on single track and the board deadlocks, which would demonstrate the
// interlocking rather than transfers.
export const transfer: TestScenario = {
  id: "transfer",
  name: "Changing trains",
  description:
    "Two lines, one interchange — a journey nobody can make without changing.",
  modeId: "network",
  level: {
    // --- the ring: clockwise (east along the top, west along the bottom) -----
    "1,1": expandKind("curve", 1), // ┌
    "2,1": stationEW("Nordstadt"),
    "3,1": expandKind("straight", 1),
    "4,1": stationEW("Kreuzplatz"), // THE INTERCHANGE — both lines call here
    "5,1": expandKind("curve", 2), // ┐

    "1,2": stationNS("Weststadt"),
    "5,2": expandKind("straight", 0),

    // The two depot spurs: a T each, so a train can pull out either way.
    "1,3": {
      connections: [
        [Position.Top, Position.Bottom],
        [Position.Left, Position.Top],
        [Position.Left, Position.Bottom],
      ],
    },
    "5,3": {
      connections: [
        [Position.Top, Position.Bottom],
        [Position.Right, Position.Top],
        [Position.Right, Position.Bottom],
      ],
    },

    "1,4": expandKind("curve", 0), // └
    "2,4": expandKind("straight", 1),
    "3,4": stationEW("Südhafen"),
    "4,4": expandKind("straight", 1),
    "5,4": expandKind("curve", 3), // ┘

    // --- the sheds ----------------------------------------------------------
    "0,3": expandKind("depot", 1),
    "6,3": expandKind("depot", 3),

    // --- the towns the passengers come from ---------------------------------
    "2,0": town(),
    "3,0": town(),
    "0,1": town(),
    "0,2": town(),
    "6,1": town(),
    "3,5": town(),
    "4,5": town(),
  },
  trains: {
    // WEST line. First stop Weststadt, one tile north of its shed, so it turns
    // north out of the depot and runs clockwise from there.
    west: mkLineTrain("west", 0, 3, "people", 3, ["1,2", "2,1", "4,1"]),
    // EAST line. First stop Südhafen, three tiles south-west of its shed, so it
    // turns south and runs clockwise too.
    east: mkLineTrain("east", 6, 3, "people", 3, ["3,4", "4,1"]),
  },
  colors: {
    depotColors: { "0,3": "blue", "6,3": "red" },
    trainColors: { west: "green", east: "yellow" },
  },
  size: { cols: 7, rows: 6 },
};
