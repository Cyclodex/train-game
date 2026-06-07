import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { nWayLanes, type Lane, type LaneKind } from "@/tiles/lanes";

// A 5-tile straight road with 1 car lane + 1 bus lane per direction.
// Cars may only use car lanes (index 0); the bus lane (index 1, kind="bus") is
// off-limits to cars. In debug mode the bus lane renders with an amber arrow and
// the road surface gets a dark-gold tint.
function mixedLanes(count: number): Lane[] {
  const car = nWayLanes(Position.Left, Position.Right, count);
  const busKind: LaneKind = "bus";
  const bus: Lane[] = [
    { from: Position.Left, to: [Position.Right], index: count, kind: busKind },
    { from: Position.Right, to: [Position.Left], index: count, kind: busKind },
  ];
  return [...car, ...bus];
}

export const buslane: TestScenario = {
  id: "buslane",
  name: "Bus lane: 1 car + 1 bus lane",
  description:
    "A straight road with 1 regular car lane and 1 bus-only lane per direction. " +
    "Cars spawn on both ends but only occupy the car lane. Enable Debug to see the " +
    "amber bus-lane arrow and the dark tint on the bus-side of the road surface.",
  level: {
    "0,1": { connections: [], road: mixedLanes(1) },
    "1,1": { connections: [], road: mixedLanes(1) },
    "2,1": { connections: [], road: mixedLanes(1) },
    "3,1": { connections: [], road: mixedLanes(1) },
    "4,1": { connections: [], road: mixedLanes(1) },
  },
  trains: {},
  size: { cols: 5, rows: 3 },
};
