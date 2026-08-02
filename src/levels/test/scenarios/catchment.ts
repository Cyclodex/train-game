import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkLineTrain, railRing } from "@/levels/test/scenario";

const town = (): TileCell => ({ connections: [], terrain: "urban" });

// TERRAIN SETS THE TIMETABLE: the same train calls at a TOWN station and at a
// lonely halt on the same lap, so the two platforms can be compared directly.
// The town platform fills fast and deep; the meadow halt sees a trickle.
// Toggle Debug to see each station's walking-catchment ring — the reach the
// rates are derived from (tiles/catchment.ts).
export const catchment: TestScenario = {
  id: "catchment",
  name: "Catchment from terrain",
  description:
    "One lap, two platforms: the town one fills fast, the lonely halt trickles. Debug shows the reach.",
  level: {
    ...railRing(1, 1, 5, 4),
    // The TOWN station, ringed with houses.
    "2,1": { connections: [[Position.Left, Position.Right]], role: "station" },
    "1,0": town(),
    "2,0": town(),
    "3,0": town(),
    "0,1": town(),
    "0,2": town(),
    // The LONELY halt, out in the meadow on the far side.
    "4,4": { connections: [[Position.Left, Position.Right]], role: "station" },
    // The one depot.
    "0,3": expandKind("depot", 1),
    "1,3": {
      connections: [
        [Position.Top, Position.Bottom],
        [Position.Left, Position.Top],
        [Position.Left, Position.Bottom],
      ],
    },
  },
  trains: {
    train1: mkLineTrain("train1", 0, 3, "people", 2, ["2,1", "4,4"]),
  },
  colors: {
    depotColors: { "0,3": "blue" },
    trainColors: { train1: "green" },
  },
  size: { cols: 6, rows: 5 },
};
