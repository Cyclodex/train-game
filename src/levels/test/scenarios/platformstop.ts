import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkLineTrain, railRing } from "@/levels/test/scenario";

const town = (): TileCell => ({ connections: [], terrain: "urban" });

// DRAWING UP AT THE PLATFORM: where a train stops, and why it is not where the
// loco is.
//
// A platform is ONE TILE long. A locomotive and two carriages are half a tile
// each, so the train is half again as long as the thing it stops at — no
// arrangement puts all three beside the slab. The sim therefore aligns the part
// that matters: the CARRIAGES are centred on the platform and the loco is drawn
// clear of the far end of it, exactly as a real train does at a platform too
// short for it (sim/simulation.ts → platformStopDistance). Stopping the loco on
// the platform instead — what this used to do — parked the one vehicle nobody
// boards beside the crowd and left both carriages out on the plain track behind.
//
// The ring is as tight as a ring gets (six tiles) so the stop comes round every
// few seconds and the train spends much of its life standing at the halt: open
// this one and you are looking at the mechanic, not waiting for it.
export const platformstop: TestScenario = {
  id: "platformstop",
  name: "Drawing up at the platform",
  description:
    "The carriages stop at the platform and the loco pulls past the end of it — a train is longer than its halt.",
  level: {
    ...railRing(1, 1, 3, 2),
    // The platform: the top side's one straight, with a curve either end, so
    // how much of the train is ON the slab is impossible to miss.
    "2,1": {
      connections: [[Position.Left, Position.Right]],
      role: "station",
      stationName: "Bahnsteig",
    },
    // The bottom side's straight is the T onto the depot spur.
    "2,2": {
      connections: [
        [Position.Left, Position.Right], // the ring
        [Position.Bottom, Position.Left], // out of the shed, westbound
        [Position.Bottom, Position.Right], // out of the shed, eastbound
      ],
    },
    "2,3": expandKind("depot", 0),
    // The town the passengers come from — a crowd on the platform is what makes
    // "which door did it stop at" a question with a visible answer.
    "1,0": town(),
    "2,0": town(),
    "3,0": town(),
  },
  trains: {
    // Two carriages: what actually fits a one-tile platform, and what a train
    // ordered into service is built with (game.ts → SERVICE_TRAIN_WAGONS).
    shuttle: mkLineTrain("shuttle", 2, 3, "people", 2, ["2,1"]),
  },
  colors: {
    depotColors: { "2,3": "blue" },
    trainColors: { shuttle: "green" },
  },
  size: { cols: 5, rows: 4 },
};
