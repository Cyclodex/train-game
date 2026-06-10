import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, type LaneKind } from "@/tiles/lanes";

// A 5-tile straight road with 1 bus lane + 1 car lane per direction.
// The bus-only lane is on the KERB (index 0, the outer side); the car lane(s) sit
// inboard of it (indices 1..carCount), nearer the centre line. Cars may only use
// the car lanes; the kerb-side bus lane (kind="bus") is off-limits to cars. In
// debug mode the bus lane renders with an amber arrow and only the bus-lane strip
// of the road surface gets a dark-gold tint.
function mixedLanes(carCount: number): Lane[] {
  const busKind: LaneKind = "bus";
  const bus: Lane[] = [
    { from: Position.Left, to: [Position.Right], index: 0, kind: busKind },
    { from: Position.Right, to: [Position.Left], index: 0, kind: busKind },
  ];
  const car: Lane[] = Array.from({ length: carCount }, (_, i) => [
    { from: Position.Left, to: [Position.Right], index: i + 1 },
    { from: Position.Right, to: [Position.Left], index: i + 1 },
  ]).flat();
  return [...bus, ...car];
}

export const buslane: TestScenario = {
  id: "buslane",
  name: "Bus lane: kerb-side bus + 1 car lane",
  description:
    "A straight road with a kerb-side bus-only lane and 1 regular car lane per " +
    "direction. Cars spawn on both ends but only occupy the car lane (inboard); the " +
    "outer bus lane stays empty. Enable Debug to see the amber bus-lane arrow and " +
    "the dark-gold tint on just the bus-lane strip of the road surface.",
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
