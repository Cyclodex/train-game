import { TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Gradients in isolation: two identical lines over the same hill, raced by a
// light passenger shuttle and a heavy freight train. Watch the race — they
// leave together, and the freight visibly falls behind ON THE RAMPS while
// matching pace on the flats. That gap is `gradeSpeedFactor` (physics.ts):
// a climb caps the cruise speed by train weight, which is what finally makes
// weight a routing decision (the flat detour vs the short pass) rather than
// just an acceleration feel.
//
// The hill is height DATA, not terrain art: each cell carries `height` (absent
// = 0) and a joined boundary may climb at most ONE step — that one-step joint
// is the ramp, `validateLevel` flags anything steeper ("grade-step"). The
// climb chevrons on the ballast point uphill; descending earns no speed bonus
// (the brakes hold), so the profile reads left-to-right as: flat, two ramps
// up, a summit, two ramps down, flat.
const level: Record<string, TileCell> = {};

// The hill both lines cross: heights per column, one step per boundary.
const PROFILE = [0, 0, 1, 2, 2, 2, 1, 0, 0];
const ROWS = 5;

for (const row of [1, 3]) {
  for (let x = 0; x < PROFILE.length; x++) {
    const h = PROFILE[x];
    level[`${x},${row}`] = {
      ...expandKind("straight", 1),
      ...(h > 0 ? { height: h } : {}),
    };
  }
  level[`0,${row}`] = expandKind("depot", 1);
  level[`${PROFILE.length - 1},${row}`] = expandKind("depot", 3);
}

// The hill is a BODY, not two embankments: every row carries the column's
// height, so the terraces fuse into one broad ridge (hypsometric tinting,
// see tileHeightSvg) that both lines visibly climb over.
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < PROFILE.length; x++) {
    const h = PROFILE[x];
    if (h === 0 || level[`${x},${y}`]) continue;
    level[`${x},${y}`] = { connections: [], height: h };
  }
}

export const grades: TestScenario = {
  id: "grades",
  name: "Hill climb",
  description:
    "Two trains race the same hill: height is tile data, one step per boundary is a ramp, and a climb caps the cruise speed by train weight — the freight falls behind on the ramps and catches nothing back downhill.",
  size: { cols: 9, rows: 5 },
  level,
  trains: {
    train1: mkTrain("train1", 0, 1, "people", 1, "8,1"),
    train2: mkTrain("train2", 0, 3, "fraight", 4, "8,3"),
  },
};
