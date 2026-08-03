import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkLineTrain, railRing } from "@/levels/test/scenario";

// BOARDING AND RIDING: two platforms on a ring, and one train working them
// both for ever. Passengers gather (the default demand schedule), the train
// takes as many as it has seats for, carries them one hop, and lets them off
// at the next call — watch the crowds drain and the log count "(n on, m off)".
//
// The ring is what makes it watchable: a shuttle from depot to depot shows the
// exchange once, a ring shows it every lap, in both directions of the flow.
export const boarding: TestScenario = {
  id: "boarding",
  name: "Boarding & riding",
  description:
    "Two platforms, one train: crowds build, board, ride a hop, and get off.",
  level: {
    ...railRing(1, 0, 4, 3),
    // A platform on the top side and another on the bottom, so the ride
    // between them is a real hop rather than a shunt.
    "2,0": { connections: [[Position.Left, Position.Right]], role: "station" },
    "3,3": { connections: [[Position.Left, Position.Right]], role: "station" },
    // The one depot, on a spur.
    "0,2": expandKind("depot", 1),
    "1,2": {
      connections: [
        [Position.Top, Position.Bottom],
        [Position.Left, Position.Top],
        [Position.Left, Position.Bottom],
      ],
    },
  },
  trains: {
    train1: mkLineTrain("train1", 0, 2, "people", 2, ["2,0", "3,3"]),
  },
  colors: {
    depotColors: { "0,2": "blue" },
    trainColors: { train1: "green" },
  },
  size: { cols: 5, rows: 4 },
};
