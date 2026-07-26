import { Level } from "@/tiles/model";
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

/** Fisher-Yates on a copy, driven by the supplied [0,1) source. */
function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Give each train a distinct home depot that is not the one it starts in, via
 * maximum bipartite matching (Kuhn's algorithm) over trains x depots.
 *
 * The greedy version this replaces assigned each train the first free non-start
 * depot, which cannot find a DERANGEMENT and so failed the most natural level
 * there is: n trains, each sitting in its own depot. Greedy hands depot B to the
 * train from A and depot A to the train from B, and the third train is left with
 * only its own start — so it falls back to sharing a depot, two trains end up the
 * same colour, and whichever arrives second can never be delivered because a
 * parked train occupies the tile forever.
 *
 * Matching backtracks instead: it will re-home an earlier train to free a depot
 * for a later one, and finds an assignment whenever one exists. Deterministic —
 * both loops run in a fixed order.
 *
 * Returns the home depot per train index, or undefined for trains that could not
 * be matched (fewer usable depots than trains).
 */
function matchHomeDepots(
  startIds: string[],
  depotIds: string[]
): (string | undefined)[] {
  const ownerOf = new Map<string, number>(); // depot id -> train index

  const augment = (ti: number, tried: Set<string>): boolean => {
    for (const depot of depotIds) {
      if (depot === startIds[ti] || tried.has(depot)) continue;
      tried.add(depot);
      const current = ownerOf.get(depot);
      // Free, or its current owner can be re-homed somewhere else.
      if (current === undefined || augment(current, tried)) {
        ownerOf.set(depot, ti);
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < startIds.length; i++) augment(i, new Set());

  const homes: (string | undefined)[] = new Array(startIds.length).fill(undefined);
  for (const [depot, ti] of ownerOf) homes[ti] = depot;
  return homes;
}

/**
 * Decide every depot and train colour so the level is always solvable.
 *
 * Two properties do the work, and BOTH are needed — either alone still starves a
 * train, because at runtime a train parks in whichever matching depot it reaches
 * first (the simulation matches on colour alone and is untouched by this):
 *
 *  1. Depot colours are DISTINCT while the palette lasts. Colouring each depot
 *     independently at random let two depots share a colour, so two trains could
 *     be sent to the same place however carefully they were assigned.
 *  2. Each train owns a DISTINCT non-start home depot, found by matching rather
 *     than greedily (see matchHomeDepots) — a parked train occupies its depot
 *     tile forever, so a shared home is a train that can never be delivered.
 *
 * `rand` is a [0,1) source; pass a seeded RNG (see `makeRng`) for deterministic,
 * unit-testable results.
 */
export function assignColors(
  level: Level,
  trains: TrainStart[],
  rand: () => number = Math.random
): ColorAssignment {
  const depotIds = Object.entries(level)
    .filter(([, tile]) => tile.role === "depot")
    .map(([id]) => id);

  // Distinct colours first, so no two depots compete for the same trains; only
  // once the palette runs out do depots start sharing.
  const palette = shuffled(Colors, rand);
  const depotColors: Record<string, string> = {};
  depotIds.forEach((id, i) => {
    depotColors[id] = i < palette.length ? palette[i] : pickRandom(Colors, rand);
  });

  const startIds = trains.map(t => `${t.x},${t.y}`);
  const homes = matchHomeDepots(startIds, depotIds);

  const trainColors: Record<string, string> = {};
  trains.forEach((train, i) => {
    // Matching covers every train whenever enough non-start depots exist. What
    // is left is genuinely over-subscribed (more trains than depots, or a lone
    // depot a train already sits in): share a non-start depot, then any depot,
    // and only a level with NO depots falls through to a bare random colour.
    const home =
      homes[i] ??
      depotIds.find(id => id !== startIds[i]) ??
      depotIds[0];
    trainColors[train.id] =
      home === undefined ? pickRandom(Colors, rand) : depotColors[home];
  });

  return { depotColors, trainColors };
}
