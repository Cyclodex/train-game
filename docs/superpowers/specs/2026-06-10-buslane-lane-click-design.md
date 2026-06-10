# Bus-lane tool: direct lane-click with street-run propagation

Date: 2026-06-10
Status: approved (design discussed with Fabian; lane-click chosen over
progressive edge clicks and over a street-inspector popup, which stays a
possible future feature once per-lane turn rules give it more to configure).

## Problem

The editor's 🚌 bus-lane tool is hardcoded to `toggleLaneKind(cell, port, 0)`:
clicking an edge only ever flips the KERB lane (index 0) of that approach on
that single tile.

- A second click un-does the kerb lane instead of reaching lane 1, so inner
  lanes can never be made bus lanes.
- Multiple bus lanes per approach — up to an entirely bus-only street — are
  impossible to author, even though the `Lane.kind` model, the sim
  (`laneUsableBy` / `usableExits`) and the renderer already support any
  combination.
- Painting a long street is one click per tile, and a missed tile leaves a
  silently broken bus lane mid-street.

This is purely an editor-interaction limitation; no model or sim change is
needed.

## Interaction design

With the 🚌 tool active:

- **Every lane of every road tile gets its own hit path** along the lane's
  actual geometry (straights and curves), with a hover highlight so the user
  sees exactly which lane a click will flip. This replaces the current
  edge-zone click for the buslane tool (other tools keep their edge zones).
- **Click** toggles that lane between bus and normal **along the whole street
  run** (see traversal below).
- **Ctrl+click** toggles only the clicked tile's lane — fine control, e.g. a
  bus lane that starts mid-street.
- The tool hint text is updated to describe lane-click + Ctrl+click.

Toggle semantics: the **clicked** lane decides the target state (if it is
currently a bus lane the target is "normal", otherwise "bus"), and that state
is **set** on every lane of the run. A half-painted street therefore becomes
uniform in one click instead of inverting tile-by-tile.

## Street-run traversal

New pure helper in `src/tiles/editOps.ts`:

```ts
streetRunLanes(level: Level, id: string, from: Port, index: number):
  { id: string; from: Port; index: number }[]
```

Starting from the clicked lane `(id, from, index)`:

- **Forward**: follow the lane's single exit port (`lane.to[0]`) to the
  neighbour tile; the continuing lane there enters through
  `oppositePort(exit)` at the same `index`.
- **Backward**: symmetric — the neighbour behind `from` whose lane exits
  toward `oppositePort(from)` at the same `index`.
- Curves are followed (a street that bends is still one street).
- The walk **stops** at: a junction tile (`isRoadJunction`), the end of the
  road (no neighbour road), a tile where that lane `(from', index)` does not
  exist, or a lane with multiple exits (junction-style movement).
- The result always contains at least the clicked lane; the walk never visits
  a tile twice (loop guard for circular streets).

The editor applies `toggleLaneKind`-equivalent "set kind" updates for every
triple in the result as a single level commit. `toggleLaneKind` itself stays
unchanged as the single-cell reducer (used directly by Ctrl+click).

## What does not change

- `Lane.kind`, the sim, validation and rendering — they already support
  arbitrary bus-lane combinations.
- Other editor tools and their edge zones.

Accepted edge case: an all-bus street strands or reroutes cars. That is a
legitimate authoring choice (class-aware routing handles it), not an error.

## Test-world scenario: bus shortcut

Per the project rule (every feature ships with a scenario), and because the
existing bus scenarios (`buslane`, `buses`, `buscross*`, `busmedian*`, …) all
showcase bus lanes *beside* car lanes — occupancy and crossing behaviour —
none demonstrates a bus-only **street** changing route choice.

New scenario `busshortcut` (registered in the buses group):

- A rectangular two-way car loop with a **bus-only middle street** cutting
  across it (an H / theta shape): buses take the shortcut through the middle;
  cars must drive around the long way.
- Both vehicle classes spawn; the scenario demonstrates class-aware routing
  (`usableExits`) at the junction level — the hard guarantee is that a car
  never turns into the bus-only street, while buses do use it (how often
  depends on the road-routing model's turn choices).
- Standard registration: one file `scenarios/busshortcut.ts` + one line in
  `index.ts`; validated automatically by `testScenarios.spec.ts`.

## Testing

- Unit tests for `streetRunLanes`: straight run, run around a curve, stop at a
  junction, stop at road end, missing lane index, mixed-state run becomes
  uniform, circular street terminates.
- Existing `toggleLaneKind` tests unchanged.
- The `busshortcut` scenario is validated by the registry spec and serves as
  the manual-QA stage for both the routing behaviour and (via the editor) the
  new lane-click tool.
