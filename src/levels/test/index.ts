import { TestScenario } from "@/levels/test/scenario";
import { straight } from "@/levels/test/scenarios/straight";
import { curve } from "@/levels/test/scenarios/curve";
import { depot } from "@/levels/test/scenarios/depot";
import { signals } from "@/levels/test/scenarios/signals";
import { junction } from "@/levels/test/scenarios/junction";
import { cross } from "@/levels/test/scenarios/cross";
import { crossing } from "@/levels/test/scenarios/crossing";
import { carqueue } from "@/levels/test/scenarios/carqueue";
import { roadcross } from "@/levels/test/scenarios/roadcross";
import { roadjunction } from "@/levels/test/scenarios/roadjunction";
import { roadpriority } from "@/levels/test/scenarios/roadpriority";
import { trucks } from "@/levels/test/scenarios/trucks";
import { keepcrossingclear } from "@/levels/test/scenarios/keepcrossingclear";

// The feature test world. One scenario per mechanic; add a new feature by
// dropping a file in `scenarios/` and appending it here. Order is the picker
// order, simplest first.
export const SCENARIOS: TestScenario[] = [
  straight,
  curve,
  depot,
  signals,
  junction,
  cross,
  crossing,
  carqueue,
  roadcross,
  roadjunction,
  roadpriority,
  trucks,
  keepcrossingclear,
];

export function scenarioById(id: string | undefined): TestScenario {
  return SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0];
}

export type { TestScenario } from "@/levels/test/scenario";
