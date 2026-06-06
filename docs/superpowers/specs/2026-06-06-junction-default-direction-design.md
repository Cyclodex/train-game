# Junction default switch direction (authored in the editor)

Date: 2026-06-06

## Problem

A switchable junction (cross or T-junction) has, per entry port, a *switch arm*
choosing which exit a train takes. Today that arm's **starting** position is
computed at runtime in `initialSwitches()` (`src/game.ts`): for each junction
entry it picks "the first arm whose geometric exit is an actual connection."
Players can toggle a switch at runtime, but a freshly loaded level always begins
at that computed arm. There is no way, in the editor or the level data, to author
how a junction *starts*.

This feature lets the editor author a junction's starting switch direction and
persists it in the level, so loading the level seeds from the authored arm.

## Scope

- All switchable junctions: 4-way **cross** and **T-junction**. The arm mechanic
  is identical for both.
- The default is authored **per entry port** (a cross has up to four independent
  switches), matching how switches already work.
- Authoring happens in the editor by **clicking the junction's switch widget**
  directly — no new toolbar tool. The widget is layered in front of the editor's
  edge hit-zones and intercepts the click; edge/track routing still works
  everywhere else on the tile.

Non-goals: changing runtime switch toggling, interlocking, or how the simulation
reads switch state. Only the *seed* and the *authoring* are new.

## Design

### 1. Data model — `src/tiles/model.ts`

Add one optional field to `TileCell`, alongside `signals` / `road`:

```ts
// Authored starting switch arm per junction entry port (keyed by Port). Absent
// entries fall back to the auto-computed first-valid arm. Only meaningful on a
// switchable junction (cross / T-junction); ignored elsewhere. Round-trips
// through level JSON like `signals`/`road`.
defaultArms?: Partial<Record<Port, ActiveIntersection>>;
```

`Port` is the numeric `Position` enum; JSON serialises its keys as strings, and
reading `cell.defaultArms[port]` (number) coerces to the string key — round-trips
cleanly through export/import and `localStorage`, like the existing layers.

Add a derivation helper:

```ts
// The authored starting arm for an entry, but only when its geometric exit is
// still a real partner of that entry. Returns undefined for an unauthored entry
// OR for a stale arm whose exit was since deleted — so a left-over arm never
// drives routing to a non-existent connection.
export function defaultArmFor(
  cell: TileCell,
  entry: Port
): ActiveIntersection | undefined;
```

It reuses `partnersOf` + `armExit` (already in this module) to validate the arm's
exit against the current connections.

### 2. Seeding — `src/game.ts`

`initialSwitches(level)` changes one line of intent per junction entry: use
`defaultArmFor(cell, port)` when it returns a value, otherwise fall back to
today's "first arm whose exit is a real connection." Everything downstream is
unchanged — `network.ts` / `simulation.ts` still resolve the live arm through the
`getSwitch` callback over `game.switches`; only the initial contents of that map
differ. Runtime toggling and interlocking are untouched.

### 3. Editing reducer — `src/tiles/editOps.ts`

A new pure, immutable reducer:

```ts
// Advance the authored starting arm for `entry` to the next arm whose geometric
// exit is a real partner (same cycling rule as Tile.vue's runtime changeSwitch),
// writing it into a fresh cell's `defaultArms`. No-op if `entry` is not a
// switchable junction entry.
export function cycleDefaultArm(cell: TileCell, entry: Port): TileCell;
```

The cycling order matches `Tile.vue.changeSwitch` (Left → Straight → Right,
skipping arms whose exit isn't a partner) so the editor and runtime feel the same.

### 4. Editor authoring — `src/views/EditorView.vue`

The editor renders `Tile.vue` as visual-only with an SVG overlay; the overlay's
edge triangles claim clicks across the whole tile. To author a starting arm by
**clicking the switch widget** (no new tool), the editor:

- **Displays** the authored state on the existing `Tile.vue` switch widget by
  keeping the editor's stub-game `switches` map synced from the level: for every
  junction entry, `defaultArmFor(cell, entry)` when present, else the computed
  first-valid arm — the same rule `initialSwitches` uses. So the widget's lit bulb
  always shows what the junction will start as. The sync is a reactive derivation
  recomputed when the level changes (and is cheap — junctions only).
- **Intercepts** the click with a switch hit-zone drawn *after* the edge
  triangles in the overlay SVG (so it paints on top) at each junction entry's
  widget position, with `@click.stop`. Clicking it calls
  `cycleDefaultArm(cell, entry)`, commits the cell, and re-persists; the sync then
  relights the widget. Because the hit-zone is in front and stops propagation, the
  underlying edge-routing zone never fires for that small region. Edge routing
  still works across the rest of each edge triangle.

This keeps all interaction in the overlay (matching how `signal`/`connect`
already work) and adds no new tool button. The switch hit-zones appear only on
junction tiles and only when not actively dragging a route, to minimise
mis-clicks while building track.

### 5. Authoring sugar — `src/tiles/kinds.ts`

Add to `KindOptions`:

```ts
// Authored starting arms, keyed by the FINAL (post-rotation) entry port.
defaultArms?: Partial<Record<Port, ActiveIntersection>>;
```

`expandKind` copies a non-empty, validated `defaultArms` onto the produced cell so
levels and test scenarios can author starts declaratively, e.g.
`expandKind("cross", 0, { defaultArms: { [Top]: ActiveIntersection.Right } })`.

### 6. Test world (required) — `src/levels/test/scenarios/switch-default.ts`

A tiny map with one 4-way **cross**: a train leaves a depot, enters the cross, and
the cross's entry arm is authored to start on the arm that is **not** the
auto-computed default, sending the train down the spur to a specific destination
depot from the very first tick. With the arm unauthored it would take the other
exit. Registered with one line in `src/levels/test/index.ts`. The existing
`tests/unit/levels/testScenarios.spec.ts` validates it (connectivity, route
reachability, trains-in-depots, grid fit) automatically.

## Testing

- `tests/unit/tiles/model.spec.ts`: `defaultArmFor` returns the authored arm when
  its exit is a current partner; returns `undefined` for an unauthored entry and
  for a stale arm whose exit was deleted.
- `tests/unit/tiles/editOps.spec.ts` (or existing editOps tests): `cycleDefaultArm`
  advances through only the valid arms and is a no-op on a non-junction entry.
- `src/game.ts` seed: a unit test that `initialSwitches` honours an authored arm
  and still falls back to the computed arm when `defaultArms` is absent.
- The new scenario is auto-validated by `testScenarios.spec.ts`.
- `npm run build` (vue-tsc + vite) for type-level correctness; `npm run dev` to
  confirm the editor widget cycles and the cross starts on the authored arm in
  `/test/switch-default`.

## Risks / notes

- **Stale arms**: deleting a connection can leave an authored arm whose exit no
  longer exists. `defaultArmFor` guards this everywhere it is read (seed + editor
  display), so a stale arm silently falls back rather than breaking routing.
  `cycleDefaultArm` only ever writes a valid arm.
- **Switch hit-zone vs. routing**: placing the switch hit-zone in front is a
  deliberate, scoped override of the edge-routing zone for the small widget area.
  It is suppressed mid-drag so it cannot hijack a route gesture.
- **Round-trip**: `defaultArms` is plain JSON and flows through the editor's
  export/import and `playThis` (`JSON.parse(JSON.stringify(level))`) with no extra
  handling.
