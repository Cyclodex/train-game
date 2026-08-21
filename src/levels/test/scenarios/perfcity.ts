import { Position } from "@/types";
import { Level, TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain, mkLineTrain } from "@/levels/test/scenario";
import { buildPerfworldBase } from "@/levels/test/scenarios/perfworld";
import type { ParkingRow } from "@/tiles/parking";

const { Left, Right } = Position;

// PERF CITY — the "everything" stress board. perfworld measures the raw
// traffic cost; this board layers EVERY system the game has onto the same
// 40x28 skeleton, so the perf harness can measure the whole game at once:
//
//  - trains: three passenger LINE trains circling six stations for ever, plus
//    four classic freight trains running depot to depot;
//  - citizens: three residential towns and one industry town — pedestrians on
//    the pavements, citizen cars on the roads, commutes by every mode;
//  - buses: two bus lines with kerbside halts, one along an avenue and one
//    down a street, each with its own bus in service;
//  - parking: a park & ride by the west station and a workplace car park in
//    the industry town;
//  - background traffic: cars, trucks, semis, buses, bikes and motorcycles;
//  - the skeleton's own 24 road junctions and 20 level crossings.
//
// /#/play?board=perfcity — and the headless case in tests/unit/perf/.

const STATIONS: { id: string; rot: number }[] = [
  { id: "8,1", rot: 1 }, // north ring, serves Nordstadt
  { id: "28,1", rot: 1 }, // north ring, serves the works
  { id: "15,26", rot: 1 }, // south ring, serves Suedstadt
  { id: "33,26", rot: 1 }, // south ring
  { id: "2,12", rot: 0 }, // west ring, the park & ride station
  { id: "37,13", rot: 0 }, // east ring, serves Oststadt
];

// Towns: contiguous plot blocks (empty cells only — streets and rails keep
// their tiles), far enough apart that the 8-neighbour clustering keeps them
// separate places. Homes in three towns, every job in the fourth: the commute
// crosses the board, which is the load being measured.
const TOWNS: { city: string; kind: "urban" | "industry"; x0: number; y0: number; x1: number; y1: number }[] = [
  { city: "nordstadt", kind: "urban", x0: 6, y0: 2, x1: 11, y1: 5 },
  { city: "oststadt", kind: "urban", x0: 33, y0: 12, x1: 36, y1: 15 },
  { city: "suedstadt", kind: "urban", x0: 13, y0: 22, x1: 18, y1: 25 },
  { city: "werkstadt", kind: "industry", x0: 25, y0: 2, x1: 31, y1: 5 },
];

const halt = (from: Position): ParkingRow => ({ from, kind: "busstop", count: 1 });
const bays = (from: Position): ParkingRow => ({ from, kind: "parallel", count: 3 });

// Bus halts, each beside a town so the stop has a catchment. Line 1 runs the
// y=6 avenue (Nordstadt to the works), line 2 the x=12 street (north to
// Suedstadt).
const BUS_LINE_1 = ["9,6", "15,6", "25,6", "30,6"];
const BUS_LINE_2 = ["12,5", "12,9", "12,14", "12,19", "12,24"];

function addParking(level: Level, tileId: string, parking: TileCell["parking"]): void {
  const cell = level[tileId];
  if (!cell || !cell.road) throw new Error(`perfcity: no road tile at ${tileId} for parking`);
  level[tileId] = { ...cell, parking };
}

function build(): Level {
  const level = buildPerfworldBase();

  // Stations onto the ring's plain straights.
  for (const s of STATIONS) {
    level[s.id] = expandKind("station", s.rot);
  }

  // Towns: plots only onto EMPTY cells; the street running through a town
  // stays a street.
  for (const t of TOWNS) {
    for (let y = t.y0; y <= t.y1; y++) {
      for (let x = t.x0; x <= t.x1; x++) {
        const id = `${x},${y}`;
        if (level[id]) continue;
        level[id] = { connections: [], terrain: t.kind, city: t.city };
      }
    }
  }

  // Bus halts along the two lines.
  for (const id of BUS_LINE_1) {
    addParking(level, id, { facility: `halt-${id}`, dwellSec: [7, 14], rows: [halt(Left)] });
  }
  for (const id of BUS_LINE_2) {
    addParking(level, id, { facility: `halt-${id}`, dwellSec: [7, 14], rows: [halt(Position.Top)] });
  }

  // Park & ride by the west station (2,12): kerbside bays on the y=11 avenue.
  addParking(level, "3,11", {
    facility: "pr-west",
    label: "P+R West",
    dwellSec: [20, 45],
    rows: [bays(Left), bays(Right)],
  });
  addParking(level, "4,11", { facility: "pr-west", rows: [bays(Left), bays(Right)] });

  // Workplace car park in the industry town.
  addParking(level, "28,6", {
    facility: "werk-p",
    label: "Werk P",
    dwellSec: [30, 60],
    rows: [bays(Left), bays(Right)],
  });
  addParking(level, "29,6", { facility: "werk-p", rows: [bays(Left), bays(Right)] });

  return level;
}

export const perfcity: TestScenario = {
  id: "perfcity",
  name: "Perf city (everything at once)",
  description:
    "The everything stress board: perfworld's 40x28 skeleton plus six stations with three passenger lines, four freight trains, four citizen towns (pedestrians and commuter cars), two bus lines, park & ride, a works car park, and background traffic of every vehicle kind.",
  modeId: "citizens",
  level: build(),
  trains: {
    // Passenger LINE trains: circle their stops for ever (endless service).
    lineA: mkLineTrain("lineA", 4, 3, "people", 3, ["8,1", "37,13", "15,26"]),
    lineB: mkLineTrain("lineB", 29, 24, "people", 3, ["33,26", "2,12", "28,1"]),
    lineC: mkLineTrain("lineC", 35, 8, "people", 2, ["28,1", "15,26"]),
    // Classic freight, depot to depot across the board.
    fr1: mkTrain("fr1", 24, 3, "fraight", 4, "9,24"),
    fr2: mkTrain("fr2", 9, 24, "fraight", 3, "24,3"),
    fr3: mkTrain("fr3", 4, 23, "fraight", 3, "35,19"),
    fr4: mkTrain("fr4", 35, 19, "fraight", 2, "4,23"),
  },
  busLines: [BUS_LINE_1, BUS_LINE_2],
  size: { cols: 40, rows: 28 },
  // Every vehicle kind on the road at once.
  traffic: {
    spawnInterval: 0.3,
    maxCars: 140,
    mix: { car: 10, truck: 2, semi: 1, bus: 1, bike: 1, motorcycle: 1 },
  },
};
