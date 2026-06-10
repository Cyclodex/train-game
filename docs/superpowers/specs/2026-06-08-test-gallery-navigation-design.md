# Test gallery — drill-down navigation

**Date:** 2026-06-08
**Status:** Approved, ready for implementation

## Problem

The `/test` feature picker is a single `<select>` with four `<optgroup>`s. It now
holds ~46 scenarios, and the **Road** group alone is ~30 of them — one flat,
unscannable wall. HTML `<select>` cannot nest optgroups, so the grouping approach
has hit its ceiling. As more mechanics land the picker only gets worse.

## Goal

Replace the flat dropdown with a **three-level drill-down gallery**
(domain → category → scenario) that stays readable as the scenario count grows,
is deep-linkable at every level, and keeps the "drop a file, append one line"
authoring workflow.

## Taxonomy

Three top-level domains. Every existing scenario maps into exactly one
domain/category; **no scenario files change.**

- **Trains**
  - *Basics* — straight, curve, depot
  - *Signals & switches* — signals, switchDefault
  - *Junctions* — junction, cross
  - *Crossings* (rail × road) — crossing, keepcrossingclear, crossingkeeper
- **Streets**
  - *Driving basics* — carfollowing, carqueue, carcircle, carscurve
  - *Curves* — roadcurveloops, roadcurvetraffic
  - *One-way & lanes* — roadoneway, roadstraightlanes, roadlanemerge,
    roadonewaylanes, crosslanes
  - *Crosses & junctions* — roadcross, roadcross1lane, roadcross2lane,
    roadcross3lane, crossturns2lane, crossturns3lane, mixedcross, mixedtee,
    roadjunction, bigjunction
  - *Turning rules* — turnlanes, rightturncross, noleftturn
  - *Overtaking* — overtaketwolane, overtakeloop
  - *Priority* — roadpriority
  - *Vehicles* — trucks, buslane, buses, buscross
  - *Destinations & routing* — cardestination, carroute
- **Challenges**
  - objectives, timeattack, daily

Authoring rule (replaces the old one): to add a scenario, drop a file in
`scenarios/` and append it to the matching category's `scenarios` array in
`index.ts` (simplest first within a category).

## Data model — `src/levels/test/index.ts`

Replace the flat `SCENARIO_GROUPS` with a nested structure that keeps explicit
ordering:

```ts
export interface ScenarioCategory {
  id: string;          // url slug within its domain, e.g. "lanes"
  label: string;       // human label, e.g. "One-way & lanes"
  scenarios: TestScenario[];
}
export interface ScenarioDomain {
  id: string;          // url slug, e.g. "streets"
  label: string;       // human label, e.g. "Streets"
  categories: ScenarioCategory[];
}

export const DOMAINS: ScenarioDomain[] = [ /* … */ ];

// Flat registry, in picker order — derived so there is one source of truth.
// Downstream (validation test, scenarioById) is unchanged.
export const SCENARIOS: TestScenario[] =
  DOMAINS.flatMap(d => d.categories).flatMap(c => c.scenarios);

export function scenarioById(id: string | undefined): TestScenario { /* unchanged */ }

// Reverse lookup for breadcrumbs and the back-compat redirect.
export function locate(scenarioId: string):
  { domain: ScenarioDomain; category: ScenarioCategory } | undefined;
```

`SCENARIO_GROUPS` and `ScenarioGroup` are removed (only `TestView` consumed them).

## Routing — `src/router.ts`

Nested, deep-linkable at every level. Replace the single
`/test/:scenario?` route with:

- `/test` → domain cards
- `/test/:domain` → category cards for that domain
- `/test/:domain/:category` → scenario cards for that category
- `/test/:domain/:category/:scenario` → the stage (live demo) + breadcrumb

Implemented as one `TestView` route with optional params
(`/test/:domain?/:category?/:scenario?`); `TestView` decides what to render from
which params are present. Invalid/missing params fall back to the gallery root.

**Back-compat:** old deep links are bare `/test/:id` where `:id` is a scenario id
(e.g. `/test/signals`). Domain ids (`trains`/`streets`/`challenges`) never collide
with scenario ids, so resolution for a single segment is: if it matches a domain,
show that domain's categories; else if it matches a scenario id via `locate`,
redirect to the full `/test/:domain/:category/:scenario` path. Existing bookmarks
keep working.

## UI — `src/views/TestView.vue`

Replace the `<select>` with a gallery:

- A **breadcrumb** row, e.g. `Test / Streets / One-way & lanes`, each segment a
  link up the tree. The `← Game` nav link stays.
- A responsive **grid of cards** for the current level:
  - Domain card → label + scenario count (sum across its categories).
  - Category card → label + scenario count.
  - Scenario card → name + description; clicking opens the stage.
- When a scenario is selected (4-segment route), render the breadcrumb + the
  existing `TestStage` (`:key="scenario.id"`, unchanged) below it.

**Cards are text-only in v1** (label / description / count). Live-SVG map
thumbnails are a deferred follow-up (they require rendering tiles without the sim)
and are explicitly out of scope here.

`TestStage.vue` is reused unchanged.

## Testing

- The existing `tests/unit/levels/testScenarios.spec.ts` iterates `SCENARIOS`
  (derived from `DOMAINS`) and still validates every map — untouched.
- Add a small unit test for taxonomy well-formedness: every `SCENARIOS` entry is
  reachable through exactly one domain/category; all domain ids, category ids
  (within a domain), and scenario ids are unique; `locate` round-trips for every
  scenario.
- `npm run build` (vue-tsc) is the type-level check for the route/data changes.

## Out of scope / deferred

- ~~Map thumbnails on cards (v2).~~ **Done** — see the addendum below.
- Search / tag filtering (the dropdown-era idea #2 — not needed once drill-down
  lands).
- Any change to scenario `.ts` files or the `TestScenario` type.

---

## Addendum (2026-06-08): BeamNG-style image tiles

The deferred thumbnails landed as a follow-up. Inspired by BeamNG's game-mode
menu (large image cards with title overlays), the gallery's text cards became
**image tiles** backed by auto-rendered, sim-free level previews.

- **`src/levels/test/thumb.ts`** — `scenarioThumb(level, grid)`, a *pure*
  function that builds preview geometry from the same modules the live tile
  renderer uses (`railPathsFor`, `roadSurfacePolygonPath`,
  `roadCurvePolygonPath`, `segmentPathD`, `roadEdges`, `laneCount`) but none of
  the game-coupled detail (signals, switches, lane-drop gores, mismatch flags,
  cars). Output is per-tile, in tile-local coordinates, so the view places each
  tile under a `translate()` group. Road width = the tile's own lane count
  (min 2), no cross-tile taper — accurate enough for a thumbnail.
- **`src/components/ScenarioThumb.vue`** — a pure view over that data: one SVG
  with a muted-meadow backdrop, grey road ribbons, rail trackbed + steel rails,
  and amber depot markers. No injects, no game, no rAF — renders even in a
  backgrounded tab.
- **`TestView.vue`** — cards became 16:10 image tiles: a full-bleed
  `ScenarioThumb` background, a bottom gradient, and the title/description/count
  overlaid; hover zooms the art (`scale(1.06)`) and lifts the card. Domain and
  category tiles preview their **representative** scenario
  (`firstScenarioOf` — the first leaf under them); scenario tiles preview
  themselves.
- **Decisions:** depot markers use a neutral amber (no game colour-assignment in
  a static preview); the count label is pluralised ("1 scenario").
- **Testing:** `tests/unit/levels/thumb.spec.ts` iterates `SCENARIOS` and asserts
  `scenarioThumb` covers the whole grid, emits one tile per cell placed in-grid,
  draws ≥1 path with only finite coordinates, and marks every depot cell.

Still deferred: curated hero screenshots for top-level tiles (auto previews were
enough), and a brand-new main-menu launcher at `/` (this addendum only touched
the `/test` gallery).

### Identity glyphs (follow-up)

The auto previews are recognisable but samey (grey-on-green), so each tile also
carries a big **identity glyph** centred over a dimmed preview — the layout
flavour stays, but the topic/mechanic reads instantly (inspired again by
BeamNG's mode tiles).

- **`src/levels/test/icons.ts`** — emoji maps (`DOMAIN_ICONS`, `CATEGORY_ICONS`
  keyed `domain/category`, `SCENARIO_ICONS`) plus resolvers. Emoji chosen for
  zero-asset, universally-recognisable identity; kept out of the scenario files.
  A scenario falls back to its category's glyph, so none hit the generic
  placeholder.
- **`TestView.vue`** — each tile gains a radial dark **veil** (darkest centre,
  clearing to the edges so the map still shows) and a large glyph that scales on
  hover.
- **`tests/unit/levels/icons.spec.ts`** — every domain/category/scenario resolves
  to a real glyph.

A natural next step if more polish is wanted: replace emoji with a consistent set
of custom line-icons, and/or a per-domain accent colour.
