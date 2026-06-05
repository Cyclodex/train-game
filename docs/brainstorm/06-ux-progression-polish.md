# 06 — UX, progression & polish

The connective tissue: onboarding, persistence, meta-progression, accessibility,
and sharing. None of it is the "fun core," but it's what makes the fun core
*reachable* and *sticky*. Much of this is low-risk and parallelisable.

---

## 6.1 — Tutorial / onboarding ★★

**What.** Teach controls and mechanics in-context. Best done the Railbound way:
the first levels of a campaign *are* the tutorial — each introduces one verb (rotate
tile, flip switch, hold signal) with minimal text.

**Why.** Right now the rules live in `CLAUDE.md`, not the game. New players bounce
off anything they can't infer. A campaign's early levels (doc 01 §1.5) double as the
tutorial for free.

**How.** Gated hint overlays + restricted palettes per early level; the level data
already drives what's available. Lightweight tooltip/coachmark component.

**Effort.** M. **Deps.** campaign/level loading (doc 01 §1.5).

---

## 6.2 — Save / load & progress persistence ★★

**What.** Remember unlocked levels, best stars/times, settings, and (for
sandbox/management) an in-progress game.

**Why.** Without it there's no meta-progression and no reason to return. Star
ratings (1.3) and upgrades (3.7) need somewhere to live.

**How.** localStorage for progress/settings (no backend needed). The data-driven
branch already serialises levels (export/import, `levelStore.ts`) — extend that to
a save format. Mid-game save is harder (serialise sim state); start with
progress-only.

**Effort.** S (progress) / M (mid-game state). **Deps.** none for progress.

---

## 6.3 — Level editor polish & sharing ★★

**What.** The editor exists (data-driven branch: paint/depot/erase, validation,
random map, export/import, "Play this"). Polish it (undo/redo, palette for new tile
types, terrain brush) and add **share-by-code/URL** so players swap levels.

**Why.** UGC is enormous longevity for near-zero ongoing content cost — players make
the levels. The hard part (the editor) is largely done.

**How.** Editor already serialises to JSON; encode to a URL hash or short code for
sharing (no server). Add brushes as new tile roles land (terrain, station,
crossing). Undo/redo via an edit stack.

**Effort.** M (incremental). **Deps.** data-driven editor (branch); grows with each
new tile type.

---

## 6.4 — Level select & world map ★

**What.** A screen to pick levels/worlds, showing stars earned and lock state — the
campaign's home.

**Why.** The frame that makes a pile of levels feel like a *game* with progress.

**How.** Reads progress (6.2) + the campaign manifest (1.5); a grid/map of nodes.
vue-router (on the branch) makes it a route.

**Effort.** M. **Deps.** 1.5, 6.2.

---

## 6.5 — Achievements / challenges ★

**What.** Meta goals across levels ("deliver 100 trains total," "win without ever
holding a signal," "clear a forest," "never crash in a session").

**Why.** Long-tail engagement; cheap to add once the event stream exists.

**How.** Predicates over the same sim/game event stream the objectives use (doc 01);
persisted to localStorage.

**Effort.** S–M. **Deps.** objective/event layer (1.1), persistence (6.2).

---

## 6.6 — Accessibility & options ★★

**What.** Colour-blind-safe palettes (critical — *colour matching is the core
mechanic*, so colour-blind players currently can't play), adjustable speed,
reduced-motion mode, remappable input, mute, scalable UI/text.

**Why.** The matching loop is colour-coded; without shapes/icons/patterns as a
second channel it's unplayable for ~8% of men. This is correctness, not just polish.
Pairs naturally with cargo *types* (doc 03 §3.3 — give each type an icon/shape).

**How.** Add a shape/icon channel alongside colour (the cargo-type work does this);
a settings panel for the rest; honour `prefers-reduced-motion`.

**Effort.** M. **Deps.** strongest paired with cargo types (3.3).

---

## 6.7 — Performance & scale ★

**What.** Keep it smooth as boards and train counts grow (procgen can make big
maps). The sim is already efficient and headless; the renderer writes transforms
straight to the DOM.

**Why.** Big ambitious levels (the fun of procgen + camera) must not stutter.

**How.** Profile the per-frame DOM writes; consider canvas/WebGL for the train layer
if SVG/DOM becomes the bottleneck at high counts; virtualise off-screen tiles. Only
when measured — don't pre-optimise.

**Effort.** M–L (only if/when needed). **Deps.** camera/large maps (4.7) surface
the need.

---

## 6.8 — Settings/config surfacing ★

**What.** The reactive `gameConfig` (tileSize, debug, automaticTrafficLights,
automaticRoutePlanning, railDistanceFromPath…) is powerful but mostly dev-only.
Surface the player-relevant ones in an options menu.

**Why.** Cheap player agency; the toggles already exist and are wired.

**How.** A settings panel bound to `gameConfig`; persist via 6.2.

**Effort.** S. **Deps.** none.

---

## Discussion seed

The "make it a real product" bundle is **6.1 tutorial + 6.2 persistence + 6.4 level
select**, which only makes sense once there's a campaign (1.5) to frame. The two
that are worth doing *regardless of direction* are **6.6 accessibility** (the colour
mechanic genuinely excludes people right now) and **6.3 editor sharing** (turns the
already-built editor into a content engine for free).
