import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { Lane, nWayLanes, oneWay } from "@/tiles/lanes";
import { TestScenario } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// THE PAVEMENT FOLLOWS THE KERB — at every width, and round every bend.
//
// `citizenwalk` shows pavements doing their job (people walking on them); this
// board shows the GEOMETRY on its own, on the two roads that used to get it
// wrong. Two closed rings, side by side, each with pavements derived for free:
//
//  1. **Two lanes each way.** The one that broke. A curve carries no lanes on the
//     port opposite an arm, so measuring the road as
//     `laneCount(p) + laneCount(oppositePort p)` collapsed every bend to the
//     2-lane minimum and laid the band 28 units inside the real kerb — i.e. UNDER
//     the tarmac, which is painted over it. The pavement simply VANISHED for the
//     length of every corner, which is the gap this board exists to catch.
//  2. **A single-lane one-way street.** Drawn its true ONE lane wide since the
//     run-max kerb anchor, so its pavement has to hug a 7-unit half-width. A
//     min-2 floor left the band floating half a lane out with a strip of bare
//     ground showing between it and the kerb.
//
// What to watch: run your eye round each pale band. It must hold a constant
// distance off the tarmac the whole way — no break at a bend, no jog at a seam,
// no strip of ground opening up behind the kerb. Compare the two rings: the wide
// one's pavement stands further out than the narrow one's by exactly the extra
// tarmac, which is the property the fix restored.
//
// STATIC, like `/test/roadcurveloops`: both rings are closed, so nothing spawns
// and nothing moves. The subject is paint, and a board with no traffic on it is
// the clearest way to look at paint. The taper case (a road that CHANGES width
// mid-run, where the pavement has to taper with the tarmac) needs an open road
// and lives on `/test/lanedrop` and `/test/roadonewaylanes`.

// One closed ring with its corners at (x0, y0) and (x1, y1), `lanes(from, to)`
// supplying the road each tile carries. Every tile is authored in the CLOCKWISE
// sense (enter `from`, leave `to`) — irrelevant for a two-way road, and the whole
// difference between a circuit and four dead ends for a one-way one.
function ring(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lanes: (from: Position, to: Position) => Lane[],
): Level {
  const out: Level = {};
  for (let x = x0 + 1; x < x1; x++) {
    out[`${x},${y0}`] = { connections: [], road: lanes(Left, Right) }; // north side, eastbound
    out[`${x},${y1}`] = { connections: [], road: lanes(Right, Left) }; // south side, westbound
  }
  for (let y = y0 + 1; y < y1; y++) {
    out[`${x1},${y}`] = { connections: [], road: lanes(Top, Bottom) }; // east side, southbound
    out[`${x0},${y}`] = { connections: [], road: lanes(Bottom, Top) }; // west side, northbound
  }
  out[`${x0},${y0}`] = { connections: [], road: lanes(Bottom, Right) };
  out[`${x1},${y0}`] = { connections: [], road: lanes(Left, Bottom) };
  out[`${x1},${y1}`] = { connections: [], road: lanes(Top, Left) };
  out[`${x0},${y1}`] = { connections: [], road: lanes(Right, Top) };
  return out;
}

export const footwaywidth: TestScenario = {
  id: "footwaywidth",
  name: "Pavements: every width, every bend",
  description:
    "Two closed rings — two lanes each way, and a single-lane one-way — with the pavement holding its distance off the kerb all the way round both.",
  level: {
    // Two lanes each way: the ring whose bends used to lose their pavement.
    ...ring(0, 0, 3, 3, (a, b) => nWayLanes(a, b, 2)),
    // One lane, one way: the ring whose pavement used to float off the kerb.
    // Every tile carries the run in the same rotational sense, so it is a real
    // one-way circuit rather than four dead ends.
    ...ring(5, 0, 8, 3, (a, b) => [oneWay(a, b)]),
  },
  trains: {},
  size: { cols: 9, rows: 4 },
};
