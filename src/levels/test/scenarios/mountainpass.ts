import { TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// The capstone of the elevation work: every way over an obstacle, in one
// picture. A mountain range crosses the board; the northern line climbs a
// terraced grass SADDLE (heights + ramps + grade physics), the southern line
// bores straight THROUGH the range (tunnel). Both trains leave together:
//
//  - The shuttle takes the pass — chevrons up, over the h2 saddle, chevrons
//    down. Light, so the climb barely slows it.
//  - The freight takes the bore — level the whole way, vanishing at one portal
//    and re-emerging at the other, because the same climb would cost a heavy
//    train dearly (gradeSpeedFactor scales by weight).
//
// That pairing IS the design lesson the elevation features teach: height poses
// the question, and ramp / tunnel / (elsewhere) flyover are different answers
// with different prices. Terraces, portals, chevrons, the unbroken scatter
// over the bore and the grade cap are all visible on this one board.
const mountain = (): TileCell => ({ connections: [], terrain: "mountain" });

const level: Record<string, TileCell> = {};

// The range: two columns of mountain, rows 2..5 — the southern line will bore
// through it. North of it (rows 0..1) the range drops to a grass saddle.
for (let y = 2; y <= 5; y++) {
  level[`4,${y}`] = mountain();
  level[`5,${y}`] = mountain();
}

// The saddle: a terraced land bridge over the range's shoulder. Heights per
// column, one step per boundary; painted as a BODY (rows 0..1) so the
// terraces fuse into one shoulder rather than a lone embankment.
const SADDLE = [0, 0, 1, 2, 2, 2, 2, 1, 0, 0];
for (let y = 0; y <= 1; y++) {
  for (let x = 0; x < SADDLE.length; x++) {
    const h = SADDLE[x];
    if (h > 0) level[`${x},${y}`] = { connections: [], height: h };
  }
}

// The pass line: row 1, over the saddle.
for (let x = 0; x <= 9; x++) {
  const h = SADDLE[x];
  level[`${x},1`] = {
    ...expandKind("straight", 1),
    ...(h > 0 ? { height: h } : {}),
  };
}
level["0,1"] = expandKind("depot", 1);
level["9,1"] = expandKind("depot", 3);

// The bore line: row 4, straight through the range.
for (let x = 0; x <= 9; x++) level[`${x},4`] = expandKind("straight", 1);
for (const x of [4, 5]) {
  level[`${x},4`] = {
    ...expandKind("straight", 1),
    terrain: "mountain",
    tunnel: true,
  };
}
level["0,4"] = expandKind("depot", 1);
level["9,4"] = expandKind("depot", 3);

export const mountainpass: TestScenario = {
  id: "mountainpass",
  name: "Mountain pass",
  description:
    "Two answers to one range: the light shuttle climbs the terraced saddle (ramps slow it a little), the heavy freight bores flat through the tunnel (a climb would cost it dearly). Height poses the question; ramp and tunnel are different answers with different prices.",
  size: { cols: 10, rows: 6 },
  level,
  trains: {
    train1: mkTrain("train1", 0, 1, "people", 1, "9,1"),
    train2: mkTrain("train2", 0, 4, "fraight", 4, "9,4"),
  },
};
