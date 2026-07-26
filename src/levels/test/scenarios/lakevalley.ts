import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import { TerrainKind, TileCell } from "@/tiles/model";

// Lake Valley — our reconstruction of Train Valley's first level ("See").
//
// This is the reference board for the build-and-dispatch mode: the level we
// check every feature of that mode against. Design notes live in
// `docs/superpowers/specs/2026-07-25-train-valley-mode-design.md`.
//
// What the original level is, and what this reproduces:
//  - Three coloured stations (blue, red, yellow) with one line each.
//  - A LAKE in the middle of the map that the line has to go round. In the
//    original this is the whole puzzle — the long way round the water is what
//    you spend your money on. Here water is genuinely unbuildable
//    (`canBuildOn`), so the ring is the only shape the track could take.
//  - A junction at each station spur, so the player is flipping switches to
//    route a train the right way round the loop — the moment-to-moment verb.
//  - Rock, wood and town around the edges: rock is unbuildable like water,
//    wood and town are scenery you would clear.
//
// What is NOT here yet, and why:
//  - The original OPENS with a gap in the network and a budget, and the first
//    thing you do is buy the track that closes it. We ship the completed
//    topology instead, because our validator (rightly) rejects dangling track
//    and there is no in-play build tool yet — that is phase 0 + 2 of the design
//    doc. When those land, the starting state becomes "this board minus the
//    south side of the ring", and the level plays like the original.
//  - No money, no fares, no dispatch-on-click (phase 1).
//
// So: this verifies the WORLD half of the mode — terrain with rules, stations,
// a route that has to respect the ground — and stands ready for the economy.
// Ground-only cells. Each call returns a FRESH cell: sharing one object across
// tiles would make every lake tile the same reference, so a later edit to one
// would silently change the rest.
const ground = (terrain: TerrainKind) => (): TileCell => ({ connections: [], terrain });
const V = ground("water");
const F = ground("forest");
const R = ground("rock");
const U = ground("urban");

export const lakevalley: TestScenario = {
  id: "lakevalley",
  name: "Lake Valley",
  description:
    "Train Valley's first level, rebuilt: three stations, a ring of track round an unbuildable lake.",
  size: { cols: 9, rows: 7 },
  level: {
    // --- the line ----------------------------------------------------------
    // Blue station, west, on a spur into the ring.
    "0,2": expandKind("depot", 1),
    "1,2": expandKind("straight", 1),
    // Ring corner + spur junction. Trunk east-west, branch south.
    "2,2": expandKind("tjunction", 2),
    "3,2": expandKind("straight", 1),
    "4,2": expandKind("straight", 1, { signals: true }),
    "5,2": expandKind("straight", 1),
    // Ring corner + spur junction for the red station.
    "6,2": expandKind("tjunction", 2),
    "7,2": expandKind("straight", 1),
    "8,2": expandKind("depot", 3),
    // West side of the ring.
    "2,3": expandKind("straight"),
    "2,4": expandKind("straight"),
    // East side of the ring.
    "6,3": expandKind("straight"),
    "6,4": expandKind("straight"),
    // South-west corner, doubling as the yellow station's junction.
    "2,5": expandKind("tjunction", 1),
    "3,5": expandKind("straight", 1),
    "4,5": expandKind("straight", 1, { signals: true }),
    "5,5": expandKind("straight", 1),
    "6,5": expandKind("curve", 3),
    // Yellow station, south.
    "2,6": expandKind("depot"),

    // --- the ground --------------------------------------------------------
    // The lake, sitting exactly inside the ring: the reason the ring exists.
    "3,3": V(), "4,3": V(), "5,3": V(),
    "3,4": V(), "4,4": V(), "5,4": V(),
    // A second pond in the south, as in the original.
    "4,6": V(), "5,6": V(),
    // Rock: unbuildable, and it pins the ring's east side in place.
    "0,0": R(), "1,0": R(), "8,3": R(), "8,4": R(),
    // Woods around the rim.
    "2,0": F(), "3,0": F(), "6,0": F(), "7,0": F(), "8,0": F(),
    "0,4": F(), "0,5": F(), "1,5": F(), "0,6": F(),
    // The towns each station serves.
    "0,1": U(), "1,1": U(), "7,1": U(), "8,1": U(), "1,6": U(),
  },
  trains: {
    // One train per station, so all three junctions get used and the ring
    // carries traffic in both directions — which is what the two signals on the
    // long runs are there to keep honest.
    blue: mkTrain("blue", 0, 2, "people", 2, "8,2"),
    red: mkTrain("red", 8, 2, "fraight", 2, "2,6"),
    yellow: mkTrain("yellow", 2, 6, "people", 1, "0,2"),
  },
};
