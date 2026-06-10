# Editor: explicit connection drawing + per-direction signals

Date: 2026-06-05
Status: Approved design (pre-implementation)

## Problem

The first editor used auto-tiling: paint a "track" cell and its connections are
derived from neighbours. This is wrong for a track game:

- Adjacent track is force-joined, so you cannot lay **two parallel rails** one row
  apart without them cross-connecting.
- Junctions are always the **full** any-to-any crossing; you cannot choose which
  arms exist (e.g. a switch reachable from one side only).
- There is **no way to place signals**.

The canonical data model already supports all of this — a cell is
`connections: PortPair[]` (border-to-border pairs) plus per-tile signals/role.
The fix is to make the editor edit that model **directly and explicitly** instead
of guessing it from neighbours.

(Two regressions found alongside this are already fixed on the branch: the depot
building overflowed its tile because the facing/positioning CSS class was placed
on the `<img>` instead of an ancestor; and the debug kind-label overlapped the
coordinate label. The kind label now sits top-right, coordinates bottom-left.)

## Model change

`TileCell.signals` changes from `boolean` to `Port[]` — the exit ports that carry
a signal:

```ts
export interface TileCell {
  connections: PortPair[];
  role?: "depot";
  signals?: Port[]; // was: boolean
}
```

- `expandKind(kind, rotation, { signals: true })` keeps its meaning: it expands to
  **both** non-Center ports of the cell, so the default level is unchanged.
  `signals` may also be given an explicit `Port[]`.
- The simulation already computes `signalAspect(tileId, exitPort)` and manual
  holds **per exit port**, so no sim logic changes. `game.ts` derives
  `signalTiles` from `signals?.length` and `signalExits(tileId)` returns
  `tile.signals ?? []` (instead of all ports from rotation).
- `Tile.vue` renders one signal per port in `tile.signals` (instead of all exit
  ports when a boolean was set).

**Accepted approximation:** a tile carrying any signal remains a block boundary
for *both* directions (`isBoundary` stays tile-level). The visible, controllable
signal is per-direction; making block boundaries fully directional is a larger
sim change, deferred.

## Editor: edit the Level directly

The editor's source of truth becomes a reactive **`Level`** (each cell's
`connections` / `signals` / `role`), edited by explicit gestures. Auto-tiling
(`deriveConnections`/`deriveLevel`) no longer drives manual editing — it remains
only inside the procedural generator. Nothing connects unless the user draws it.

Pure, unit-testable reducers operate on a single cell (no DOM):

```ts
// src/tiles/editOps.ts
toggleConnection(cell: TileCell, a: Port, b: Port): TileCell   // add if absent, remove if present (samePair)
removeConnection(cell: TileCell, a: Port, b: Port): TileCell
setDepot(cell: TileCell, facing: Port): TileCell               // connections [[facing, Center]], role "depot"
rotateDepot(cell: TileCell): TileCell                          // cycle facing N->E->S->W
toggleSignalPort(cell: TileCell, port: Port): TileCell         // add/remove port in signals[]
```

`role` is derived: a cell is a depot iff it has a Center connection (the depot
tool is the only thing that creates one).

### Tools

A toolbar selects the active tool:

- **Connect** (default): each cell shows 4 edge dots (N/E/S/W). Drag from one dot
  to another **within the same cell** to add that connection (`toggleConnection`).
  Click an existing drawn connection (its hit-path) to delete it. The Center dot
  is not used here (depots are the Depot tool's job).
- **Depot**: click an empty/any cell to place a depot (`setDepot`), facing the
  first adjacent cell that has track on the shared border, else Top. Clicking an
  existing depot rotates its facing (`rotateDepot`).
- **Signal**: click a port dot of a cell to toggle a signal for that exit
  direction (`toggleSignalPort`).
- **Erase**: click a cell to delete it entirely.

### Rendering / interaction

Each grid cell renders `Tile.vue` for visuals (read-only; `pointer-events: none`)
with an interactive SVG **overlay** on top:

- Connect mode: circles at the 4 edge ports; `mousedown` on a port records
  `{cell, port}`, `mouseup` on another port of the same cell commits the
  connection. Existing connections are drawn as thick transparent hit-paths
  (`segmentPathD`) that delete on click.
- Signal mode: clicking a port circle toggles its signal; ports with a signal are
  marked.
- Depot / Erase mode: a single click on the cell applies the op.

Editor `Level` state autosaves to `localStorage`; Export/Import (JSON of the
`Level`) and the existing Random map + "Play this" actions stay. "Play this"
builds routes by pairing depots and hands the `Level` + trains over via
`levelStore` exactly as today.

## Out of scope / deferred

- Fully directional block boundaries (see approximation above).
- Multi-cell drag-to-draw a whole rail in one stroke (per-cell drawing only).
- Per-connection styling, undo history beyond per-op edits.

## Testing

Unit (Vitest):
- `signals: Port[]` round-trips through `expandKind` (boolean → both ports) and
  `kindOf` is unaffected.
- `editOps` reducers: toggleConnection adds then removes (order-independent),
  setDepot/rotateDepot produce the right facing + role, toggleSignalPort adds and
  removes a port.
- Generator and validator unchanged (existing tests stay green).

e2e (Playwright):
- Connect mode: draw a horizontal line across cells (drag W→E per cell), cap with
  depots via the Depot tool, the level validates, Play runs it.
- Signal mode: click a port, a signal appears on that tile.
- Delete: drawing then clicking a connection removes it.

## Files

- Modify: `src/tiles/model.ts` (`signals: Port[]`), `src/tiles/kinds.ts`
  (expand `signals`), `src/game.ts` (signalTiles/signalExits), `src/levels/default.ts`
  (uses `{ signals: true }` — unchanged), `src/components/Tile.vue` (render
  `signals` ports).
- Create: `src/tiles/editOps.ts` + tests.
- Rewrite: `src/views/EditorView.vue` (direct-`Level` editing + overlay + tools).
- Likely unused after rewrite: `deriveLevel` in `autotile.ts` (keep
  `deriveConnections`, used by the generator; remove `deriveLevel` + its spec if
  no longer referenced).
