import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkLineTrain, railRing } from "@/levels/test/scenario";

const town = (): TileCell => ({ connections: [], terrain: "urban" });

// THE ARCHITECTURE, in isolation: what a platform LOOKS like, and why.
//
// Three stations on one ring, chosen so both things the building depends on are
// visible at once and can be compared without moving the camera:
//
//   "2,0"  town platform on LEFT-RIGHT track → Empfangsgebäude lying along the
//          top of the tile, canopy reaching over the waiting crowd
//   "7,1"  town platform on TOP-BOTTOM track → the same building a quarter turn
//          round onto the left strip, canopy still facing the rails
//   "4,5"  a halt in the meadow               → a shelter, because nobody lives
//          within walking reach (tiles/catchment.ts)
//
// The size is DERIVED, never authored: the only difference between the halt and
// the two stations is the houses painted round them. Paint town beside "4,5" in
// the editor and it grows a building on the next render. The ring is wider than
// the mechanic strictly needs because the walking catchment is 2 tiles in every
// direction — the halt has to sit in a 5x5 clear of every house on the board, or
// it quietly promotes itself and the scenario stops showing its own point.
//
// Each platform also carries its NAME on the plate mounted on the building's
// front, with a dot per line calling there — so this is the signage scenario
// too, not only the roofs.
export const stationhouse: TestScenario = {
  id: "stationhouse",
  name: "Station buildings",
  description:
    "Empfangsgebäude vs meadow halt: the town in walking reach decides, and the name plate rides on the roof.",
  level: {
    ...railRing(1, 0, 7, 5),
    // The TOWN station on the top side (left-right track).
    "2,0": {
      connections: [[Position.Left, Position.Right]],
      role: "station",
      stationName: "Nordstadt",
    },
    "2,1": town(),
    "3,1": town(),
    "2,2": town(),
    // The TOWN station on the right side (top-bottom track) — the same building
    // a quarter turn round, which is the case a one-orientation art would break.
    "7,1": {
      connections: [[Position.Top, Position.Bottom]],
      role: "station",
      stationName: "Osthafen",
    },
    "6,1": town(),
    "6,2": town(),
    "5,1": town(),
    // The lonely HALT on the bottom side: same track, no town, no building.
    "4,5": {
      connections: [[Position.Left, Position.Right]],
      role: "station",
      stationName: "Moorheide",
    },
    // The one depot, off the ring's left side.
    "0,4": expandKind("depot", 1),
    "1,4": {
      connections: [
        [Position.Top, Position.Bottom],
        [Position.Left, Position.Top],
        [Position.Left, Position.Bottom],
      ],
    },
  },
  trains: {
    train1: mkLineTrain("train1", 0, 4, "people", 2, ["2,0", "7,1", "4,5"]),
  },
  colors: {
    depotColors: { "0,4": "blue" },
    trainColors: { train1: "green" },
  },
  size: { cols: 8, rows: 6 },
};
