import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes, Lane } from "@/tiles/lanes";

// Multi-lane 4-way junctions WITH turns, at 2 and 3 lanes per direction. Unlike
// the straight-only roadcrossNlane crosses, here every lane of every approach may
// go straight OR turn left/right — the multi-lane generalisation of the 1-lane
// full cross. Cars spawn from all four edges, draw a random destination, and
// turn through the centre from whichever lane they are in.
//
// This is the regression stage for the multi-lane-junction authoring fix: the
// editor used to wire a turn drawn into a 2/3-lane junction onto lane 0 ONLY, so
// the inner lanes could not turn (their "lane connections" were missing). Toggle
// Debug to see the per-lane turn arrows — every lane now carries the full set.
const { Top, Right, Bottom, Left } = Position;
const ARMS: Position[] = [Top, Right, Bottom, Left];

// The centre of an N-lane all-turns cross: each approach has N lanes, and every
// lane permits the three non-straight-blocked moves (straight + both turns).
function allTurnsCentre(n: number): Lane[] {
  const out: Lane[] = [];
  for (const from of ARMS) {
    const exits = ARMS.filter(p => p !== from); // straight + left + right
    for (let i = 0; i < n; i++) out.push({ from, to: [...exits], index: i });
  }
  return out;
}

function crossTurnsLevel(n: number): Level {
  const h = (): Level[string] => ({ connections: [], road: nWayLanes(Left, Right, n) });
  const v = (): Level[string] => ({ connections: [], road: nWayLanes(Top, Bottom, n) });
  return {
    // Horizontal road (row y=2) and vertical road (column x=2).
    "0,2": h(), "1,2": h(), "3,2": h(), "4,2": h(),
    "2,0": v(), "2,1": v(), "2,3": v(), "2,4": v(),
    // Centre: N lanes per approach, every lane may turn.
    "2,2": { connections: [], road: allTurnsCentre(n) },
  };
}

function crossTurnsScenario(n: number): TestScenario {
  return {
    id: `crossturns${n}lane`,
    name: `Cross + turns: ${n} lanes per direction`,
    description:
      `A 4-way junction with ${n} lanes each way where every lane may go straight ` +
      `or turn. Cars enter from all edges and turn through the centre from any lane.`,
    level: crossTurnsLevel(n),
    trains: {},
    size: { cols: 5, rows: 5 },
    traffic: { spawnInterval: 0.6, maxCars: n * 5 + 4 },
  };
}

export const crossturns2lane = crossTurnsScenario(2);
export const crossturns3lane = crossTurnsScenario(3);
