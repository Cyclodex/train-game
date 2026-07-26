import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// A line CLEARED through terrain — the right-of-way rules in isolation:
//  1. **Scatter keeps off the line.** The straights at 1,1..4,1 carry forest and
//     town, but no trunk, house, paving or garden stands on the corridor: the
//     wood thins and the town steps back where the railway runs.
//  2. **Canopies overhang, trains pass under.** A forest tree may stand just OFF
//     the ballast with its crown reaching over the track — those trees render on
//     the canopy layer (above the trains), so the train visibly slips beneath
//     the foliage. Watch the train cross 1,1/2,1.
//  3. **Neighbours count.** The forest tiles ABOVE and BELOW the line (x=1..2,
//     y=0/2) also keep their trees' canopies clear of the corridor next door —
//     except the deliberate overhangers.
const forest = { connections: [], terrain: "forest" as const };
const urban = { connections: [], terrain: "urban" as const };

export const clearing: TestScenario = {
  id: "clearing",
  name: "Clearing",
  description:
    "A line through a wood and a town: scatter clears the right-of-way, big canopies overhang it and the train passes beneath.",
  level: {
    // A deep wood around the western half of the line.
    "1,0": forest,
    "2,0": forest,
    "1,2": forest,
    "2,2": forest,
    // The town around the eastern half.
    "3,0": urban,
    "4,0": urban,
    "3,2": urban,
    "4,2": urban,
    // The line itself: two forest tiles, then two town tiles, depot to depot.
    "0,1": expandKind("depot", 1),
    "1,1": { ...expandKind("straight", 1), terrain: "forest" },
    "2,1": { ...expandKind("straight", 1), terrain: "forest" },
    "3,1": { ...expandKind("straight", 1), terrain: "urban" },
    "4,1": { ...expandKind("straight", 1), terrain: "urban" },
    "5,1": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 1, "people", 2, "5,1"),
  },
};
