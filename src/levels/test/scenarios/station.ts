import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkLineTrain, railRing } from "@/levels/test/scenario";

// THE DWELL, in isolation: one train, one platform, running a ring for ever.
//
// A ring rather than a line from depot to depot, because the stop is a thing
// that happens over and over — watch it once and you have seen an event; watch
// a lap and you have seen the mechanic. It also gives the board the network
// shape: ONE depot, which is where the train came from and not somewhere it is
// trying to get back to.
export const station: TestScenario = {
  id: "station",
  name: "Station dwell",
  description:
    "Every lap the train calls at the platform: brake to a stand, wait, pull away.",
  level: {
    ...railRing(1, 0, 3, 2),
    // The platform, on the middle of the top side.
    "2,0": { connections: [[Position.Left, Position.Right]], role: "station" },
    // The depot and its spur onto the ring.
    "0,1": expandKind("depot", 1),
    "1,1": {
      connections: [
        [Position.Top, Position.Bottom], // the ring
        [Position.Left, Position.Top], // out of the shed, northbound
        [Position.Left, Position.Bottom], // out of the shed, southbound
      ],
    },
  },
  trains: {
    train1: mkLineTrain("train1", 0, 1, "people", 2, ["2,0"]),
  },
  colors: {
    depotColors: { "0,1": "blue" },
    trainColors: { train1: "green" },
  },
  size: { cols: 4, rows: 3 },
};
