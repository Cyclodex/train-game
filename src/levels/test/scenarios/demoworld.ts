import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { twoWay, type Lane } from "@/tiles/lanes";

const { Top, Right, Bottom, Left } = Position;

// A full-size world: a rail ring with four depot spurs, laid over a street grid,
// meeting at eight level crossings. 20x14 tiles — roughly nine times the area of
// the old fixed board, which existed only because the views hardcoded 7x6.
//
// It is the demo for "worlds are as big as their content": nothing here is
// special-cased, it is just a level with more tiles in it. It also gives the
// camera something to be for — at the native 200px tile this is 4000x2800px, so
// it must be panned and zoomed rather than shrunk.
//
// Layout (x right, y down):
//
//        0    2         6   9    11   13        17   19
//   0    ·    ·         ·   ║    ·    ║         ·    ·      ║ = street
//   1    ·    ╔═════════╦═══X═════════X══════════╗ ·        ═ ║ = rail
//   2    ·    ║         ║   ║         ║          ║ ·        X = level crossing
//   4    ·    ╠══□      ║   ║         ║          ║ ·        □ = depot
//   6  ══X════╪═════════╪═══+═════════+══════════X════      + = road junction
//   8    ·    ║         ║   ║         ║       □══╣ ·
//   9  ══X════╪═════════╪═══+═════════+══════════X════
//  10    ·    ║         ║   ║    □    ║          ║ ·
//  12    ·    ╚═════════╩═══X════╩════X══════════╝ ·
//  13    ·    ·         ·   ║    ·    ║         ·    ·
//
// The rail ring is one continuous circuit, so a train can reach every depot from
// every other — which is what makes it playable in any mode rather than a
// diorama. The street grid is deliberately laid so each of its four lines meets
// the ring on a plain straight: a crossing may only sit where the rail runs
// straight through, never on a curve, junction or depot.

const RING_LEFT = 2;
const RING_RIGHT = 17;
const RING_TOP = 1;
const RING_BOTTOM = 12;

// Streets: two full-width avenues and two full-height ones. Their intersections
// with each other are road junctions; with the ring, level crossings.
const AVENUES_Y = [6, 9]; // horizontal streets, span the whole width
const STREETS_X = [9, 13]; // vertical streets, span the whole height

// Depot spurs hang off the ring: [junction on the ring, the straight, the depot].
// Each is placed on a stretch of ring the streets do not touch.
const SPURS = [
  // North side: branch south to a depot below the top rail.
  { junction: "6,1", jRot: 2, link: "6,2", lRot: 0, depot: "6,3", dRot: 0 },
  // South side: branch north.
  { junction: "11,12", jRot: 0, link: "11,11", lRot: 0, depot: "11,10", dRot: 2 },
  // West side: branch east. The depot sits east of its link, so it opens WEST.
  { junction: "2,4", jRot: 1, link: "3,4", lRot: 1, depot: "4,4", dRot: 3 },
  // East side: branch west. The depot sits west of its link, so it opens EAST.
  { junction: "17,8", jRot: 3, link: "16,8", lRot: 1, depot: "15,8", dRot: 1 },
] as const;

// A real four-way junction: every arm reaches every OTHER arm, so a car may turn
// left or right as well as go straight. Authoring only the opposite-port pairs
// (`twoWay(L,R) + twoWay(T,B)`) makes a crossroads that no one can turn at — and
// the registry's junction sync cannot rescue it, because it only re-distributes
// exits a lane already reaches. The sync then narrows these back to the movements
// each arm can actually receive.
function fourWayCross(): Lane[] {
  const arms = [Top, Right, Bottom, Left];
  return arms.map(from => ({ from, to: arms.filter(p => p !== from), index: 0 }));
}

function build(): Level {
  const level: Level = {};
  const spurCoords = new Set<string>(SPURS.map(s => s.junction));

  // --- Rail ring -------------------------------------------------------------
  // Corners. A curve at rotation r joins (Top,Right) rotated r quarter-turns:
  // 0 = Top-Right, 1 = Right-Bottom, 2 = Bottom-Left, 3 = Left-Top.
  level[`${RING_LEFT},${RING_TOP}`] = expandKind("curve", 1); // ┌ opens right + down
  level[`${RING_RIGHT},${RING_TOP}`] = expandKind("curve", 2); // ┐ opens left + down
  level[`${RING_RIGHT},${RING_BOTTOM}`] = expandKind("curve", 3); // ┘ opens left + up
  level[`${RING_LEFT},${RING_BOTTOM}`] = expandKind("curve", 0); // └ opens right + up

  // Horizontal runs (top and bottom edges of the ring).
  for (let x = RING_LEFT + 1; x < RING_RIGHT; x++) {
    for (const y of [RING_TOP, RING_BOTTOM]) {
      const id = `${x},${y}`;
      if (spurCoords.has(id)) continue; // a spur junction goes here instead
      const crossesStreet = STREETS_X.includes(x);
      level[id] = crossesStreet
        ? { ...expandKind("straight", 1), road: twoWay(Top, Bottom) } // level crossing
        : expandKind("straight", 1);
    }
  }

  // Vertical runs (left and right edges).
  for (let y = RING_TOP + 1; y < RING_BOTTOM; y++) {
    for (const x of [RING_LEFT, RING_RIGHT]) {
      const id = `${x},${y}`;
      if (spurCoords.has(id)) continue;
      const crossesAvenue = AVENUES_Y.includes(y);
      level[id] = crossesAvenue
        ? { ...expandKind("straight", 0), road: twoWay(Left, Right) } // level crossing
        : expandKind("straight", 0);
    }
  }

  // Signals around the ring. A train reserves the whole route to the NEXT signal,
  // so signal spacing is block length: with only one per side a single train locks
  // most of the circuit and holds the level crossings on it shut for as long as it
  // takes to get round. Two per side keeps the blocks short enough that three
  // trains share the ring and the crossings reopen between them.
  for (const [id, ports] of [
    [`${RING_LEFT + 3},${RING_TOP}`, [Right, Left]],
    [`${RING_RIGHT - 3},${RING_TOP}`, [Right, Left]],
    [`${RING_LEFT + 3},${RING_BOTTOM}`, [Right, Left]],
    [`${RING_RIGHT - 3},${RING_BOTTOM}`, [Right, Left]],
    [`${RING_LEFT},${RING_TOP + 3}`, [Top, Bottom]],
    [`${RING_LEFT},${RING_BOTTOM - 3}`, [Top, Bottom]],
    [`${RING_RIGHT},${RING_TOP + 3}`, [Top, Bottom]],
    [`${RING_RIGHT},${RING_BOTTOM - 3}`, [Top, Bottom]],
  ] as [string, Position[]][]) {
    const cell = level[id];
    // Only ever onto a plain straight: a signal on a crossing or a spur junction
    // would gate the wrong thing.
    if (cell && !cell.road && cell.role !== "depot") level[id] = { ...cell, signals: ports };
  }

  // --- Depot spurs -----------------------------------------------------------
  for (const s of SPURS) {
    level[s.junction] = expandKind("tjunction", s.jRot);
    level[s.link] = expandKind("straight", s.lRot);
    level[s.depot] = expandKind("depot", s.dRot);
  }

  // --- Streets ---------------------------------------------------------------
  // Laid last and only onto cells the rail has not claimed; the crossings above
  // already carry their road, so this never overwrites one.
  const cols = 20;
  const rows = 14;
  const roadCell = (id: string, lanes: ReturnType<typeof twoWay>) => {
    if (level[id]) return; // rail tile (crossing already authored, or ring/spur)
    level[id] = { connections: [], road: lanes };
  };
  for (const y of AVENUES_Y) {
    for (let x = 0; x < cols; x++) {
      const onStreet = STREETS_X.includes(x);
      roadCell(`${x},${y}`, onStreet ? fourWayCross() : twoWay(Left, Right));
    }
  }
  for (const x of STREETS_X) {
    for (let y = 0; y < rows; y++) {
      roadCell(`${x},${y}`, twoWay(Top, Bottom));
    }
  }

  return level;
}

export const demoworld: TestScenario = {
  id: "demoworld",
  name: "Demo world (rail ring + street grid)",
  description:
    "A full-size 20x14 world: a signalled rail ring with four depot spurs, a grid of streets carrying traffic, and eight level crossings where they meet. Drag to pan, scroll to zoom — at the native tile size this board is 4000x2800px, far past the old fixed 7x6 board.",
  level: build(),
  trains: {
    train1: mkTrain("train1", 6, 3, "people", 3, "11,10"),
    train2: mkTrain("train2", 15, 8, "fraight", 2, "4,4"),
    train3: mkTrain("train3", 4, 4, "people", 2, "15,8"),
  },
  size: { cols: 20, rows: 14 },
  traffic: { spawnInterval: 1.1, maxCars: 26 },
};
