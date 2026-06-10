import { TestScenario } from "@/levels/test/scenario";
import { generateLevel } from "@/tiles/generate";
import { trainsFromRoutes } from "@/levelStore";

// Fixed seed for the scenario so the validation test is deterministic across
// runs (never depends on today's date). This seed reliably produces a valid
// 7×6 board with three depot pairs via generateLevel's retry-guarded build.
const FIXED_SEED = 20260615;

const generated = generateLevel(FIXED_SEED, {
  width: 7,
  height: 6,
  depotPairs: 3,
});

// Derive trains from the generated routes using the same helper the editor uses
// (levelStore.trainsFromRoutes), giving alternating people/fraight + 2 wagons.
const trainsDef = trainsFromRoutes(generated.routes);

// Cast the TrainsDefinition from trainsFromRoutes to the shape TestScenario
// expects (TrainsDefinition === Record<string, TrainObject>). The generated
// trains carry routeDestinations from the routes, so scenarioRoutes() can
// derive the TrainRoute[] for the connectivity validation test.
export const daily: TestScenario = {
  id: "daily",
  name: "Daily Challenge (fixed seed)",
  description:
    "Date-seeded generated board in isolation: a valid 7×6 loop with three trains, " +
    "one per depot pair — demonstrates procgen without depending on today's date.",
  level: generated.level,
  trains: trainsDef,
};
