import { LevelDefinition } from "@/types";
import { Colors, pickRandom } from "@/utils/globalHelpers";

export interface ColorAssignment {
  depotColors: Record<string, string>;
  trainColors: Record<string, string>;
}

/** Only the fields colour assignment needs from a train definition. */
export interface TrainStart {
  id: string;
  x: number;
  y: number;
}

/**
 * Decide every depot and train colour so the level is always solvable.
 *
 * Depots are coloured randomly for visual variety. Each train is then given the
 * colour of a *reserved, distinct, non-start* home depot, so:
 *   - every train has at least one matching depot it can be delivered to, and
 *   - two same-coloured trains can't both be starved — each owns its own depot,
 *     which matters because a parked train occupies the depot tile.
 *
 * At runtime a train still parks in whichever matching depot it reaches first
 * (the simulation's matching logic is colour-only and untouched) — the
 * reservation only guarantees one exists.
 *
 * `rand` is a [0,1) source; pass a seeded RNG (see `makeRng`) for deterministic,
 * unit-testable results.
 */
export function assignColors(
  level: LevelDefinition,
  trains: TrainStart[],
  rand: () => number = Math.random
): ColorAssignment {
  const depotIds = Object.entries(level)
    .filter(([, tile]) => tile.component === "TileDepot")
    .map(([id]) => id);

  const depotColors: Record<string, string> = {};
  for (const id of depotIds) depotColors[id] = pickRandom(Colors, rand);

  const reserved = new Set<string>();
  const trainColors: Record<string, string> = {};

  for (const train of trains) {
    const startId = `${train.x},${train.y}`;
    // Prefer a distinct, non-start depot. Degrade gracefully when there aren't
    // enough depots: share a non-start one, then any unreserved, then any at
    // all. Only a level with zero depots falls through to a bare random colour.
    const home =
      depotIds.find(id => id !== startId && !reserved.has(id)) ??
      depotIds.find(id => id !== startId) ??
      depotIds.find(id => !reserved.has(id)) ??
      depotIds[0];

    if (home === undefined) {
      trainColors[train.id] = pickRandom(Colors, rand);
    } else {
      trainColors[train.id] = depotColors[home];
      reserved.add(home);
    }
  }

  return { depotColors, trainColors };
}
