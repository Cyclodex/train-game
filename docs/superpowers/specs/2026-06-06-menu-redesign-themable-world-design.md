# Menu redesign + themable world boundary

**Date:** 2026-06-06
**Status:** Approved (design), pending implementation plan

## Context

The play view's controls (`.control-buttons` in `PlayView.vue`) are plain, unstyled
blocky buttons fixed top-left, and the editor toolbar (`EditorView.vue`) is a
similarly utilitarian top bar. They look out of place next to the polished
"score-card" (the Deliveries / Level Complete panel), which uses a frosted
dark-glass aesthetic the user likes. Separately, the game board (a fixed-size
tile grid) sits on a bare **white page** — nothing marks the edge of the world.

This work restyles the menus into reusable glass chrome, introduces a
**themable** world backdrop so the area around the board is decorated rather than
blank, and reorganises the editor into a navigation/actions drawer plus a
kid-friendly tool dock. The intended outcome: a cohesive, game-like UI that
matches the score-card and reads well for children.

## Decisions

- **Play view** uses a single left **drawer** (style "A") for all controls.
- **Editor view** uses the same left **drawer** for global actions + a bottom
  **dock** (style "B") for the build tools — big, kid-friendly tap targets.
- World backdrop is **themable**, two themes now: **Meadow** (default) and
  **Table** (wooden baseboard). Switcher is a single 🎨 button in the drawer that
  cycles Meadow ⇄ Table; the choice persists to localStorage.
- The dark-glass menus stay visually consistent across themes; only the
  surrounding world changes.

## Components & files

### Shared glass styling
- **`src/scss/global/_glass.scss`** (new) — a `%glass` placeholder / mixin
  capturing the frosted-glass surface currently inlined in `PlayView.vue`'s
  `.score-card` (slate gradient, `rgba` border, blur, rounded, shadow). Imported
  via `src/scss/_main.scss`. `score-card`, the drawer, and the dock all draw from
  it so the look has one source of truth.

### MenuDrawer (style A)
- **`src/components/MenuDrawer.vue`** (new) — a fixed, left-edge vertical glass
  panel, collapsible via a small side tab (open/closed state local to the
  component; persisted to localStorage is optional, not required). Renders a
  title label and a `<slot>` for the buttons. Provides shared button styling
  (`.drawer-btn`, an `.on`/active modifier, an `.accent` modifier, and a
  `.divider`). Less prominent than the score-card (smaller shadow, lower
  z-index than the score-card's `2000`).

### ToolDock (style B)
- **`src/components/ToolDock.vue`** (new) — a bottom-center floating glass dock
  with **large** segmented buttons (big icon over/with a label, generous padding
  so they are easy for children to tap), active item glows green. Accepts the
  items via props or a slot, plus an optional `hint` string rendered as a chip
  above the dock. Bottom-centered; offset is acceptable to clear the drawer.

### gameConfig + theme registry
- **`src/gameConfig.ts`** — add `worldTheme: WorldTheme` to the reactive config
  with `WorldTheme = "meadow" | "table"`, default `"meadow"`. Load the initial
  value from localStorage (key e.g. `train-game:worldTheme`) and write it back
  whenever it changes (follow whatever persistence pattern the existing config
  uses; if none, a small `watch`/setter in the view's theme-cycle handler is
  fine). Add a `cycleWorldTheme()` helper or do the cycle inline in the views.
- **`src/themes.ts`** (new) — the theme registry: an ordered list of
  `{ id: WorldTheme; label: string }` used to drive the cycle and to map
  `id -> body/root class` (`theme-meadow`, `theme-table`). Keeps "add another
  theme" to one entry + one CSS block.

### World wrapper + theme CSS
- A plain `.world` wrapper `<div>` added directly in `PlayView.vue` and
  `EditorView.vue` around the existing `.level` grid (no new component — the
  wrapper is trivial markup and the views' surrounding content differs). It fills
  the viewport, centers the fixed-size board, applies the themed backdrop, and
  gives the board a frame (drop shadow for Meadow; wooden border for Table). The
  `.world` styles live in the shared `_themes.scss` partial (below) so both views
  share them. The themed background is selected by a `theme-<id>` class applied
  high up — on `#app` in `App.vue`, driven by `config.worldTheme` — so both views
  and the test view inherit it.
- Theme CSS lives in a new **`src/scss/global/_themes.scss`** partial (imported
  via `src/scss/_main.scss`):
  - **Meadow** — green countryside background (layered radial "bushes" +
    gradient), board raised with a soft drop shadow + subtle light border.
  - **Table** — warm wooden baseboard frame around the board, inset wood-grain.

### View wiring
- **`PlayView.vue`** — replace `.control-buttons` markup with `<MenuDrawer>`
  containing the existing handlers: router-links to `/editor` and `/test`,
  `pausePlayGame`, `changeGlobalTimeScale`, `switchDebugMode`, `cycleSwitchLock`,
  and a new theme-cycle button. Wrap `.level` in the world wrapper. Keep the
  score-card and event-log unchanged. Remove the old `.control-buttons` SCSS.
- **`EditorView.vue`** — move global actions (Play this / Random / Clear /
  Export / Import / Back to game) + the validity status into `<MenuDrawer>`;
  move the five tools (`connect`→"Rail", `road`, `depot`, `signal`, `erase`)
  into `<ToolDock>` with the existing `hint` as the dock's hint chip. Keep
  `setTool`, `tool`, and all grid/SVG interaction logic untouched — only the
  toolbar chrome changes. Wrap `.level` in the world wrapper. The `Tool` union
  stays as-is; map ids to friendly labels/icons in the dock only.
- **`TestView.vue`** — restyle its `.nav-link` "← Game" to match the new chrome
  (lightweight; the picker can stay). Inherits the theme background via `#app`.

## Data flow

`config.worldTheme` (reactive, in `gameConfig`, injected as `config`) →
`#app` class `theme-<id>` in `App.vue` → CSS selects the backdrop + board frame.
The drawer's 🎨 button calls a cycle handler that advances `config.worldTheme`
through the `themes.ts` registry and persists it. No simulation or sim-state
changes; this is purely presentation.

## Error handling / edge cases

- localStorage read guarded (try/catch, fall back to `"meadow"`) so a corrupt or
  unavailable store never breaks boot.
- An unknown persisted theme id falls back to the default.
- Drawer must not overlap the score-card (top-center) or the debug event-log
  (top-right); choose widths/offsets so all three coexist. Lower the drawer's
  z-index below the score-card.
- The dock is offset/centered so it does not sit under the drawer.

## Testing / verification

- **`npm run build`** (vue-tsc + vite) — type-check and build must pass.
- **`npm run test:unit`** — existing unit suite stays green.
- **e2e (`npm run test:e2e`)** — the existing spec asserts the level renders 40
  tiles + 2 trains, trains leave their depots, and there are no console errors.
  The new `.world` wrapper must NOT break those selectors — verify/adjust the
  spec's selectors if it queries by a structure we change.
- **Manual** — `npm run dev`, then on `/play`: drawer controls all work
  (pause/speed/debug/switch/nav), theme button cycles Meadow ⇄ Table and the
  backdrop changes and survives reload; on `/editor`: drawer actions + dock tool
  selection work, hint updates per tool, building rail/road/depot/signal/erase
  still functions; the board is framed and the surroundings are themed, not white.

## Scope note (test world)

The project rule "every feature ships a `/test/:id` scenario" targets **sim
mechanics** isolated on tiny maps. This change is presentation-layer chrome
(menus, backdrop, theming) with **no new sim mechanic**, so no new test-world
scenario is added. The existing scenarios must still validate (they will — the
sim is untouched). The theme background does apply to the test view via `#app`.

## Out of scope

- Additional themes beyond Meadow/Table (registry makes them cheap to add later).
- Re-theming the menu glass per theme (menus stay consistent).
- Any change to simulation, tile model, routing, or editor tool behaviour.
