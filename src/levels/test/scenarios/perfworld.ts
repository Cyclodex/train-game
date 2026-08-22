import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { twoWay, type Lane } from "@/tiles/lanes";

const { Top, Right, Bottom, Left } = Position;

// THE STRESS BOARD: demoworld's layout grammar scaled to 40x28 — four times the
// area — with eight depot spurs, a 6x4 street grid (24 road junctions), twenty
// level crossings and a car cap in the hundreds. It exists to answer one
// question: what does a big board with heavy traffic COST? Headless, the perf
// bench (tests/unit/perf/) drives `advance()` over it and times the tick; in a
// browser, /#/play?board=perfworld is the worst-case frame the renderer has to
// survive. It is still a valid, playable level (the registry test validates it
// like any other), because a stress board that cheats its own topology measures
// nothing real.
//
// Layout grammar (all demoworld's rules, none new):
//  - one continuous rail ring, spur junctions and crossings only on straights;
//  - streets meet each other at four-way junctions, meet the ring at crossings;
//  - depots hang off the ring on three-tile spurs (junction, link, depot).

const COLS = 40;
const ROWS = 28;

const RING_LEFT = 2;
const RING_RIGHT = 37;
const RING_TOP = 1;
const RING_BOTTOM = 26;

// Streets: six full-height verticals, four full-width avenues. None may sit on
// a ring corner column/row, a spur junction, or each other's coordinates.
const STREETS_X = [7, 12, 17, 22, 27, 32];
const AVENUES_Y = [6, 11, 16, 21];

// Depot spurs, two per side. Rotation grammar is demoworld's: a north spur
// branches south (jRot 2) to a depot opening Top (dRot 0); south branches north
// (jRot 0) to one opening Bottom (dRot 2); west branches east (jRot 1) to one
// opening Left (dRot 3); east branches west (jRot 3) to one opening Right
// (dRot 1).
const SPURS = [
  { junction: "4,1", jRot: 2, link: "4,2", lRot: 0, depot: "4,3", dRot: 0 },
  { junction: "24,1", jRot: 2, link: "24,2", lRot: 0, depot: "24,3", dRot: 0 },
  { junction: "9,26", jRot: 0, link: "9,25", lRot: 0, depot: "9,24", dRot: 2 },
  { junction: "29,26", jRot: 0, link: "29,25", lRot: 0, depot: "29,24", dRot: 2 },
  { junction: "2,4", jRot: 1, link: "3,4", lRot: 1, depot: "4,4", dRot: 3 },
  { junction: "2,23", jRot: 1, link: "3,23", lRot: 1, depot: "4,23", dRot: 3 },
  { junction: "37,8", jRot: 3, link: "36,8", lRot: 1, depot: "35,8", dRot: 1 },
  { junction: "37,19", jRot: 3, link: "36,19", lRot: 1, depot: "35,19", dRot: 1 },
] as const;

// Signals around the ring, spaced so several trains can share it. Only ever laid
// onto a plain straight — the guard below skips crossings, spurs and corners.
const SIGNALS_X = [6, 10, 14, 20, 26, 30, 34]; // for the top + bottom runs
const SIGNALS_Y = [5, 9, 14, 18, 23]; // for the left + right runs

// A real four-way road junction: every arm reaches every other arm.
function fourWayCross(): Lane[] {
  const arms = [Top, Right, Bottom, Left];
  return arms.map(from => ({ from, to: arms.filter(p => p !== from), index: 0 }));
}

// Exported so perfcity — the "everything" stress board — can overlay stations,
// towns, bus stops and parking onto the same skeleton instead of re-authoring
// it. Returns a FRESH level each call; callers may mutate their copy freely.
export function buildPerfworldBase(): Level {
  const level: Level = {};
  const spurCoords = new Set<string>(SPURS.map(s => s.junction));

  // --- Rail ring -------------------------------------------------------------
  level[`${RING_LEFT},${RING_TOP}`] = expandKind("curve", 1);
  level[`${RING_RIGHT},${RING_TOP}`] = expandKind("curve", 2);
  level[`${RING_RIGHT},${RING_BOTTOM}`] = expandKind("curve", 3);
  level[`${RING_LEFT},${RING_BOTTOM}`] = expandKind("curve", 0);

  for (let x = RING_LEFT + 1; x < RING_RIGHT; x++) {
    for (const y of [RING_TOP, RING_BOTTOM]) {
      const id = `${x},${y}`;
      if (spurCoords.has(id)) continue;
      level[id] = STREETS_X.includes(x)
        ? { ...expandKind("straight", 1), road: twoWay(Top, Bottom) } // crossing
        : expandKind("straight", 1);
    }
  }
  for (let y = RING_TOP + 1; y < RING_BOTTOM; y++) {
    for (const x of [RING_LEFT, RING_RIGHT]) {
      const id = `${x},${y}`;
      if (spurCoords.has(id)) continue;
      level[id] = AVENUES_Y.includes(y)
        ? { ...expandKind("straight", 0), road: twoWay(Left, Right) } // crossing
        : expandKind("straight", 0);
    }
  }

  // Signals, only onto plain straights (never a crossing, spur or depot).
  const signalAt = (id: string, ports: Position[]) => {
    const cell = level[id];
    if (cell && !cell.road && cell.role !== "depot") level[id] = { ...cell, signals: ports };
  };
  for (const x of SIGNALS_X) {
    signalAt(`${x},${RING_TOP}`, [Right, Left]);
    signalAt(`${x},${RING_BOTTOM}`, [Right, Left]);
  }
  for (const y of SIGNALS_Y) {
    signalAt(`${RING_LEFT},${y}`, [Top, Bottom]);
    signalAt(`${RING_RIGHT},${y}`, [Top, Bottom]);
  }

  // --- Depot spurs -----------------------------------------------------------
  for (const s of SPURS) {
    level[s.junction] = expandKind("tjunction", s.jRot);
    level[s.link] = expandKind("straight", s.lRot);
    level[s.depot] = expandKind("depot", s.dRot);
  }

  // --- Streets ---------------------------------------------------------------
  const roadCell = (id: string, lanes: Lane[]) => {
    if (level[id]) return; // rail already claimed it (crossings are authored above)
    level[id] = { connections: [], road: lanes };
  };
  for (const y of AVENUES_Y) {
    for (let x = 0; x < COLS; x++) {
      roadCell(`${x},${y}`, STREETS_X.includes(x) ? fourWayCross() : twoWay(Left, Right));
    }
  }
  for (const x of STREETS_X) {
    for (let y = 0; y < ROWS; y++) {
      roadCell(`${x},${y}`, twoWay(Top, Bottom));
    }
  }

  return level;
}

export const perfworld: TestScenario = {
  id: "perfworld",
  name: "Perf world (40x28 stress board)",
  description:
    "The performance stress board: a signalled rail ring with eight depot spurs over a 6x4 street grid — 24 road junctions, 20 level crossings, eight trains and a car cap in the hundreds. Drive it headless with the perf bench (tests/unit/perf/) or open it to feel the frame rate.",
  level: buildPerfworldBase(),
  trains: {
    // Long cross-board journeys, so every train spends the whole measurement
    // window on the move rather than parking early.
    train1: mkTrain("train1", 4, 3, "people", 3, "29,24"),
    train2: mkTrain("train2", 24, 3, "fraight", 4, "9,24"),
    train3: mkTrain("train3", 9, 24, "people", 2, "24,3"),
    train4: mkTrain("train4", 29, 24, "fraight", 3, "4,3"),
    train5: mkTrain("train5", 4, 4, "people", 3, "35,8"),
    train6: mkTrain("train6", 35, 8, "fraight", 2, "4,4"),
    train7: mkTrain("train7", 4, 23, "people", 2, "35,19"),
    train8: mkTrain("train8", 35, 19, "fraight", 3, "4,23"),
  },
  size: { cols: COLS, rows: ROWS },
  // Heavy but honest traffic: mostly cars with a working share of trucks and
  // semis, spawning fast enough to reach the cap inside a minute of sim time.
  traffic: {
    spawnInterval: 0.25,
    maxCars: 160,
    mix: { car: 10, truck: 2, semi: 1 },
  },
};
