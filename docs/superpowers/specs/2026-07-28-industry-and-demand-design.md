# Industry & terrain-driven demand — design

_Status: the KIND is built (2026-07-28). The DEMAND COUPLING is designed here and
deliberately not built. Written as roadmap item 4 of
`2026-07-28-terrain-roadmap-handoff.md`, which asked for exactly this split._

## What shipped

`TerrainKind` gained `"industry"`: buildable, `TERRAIN_BUILD_FACTOR` 2 (dearer
than a field, cheaper than town land — a works site is bought, but nobody is
being rehoused). Cool concrete hardstanding, and a scatter vocabulary
deliberately unlike the town's:

| | Town (`urban`) | Works (`industry`) |
|---|---|---|
| forms | pitched roofs, terraces | circles and grids — silos, tanks, container stacks |
| colour | warm tile and render | cool steel and concrete |
| layout | jittered ±12°, a village grew | square to the yard ±4°, a plant was planned |
| marks | paving, gardens | hardstanding aprons |

`/test/industry` puts the two on one board either side of a line, which is the
only way to check that neither reads as the other.

## Why the kind alone is worth having

Freight had nowhere to belong. A world of houses and fields told you where
passengers came from and nothing about where goods do, so a freight train was
scenery with a colour. Even purely cosmetically, a works beside a depot answers
"what is this siding *for*" at a glance.

But the kind is not the point. The point is the door it opens.

## The prize: terrain chooses the cargo

Today a fare is priced by cargo type and distance (`src/modes/tycoon.ts`), and
the cargo is a property of the TRAIN. Nothing in the world says what a place
produces or wants. That is the missing half: **a depot's neighbours should decide
what it ships.**

The rule, as small as it can be stated:

> A depot's cargo profile is derived from the terrain within one tile of it.
> Beside `urban` it generates passenger fares; beside `industry`, freight;
> beside `farmland`, bulk/agricultural; beside nothing in particular, a low
> mixed rate.

Everything else falls out:

- **Routing becomes a question about the map.** A works at one end and a town at
  the other is a line worth building; two towns is a passenger line; two works
  is a goods line. The player reads the landscape to decide what to build,
  which is the first time terrain has affected a decision beyond cost.
- **`generateTerrain` already places a town beside a depot** (step 4, "preferably
  beside a station"). It now places a works too. Both were written for looks;
  under this rule they become the generator seeding an economy.
- **The fare model needs no new axis.** Cargo and distance already price a fare.
  Terrain would choose or weight the CARGO, not add a term.

### What it must not do

- **No new persisted state.** The profile is derived from the level, like
  `canBuildOn` and `kindOf` — never stored on the depot, or the editor gains a
  property nobody can see and levels drift out of agreement with their own map.
- **No terrain rule in the simulation.** `src/sim/*` stays terrain-blind. The
  derivation belongs in the mode (`src/modes/tycoon.ts`) or beside
  `objectives.ts`, which is where cargo and money already live.
- **Not a fifth thing the player must learn at once.** It wants the destination
  badges from the Train Valley §8 list first, or the cargo a depot wants is
  invisible until it is refused.

## Sequencing

1. ~~The `industry` kind: ground, scatter, price, editor, generator, `/test`.~~
   **Done 2026-07-28.**
2. `depotProfile(level, id)` — a pure derivation returning cargo weights from the
   neighbouring terrain. Headless, unit-tested, used by nothing yet.
3. Tycoon reads it when it mints a fare, and the depot's badge shows what it
   wants. This is the commitment step; it changes how the mode plays.
4. Only then: demand that accumulates (a works that has been unserved pays more),
   which is the Endless/management loop and wants its own doc.

Step 2 is cheap and safe and can land any time. Step 3 should wait for the
briefing/badge work, or the rule will be invisible.

## Why not the alternatives

**Cargo as a depot property in the level data.** Simpler to read, but it is a
second source of truth for something the map already says, and it lets an author
put a steelworks fare on a depot in the middle of a meadow. Derivation keeps the
world honest.

**Industry as a `role`, like `depot`.** A role says what a cell DOES in the
simulation; terrain says what the ground IS. A works is ground — you can build a
line across it. Making it a role would put it in the sim's vocabulary for no
gain.
