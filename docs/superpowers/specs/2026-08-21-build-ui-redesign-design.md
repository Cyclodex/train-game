# Build UI redesign — Transport-Fever-grade tool organisation

**Status:** IMPLEMENTED 2026-08-21 (all three phases plus a mobile pass, on the
branch this spec landed on). §4–§5 describe what is now built; deviations:
traffic-light items are labelled Off / Two-phase / 2-ph +Bus / Round-robin /
R-robin +Bus, the lights tab default-arms Two-phase (not Off), and the dock has
a FIXED width so the category row never shifts between tabs. The old
`ToolDock.vue` was removed with its `_hud.scss` styles.
**Scope:** `/editor` tool dock (`EditorView.vue`, `ToolDock.vue`); no simulation
or tile-model changes. PlayView's in-play Build/Raze toggle is out of scope but
gets a follow-up note (§8).

## 1. Why

The editor's dock already copies Transport Fever's *layout* (fixed category row
at the bottom, tool panel above it) but not its *information architecture* —
and the IA is what makes Transport Fever feel clean. Ours mixes four different
concerns inside each category, invents three different widget patterns for the
same concept ("tool options"), and leans on hidden-state click-cycling. The
result: five top-level groups that each need a paragraph of floating help text
to be usable.

### Reference: how Transport Fever 2 organises the same problem

(From the [TpF2 manual — streets & tracks](https://wiki.transportfever2.com/doku.php?id=gamemanual:streetstracks).)

- Top level is **transport mode** (Streets, Rail, Water, Air) plus **Terrain**
  and a global **Bulldozer**.
- Inside a mode, **tabs separate the verbs**: the *Streets* window has a street
  **catalog** (typed presets: Urban / One-Way / Country / Highway, each with
  lanes + speed + cost) and a **TOOLS** tab for retrofits (add/remove bus lanes,
  tram tracks). The *Rail* window has **TRACKS / TOOLS / SIGNALS / WAYPOINTS**
  tabs.
- A road is **picked from a catalog of named types**, not assembled from
  toggles. Retrofit is a separate, clearly-named activity.
- Tool parameters (bridge type, catenary, one-way) appear in **one consistent
  parameter panel**, always in the same place.

## 2. Current state (what we have)

Two-level dock in `EditorView.vue` (`DOCK_GROUPS`):

| Group | Items | Ad-hoc extras |
|---|---|---|
| 🚂 Rail | Track, Depot, Station, Signal, Flyover | — |
| 🚗 Road | Road, Add lane, Remove lane, Bus lane, Bike lane, Signals | 1L/2L/3L + 🚌 + ➡️ chip row (road tool only) |
| 🅿️ Parking | Kerb, Angled, 90°, Garage, Halt, Car park | reservation chip row (—/♿/📦/🚛/🚌); facility id input |
| 🏞️ Terrain | 8 ground brushes, Raise, Lower | — |
| 🧽 Erase | Erase | empty panel (single item) |

Plus: grow controls (⬅︎+ ⬆︎+ and the world-size label) live inside the tool
panel; a `HINTS` paragraph (50–120 words) floats above the dock; zoom chrome is
a separate cluster bottom-right.

## 3. Findings (what's wrong, concretely)

1. **Mixed concerns per category.** Rail mixes way-building (Track), buildings
   (Depot, Station), control (Signal) and structure (Flyover) in one flat row.
   Road mixes building (Road) with four retrofit tools (±lane, bus, bike) and a
   control tool (Signalise). TpF2 keeps *build the way*, *retrofit the way*,
   *signalling* and *buildings* on separate tabs.
2. **Parking is a top-level peer of Rail/Road**, though it is road
   infrastructure. The player's mental model is train things / car things /
   terrain — parking is a car thing.
3. **Three widget patterns for one concept.** Road options are a floating chip
   row, parking *kinds* are dock items but parking *reservations* are a chip
   row, terrain *brushes* are dock items. Same concept (parameters of the armed
   tool), three inconsistent treatments in three different places.
4. **Hidden-state click-cycling.** Signalise cycles six junction modes per
   click (off → two-phase → two-phase+bus → round-robin → round-robin+bus →
   off). The target state is invisible before the click and overshooting costs
   five more clicks. (Depot rotation cycles too, but with immediate visual
   feedback and four states it's tolerable.)
5. **Erase is all-or-nothing.** `onCellClick` does `delete this.level[id]` —
   rail, road, parking *and* terrain of the cell vanish together. The per-rail
   ✕ handles help, but there is no "bulldoze only the road layer" — in a level
   where a road crosses rail on the same tile, erasing one means redrawing the
   other.
6. **Near-duplicate signal tools.** Rail "Signal" (🚦) and road "Signals" (🚥)
   are different mechanics with near-identical names and icons in two different
   groups.
7. **Help is a wall of text.** The `HINTS` paragraphs are documentation, not
   hints, and they float over the board. TpF2 shows a one-line status hint and
   keeps the manual elsewhere.
8. **Board chrome inside the tool panel.** Grow (⬅︎+ ⬆︎+, world size) is world
   chrome, not a build tool; it sits in the panel and survives every category
   switch, blurring what the panel *is*.
9. **A road type is assembled, not picked.** 1L/2L/3L × 🚌 × ➡️ is eight
   combinations the player must compose in their head. TpF2 names them
   (catalog of street types with lanes/speed data) so the result is readable
   before drawing.
10. **No keyboard access, ambiguous active state.** Category and tool both
    highlight with the same green pill; no shortcuts anywhere.
11. **Single-item category wastes a level.** Erase's panel shows only its own
    label; the dock height jumps between categories.

## 4. Proposed information architecture

Three fixed levels; every level has exactly one visual treatment.

```
CATEGORY (bottom row, always visible, 4 entries)
└─ TAB (middle row, per category, 1–4 entries)
   └─ ITEM (top row: the armed tool)  +  OPTIONS strip (fixed right slot)
```

### 🚆 Rail

| Tab | Items | Options strip |
|---|---|---|
| **Track** | Track (route builder) | — (bridge/tunnel stay automatic via terrain) |
| **Stations** | Station, Depot | — |
| **Signalling** | Signal, Flyover | — |

### 🚗 Road

| Tab | Items | Options strip |
|---|---|---|
| **Roads** | 1-lane, 2-lane, 3-lane *(cross-section icons)* | ➡️ one-way, 🚌 bus lanes — with a live cross-section preview of the resulting road |
| **Upgrade** | Add lane, Remove lane, Bus lane, Bike lane | — |
| **Traffic lights** | Off, Two-phase, Two-phase+Bus, Round-robin, Round-robin+Bus *(pick a mode, click junctions to apply — replaces 6-state cycling)* | — |
| **Parking** | Kerb, Angled, 90°, Garage, Halt, Car park (facility) | reservation chips (—/♿/📦/🚛/🚌); facility id when Car park armed |

### 🏔️ Terrain

| Tab | Items | Options strip |
|---|---|---|
| **Ground** | Fields, Forest, Water, Rock, Mountain, Town, Works, Grass | (later: brush size) |
| **Height** | Raise, Lower | (later: flatten) |

### 🧨 Bulldozer

No tabs (items row shows the layer filter directly).

| Items (= layer filter) | Behaviour |
|---|---|
| Everything, Rail, Road, Parking, Terrain | Click erases only the selected layer of the cell; the per-connection ✕ handles stay. "Everything" is today's behaviour. |

Notes:

- **Parking moves under Road.** The top level drops from 5 entries to 4 and
  matches the player's model (train / car / terrain / demolish).
- **Rail "Signal" vs road "Traffic lights"** get distinct names and distinct
  icon families, ending the 🚦/🚥 confusion.
- **Traffic-light modes become items** — the armed item is the mode you will
  apply. Cycling dies. (`cycleJunctionSignalMode` in `editOps.ts` gains a
  `setJunctionSignalMode(cell, mode)` sibling; the cycle stays for
  back-compat/tests.)
- **Layer-scoped erase** needs a small `editOps.ts` addition
  (`eraseLayer(cell, layer)`) — remove `road`/`parking`/`terrain`/rail
  connections independently, with `pruneParkingRows`/`syncJunctionLanesAround`
  invoked exactly as the existing erase paths do.

## 5. UI spec

### Dock (3 stacked rows, fixed heights — nothing jumps)

```
┌──────────────────────────────────────────────────────────────┐
│  [items…]                          │ Options: [chips]        │  ← row 3
├──────────────────────────────────────────────────────────────┤
│  Tab · Tab · Tab                                             │  ← row 2
├──────────────────────────────────────────────────────────────┤
│  🚆 Rail   🚗 Road   🏔️ Terrain   🧨 Bulldozer               │  ← row 1
└──────────────────────────────────────────────────────────────┘
      one-line hint pill above the dock; "?" opens full help
```

- **Row 1 (categories):** large icon buttons, never move. Active category =
  accent *underline* + tinted icon, **not** a filled pill.
- **Row 2 (tabs):** text pills. Active tab = medium-weight fill.
- **Row 3 (items + options):** the armed item is the **only** fully-filled
  accent pill in the whole dock — one glance answers "what will my click do".
  The options strip is a labelled, fixed-width slot on the right; when the
  armed tool has no options it shows nothing but keeps its slot (no reflow).
- **Category accent colours** (thin top-border on the panel + active
  underline): Rail amber, Road blue, Terrain green, Bulldozer red. Orientation
  without reading.
- **Hints:** one imperative line ≤ 60 chars (e.g. "Click an edge, then click
  tiles — Esc finishes."). A `?` button on the hint pill opens the current
  `HINTS` paragraph as a dismissable popover. The knowledge is kept, the board
  stays visible.
- **Keyboard:** `1–4` categories, `Tab` cycles tabs in the open category,
  `Q W E R T Z` arm items left-to-right, `X` toggles Bulldozer and back,
  `Esc` cancels the gesture (already does). Shortcuts appear in tooltips.
- **Memory:** each category remembers its last tab + item (per-session);
  switching Rail → Road → Rail restores your track tool, not the first item.
- **Board chrome:** grow controls (⬅︎+ ⬆︎+) and the world-size label move out
  of the dock into the existing zoom cluster (bottom-right of the viewport):
  `⬅︎+ ⬆︎+ · 7×6 · − 50% +`. World tools live with world chrome.
- **Iconography:** road items use small inline-SVG **cross-sections** (lane
  count + bus-lane tint visible in the icon itself); the Roads tab options show
  a slightly larger live cross-section combining item + toggles. Everything
  else keeps emoji — it is the game's established style — but each row uses
  one consistent set.

### What deliberately stays

- The **gesture layer** (edge triangles, route chaining, drag-to-paint,
  Ctrl+click single-tile variants) is good and unchanged — this redesign is
  dock-only.
- `RouteDrawController`, `editOps` reducers, validation — untouched except the
  two small additions above.
- Big kid-friendly buttons, frosted-glass style.

## 6. Implementation plan (3 phases, independently shippable)

**Phase 1 — IA restructure (data + a few reducers; ~1 day).**
Reshape `DOCK_GROUPS` into `category → tabs → items`; move Parking under Road;
split Rail/Road into tabs; traffic-light modes as items
(`setJunctionSignalMode`); layer-scoped bulldozer (`eraseLayer` + filter
items). The existing two-row dock renders tabs as a second pill row
temporarily. Unit tests for the new `editOps` reducers.

**Phase 2 — Dock UI (~1–2 days).**
Extract the dock into a `BuildDock.vue` (slots for items/options); 3-row
layout, fixed options slot, active-state hierarchy, category accents,
one-line hints + `?` popover, keyboard shortcuts, per-category memory; move
grow controls to the zoom cluster.

**Phase 3 — Polish (~1 day).**
Cross-section SVG icons for road items + live preview in the options strip;
tooltip shortcut labels; hint copy pass.

Each phase ends with editor screenshots (the dock is chrome, so `npm run
shot -- '#/editor'` route shots, before/after) and the standard build/unit
gates.

## 7. Success criteria

- Top level has 4 entries and answers "train / car / terrain / demolish".
- Any tool is reachable in ≤ 3 clicks and describable by breadcrumb
  ("Road → Traffic lights → Round-robin+Bus").
- Exactly one filled accent pill visible at any time (the armed tool).
- No click-cycling with hidden targets anywhere in the dock.
- The bulldozer can remove one layer without touching the others.
- No hint over the board longer than one line unless the player asks (`?`).

## 8. Follow-up (out of scope)

- PlayView's in-play build dock (Build/Raze/Undo) later adopts `BuildDock.vue`
  with a reduced category set, so play-mode building inherits the same IA.
- Terrain "flatten" brush; brush sizes.
- Road catalog as *named* presets with per-metre cost once the economy prices
  roads (TpF2-style catalog entries with data lines).
