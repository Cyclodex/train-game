import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// A signalled block: a straight run with a signal at each block boundary. Watch
// the aspect flip Proceed/Stop as the train enters and clears, and use the manual
// hold (click a signal) to stop it. Signals are a per-port tool, so `signals:true`
// puts one on each exit port of the tile.
export const signals: TestScenario = {
  id: "signals",
  name: "Signals",
  description: "A signalled block — watch the aspects, or click to hold a train.",
  level: {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1, { signals: true }),
    "2,0": expandKind("straight", 1),
    "3,0": expandKind("straight", 1, { signals: true }),
    "4,0": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 0, "people", 3, "4,0"),
  },
};
