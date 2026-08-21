import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { Lane } from "@/tiles/lanes";

// The WIDE single-lane street: each direction is one car lane plus an unmarked
// SHOULDER at the kerb (kind "shoulder") — no green paint, no edge line, just
// visibly wider asphalt. Bikes ride the edge zone (the same quarter-lane
// kerbward ride line a cycle lane uses, minus the paint) and cars pass
// alongside in their own lane — no lane change, no queueing. Compare
// /test/bikemix (narrow street: cars queue behind the bike) and /test/cyclelane
// (the painted remedy).

const { Left: L, Right: R } = Position;

const wide = (): Level[string] => ({
  connections: [],
  road: [
    { from: L, to: [R], index: 0, kind: "shoulder" },
    { from: L, to: [R], index: 1 },
    { from: R, to: [L], index: 0, kind: "shoulder" },
    { from: R, to: [L], index: 1 },
  ] as Lane[],
});

export const widestreet: TestScenario = {
  id: "widestreet",
  name: "Wide street (bikes at the edge)",
  description:
    "A wide single-lane street: an unmarked edge zone at each kerb — no green " +
    "paint, no edge line, just wider asphalt. Bikes ride the edge; cars pass " +
    "alongside in their own lane, without a lane change and without queueing.",
  level: {
    "0,1": wide(),
    "1,1": wide(),
    "2,1": wide(),
    "3,1": wide(),
    "4,1": wide(),
    "5,1": wide(),
  },
  trains: {},
  size: { cols: 6, rows: 3 },
  traffic: { spawnInterval: 0.9, maxCars: 10, mix: { car: 1, bike: 0.6 } },
};
