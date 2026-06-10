import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes } from "@/tiles/lanes";

// Closed road rings, one per lane width, side by side — a pure-geometry gallery
// for the curved road surface. Each ring is four 90° curve tiles joined corner
// to corner with no straights, so every edge of the loop is a bend. Drawing the
// same loop at 1, 2 and 3 lanes-per-direction makes the curve renderer's
// constant-width property easy to eyeball: the paved ribbon must hold its width
// all the way round each ring (no pinch at the apexes) and the loops must look
// like clean rounded rectangles at every width.
//
// 3 lanes each way (6 total = 6·0.14·200 = 168px) is the widest ring a 200px
// tile holds; 4 each way (224px) would spill past the tile edge, so 1–3 is the
// full set of widths that render cleanly.
//
// No traffic and no depots: the rings are closed (no open end to feed cars in),
// and the point of the scenario is to inspect the curve geometry, not movement.

// One closed ring of four curve tiles, `count` lanes per direction, with its
// top-left tile at (x0, y0). Corners (clockwise from top-left):
//   (x0,   y0  ) Right↔Bottom   (x0+1, y0  ) Left↔Bottom
//   (x0,   y0+1) Top↔Right      (x0+1, y0+1) Top↔Left
function loop(count: number, x0: number, y0: number): Level {
  return {
    [`${x0},${y0}`]: { connections: [], road: nWayLanes(Position.Right, Position.Bottom, count) },
    [`${x0 + 1},${y0}`]: { connections: [], road: nWayLanes(Position.Left, Position.Bottom, count) },
    [`${x0 + 1},${y0 + 1}`]: { connections: [], road: nWayLanes(Position.Top, Position.Left, count) },
    [`${x0},${y0 + 1}`]: { connections: [], road: nWayLanes(Position.Top, Position.Right, count) },
  };
}

export const roadcurveloops: TestScenario = {
  id: "roadcurveloops",
  name: "Curve loops (all lane widths)",
  description:
    "Closed road rings at 1, 2 and 3 lanes per direction — every edge is a 90° curve, so the paved ribbon must hold constant width all the way round with no apex pinch.",
  level: {
    ...loop(1, 0, 0), // 1-lane ring (2 lanes total)
    ...loop(2, 3, 0), // 2-lane ring (4 lanes total)
    ...loop(3, 6, 0), // 3-lane ring (6 lanes total) — the widest a tile holds
  },
  trains: {},
  size: { cols: 8, rows: 2 },
};
