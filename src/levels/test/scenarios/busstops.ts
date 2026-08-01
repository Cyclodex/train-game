import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { twoWay } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";

// THE TWO KINDS OF BUS STOP, on one street so the difference is watchable.
//
// A HALT (west end) is a length of kerb the bus stops AGAINST, in lane. It never
// leaves the carriageway, so everything behind it queues until it pulls away.
//
// A LAY-BY (east end) is a bay cut into the kerb: the bus swings out of the lane,
// stands there, and the traffic behind it flows straight past. That is the whole
// reason a town builds one, and it is why the two cannot be one setting with a
// flag — the same street furniture doing the opposite thing to the flow.
//
// The HALT IS UPSTREAM ON PURPOSE. A queue backs up BEHIND the thing causing it,
// so with the halt first its queue runs west, away from the bay, and the stretch
// in front of the bay stays clear. The other way round, the halt's queue reaches
// back past the lay-by and anything measuring "is traffic stopped near the bay?"
// reads the halt's jam and blames the bay.
//
// Mechanically the difference is one property (`stallOnLane`) and it inverts the
// rule the rest of parking is built on: a parked vehicle reports NO road body, so
// it gates nobody. A halted bus keeps its body. Everything else — claiming the
// stop, the dwell, releasing it, the sign — is shared.
//
// Both are BUS ONLY. A car cannot use either however empty they stand, and a
// lorry cannot either: a stop is not a lay-by.

const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });

// The bay: a big parallel bay, bus-reserved. One fits per tile, which is one
// coach's worth of kerb — what a lay-by actually is.
const layBy = (from: Position): ParkingRow => ({
  from,
  kind: "parallel",
  count: 1,
  reserved: "bus",
});

// The halt: no bay at all, just the stretch of kerb the bus stands against.
const halt = (from: Position): ParkingRow => ({
  from,
  kind: "busstop",
  count: 1,
});

export const busstops: TestScenario = {
  id: "busstops",
  name: "Bus stops",
  description:
    "The two kinds of stop on one street: a halt in the running lane where everything behind it has to wait, and further on a lay-by the bus pulls into so the traffic flows straight past. Both bus-only. Watch the queue build behind the halt and never behind the bay.",
  level: {
    "0,1": street(),
    // --- The HALT. Traffic queues behind a bus standing here. -----------------
    "1,1": {
      ...street(),
      parking: {
        facility: "halt",
        label: "Haltestelle",
        // A stop is a pause, not parking: passengers board and the bus goes.
        dwellSec: [7, 14],
        rows: [halt(Position.Left)],
      },
    },
    "2,1": street(),
    "3,1": street(),
    // --- The LAY-BY. Traffic passes a bus standing here. ----------------------
    "4,1": {
      ...street(),
      parking: {
        facility: "laybay",
        label: "Bucht",
        dwellSec: [7, 14],
        rows: [layBy(Position.Left)],
      },
    },
    "5,1": street(),
    "6,1": street(),
  },
  trains: {},
  size: { cols: 7, rows: 3 },
  // Heavy on buses so both stops are busy, and enough cars behind them that the
  // queue at the halt is unmistakable.
  traffic: {
    mix: { car: 1, bus: 1.1 },
    spawnInterval: 0.8,
    maxCars: 12,
  },
};
