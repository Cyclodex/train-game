# Terrain as tile data — design

_Status: proposed. Written after the camera landed and made the backdrop's
ambiguity visible._

## The problem

Three different things are currently one CSS background on `#app`:

1. **Backdrop** — what lies beyond the world's edge.
2. **Ground** — what a given tile *is* (grass, water, rock, town).
3. **Scatter** — the trees, rocks and buildings standing on that ground.

Collapsing them was fine while the board was a fixed 7×6 slab that never moved.
The camera broke the illusion: pan or zoom and the board slid over a forest that
stayed put, because those trees were backdrop pretending to be ground.

The immediate fix (landed) splits (1) from (2)+(3): the meadow tile is painted on
the board element, which the camera transforms, so the trees move and scale with
the tiles they stand between; beyond the board is a deliberately flat, low-contrast
distance with no objects at board scale to give the parallax away.

That is correct as far as it goes, and it is where the interesting question starts.

## The question

Scatter is still *decoration*: a seamless texture, identical everywhere, meaning
nothing. A world that wants rocks, water, towns and forest needs those to be
things the world HAS, not things painted behind it.

## Proposal

Make terrain what every other part of this codebase already is: **tile data**,
with everything else derived from it.

```ts
// tiles/model.ts
export type TerrainKind = "grass" | "forest" | "water" | "rock" | "urban";

export interface TileCell {
  connections: PortPair[];
  road?: Lane[];
  terrain?: TerrainKind; // absent = "grass"
  // …
}
```

This follows the project's founding rule (CLAUDE.md: *a tile is DATA, not a class
hierarchy; everything is derived from it*). The backdrop is currently the only
part of the world that disobeys it.

### Rendering

- Ground colour per tile, derived from `terrain`, drawn under the rails/roads
  inside the transformed board.
- Scatter **derived, not authored**: trees/rocks/houses placed by a seeded RNG
  from `(terrain, coord, worldSeed)` — the same deterministic trick
  `meadowBackdrop.ts` already uses, just per tile instead of per texture tile.
  An author paints an *area* of forest; the individual trees follow. Determinism
  matters: the same level must look the same every load, and screenshots must be
  comparable.
- Edges between different terrains want a transition (a shoreline, a treeline)
  or they read as a checkerboard. Cheapest credible version: a per-edge overlay
  chosen from the neighbour's kind — the same derivation shape as
  `autotile.ts` already does for rails.

### Authoring

A terrain brush in the editor's tool dock, painting areas rather than single
tiles. Terrain is the one layer where a drag-to-paint gesture is the natural
verb, and the editor's left-drag is now free on the terrain tool (it belongs to
the connect tool only while connecting).

### Rules — deliberately last

Terrain should ship **purely cosmetic**. Zero risk to the simulation, immediate
visual payoff, and it lets the data model settle before anything depends on it.
Then rules arrive one at a time, each with its own `/test` scenario:

| Rule | Needs |
|---|---|
| Water blocks plain track/road | `validateLevel` check + an editor refusal |
| …unless the tile is a **bridge** | a `bridge` role — the data model already supports two non-interacting port pairs on one cell |
| Rock blocks building outright | validator + editor |
| Forest is cosmetic only | nothing |
| Urban raises car spawn weight | `roadEntries` weighting — a small, contained change |

Bridges are the prize: a road crossing rail *without* a level crossing is the
first thing terrain unlocks that is genuinely new gameplay, and
`docs/road-future-improvements.md` §3.1 already wants it.

## Why not the alternatives

**Keep it decorative, add more textures.** Cheap, but every future feature that
wants to ask "what is here?" — bridges, tunnels, build costs, city demand — has
nowhere to look. The question gets asked eventually; the data model should exist
before something has to fake it.

**Parallax layers.** Solves the visual complaint and nothing else. Worth having
*as well*, for the far distance, but it is set dressing, not world building.

**Procedural terrain generated per level.** Attractive, but it makes authored
levels non-reproducible unless it is seeded and stored, at which point it is tile
data again — just written by a generator rather than a person. Which is the right
end state: `generateLevel` should paint terrain, and the editor should let you
correct it.

## Sequencing

1. ~~Split backdrop from ground so the camera reads correctly.~~ **Done.**
2. `terrain` field + per-tile ground colour + derived scatter. Cosmetic only.
3. Terrain brush in the editor; `generateLevel` paints terrain.
4. Rules, one at a time, each with a `/test` scenario: water → bridge → rock.

Step 2 is the commitment. Steps 3 and 4 are independently valuable and can stop
at any point.
