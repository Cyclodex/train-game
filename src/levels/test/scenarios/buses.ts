import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, type LaneKind } from "@/tiles/lanes";

// A straight road with a kerb-side bus-only lane + 1 car lane per direction, run
// with a mixed car/bus traffic stream. This is the bus *vehicle* demo (its sibling
// `buslane` shows the lane geometry with cars only): buses are longer coaches with
// a row of side windows, and — the feature — they prefer the bus lane, so you see
// buses ride the outer (kerb) lane while cars hold the inner car lane. Cars are
// still barred from the bus lane; buses may use either but drift onto the bus lane.
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

export const buses: TestScenario = {
  id: "buses",
  name: "Buses: prefer the bus lane",
  description:
    "A straight road with a kerb-side bus-only lane and 1 car lane per direction, " +
    "with a mixed car + bus stream. Buses are longer coaches with side windows and " +
    "prefer the bus lane, so they ride the outer lane while cars keep to the inner " +
    "car lane. Enable Debug to see the amber bus-lane markings.",
  level: {
    "0,1": { connections: [], road: mixedLanes(1) },
    "1,1": { connections: [], road: mixedLanes(1) },
    "2,1": { connections: [], road: mixedLanes(1) },
    "3,1": { connections: [], road: mixedLanes(1) },
    "4,1": { connections: [], road: mixedLanes(1) },
    "5,1": { connections: [], road: mixedLanes(1) },
  },
  trains: {},
  size: { cols: 6, rows: 3 },
  // A brisk, bus-heavy mix so both vehicle classes are on the road at once and the
  // bus-lane preference is easy to watch.
  traffic: {
    mix: { car: 1, bus: 2 },
    spawnInterval: 1.0,
    maxCars: 10,
  },
};
