# Multi-tile route builder (editor) — design

Date: 2026-06-05
Status: approved (pending spec review)

## Goal

Let the level editor lay a **whole multi-tile rail route in one chained
gesture** instead of one intra-tile connection at a time. Click an edge to
start, then click tile after tile; each click drops a corner and the segments
between corners auto-route along the grid, previewing the rail the whole way and
building every connection on commit. This turns "lay a long L-shaped line" from
~15 clicks into 3, and is the foundation for later **impassable blocks** (the
router is designed to avoid forbidden cells from day one).

## Today vs. wanted

- **Today:** a connection lives inside one tile (`toggleConnection(cell, a, b)`),
  laid by click-click or click-drag between two edges of the *same* tile. Preview
  (`previewRails`) is per-cell and only spans one tile.
- **Wanted:** the second target can be a *different* tile. The router finds a
  path of cells from the open end to the target, previews rails across all of
  them (straights through, curves at bends), and on commit applies a connection
  in every cell. Repeatable: the head advances so you can keep extending.

## Interaction design

Two gestures, sharing one router + one preview:

### Click-click — chained "pen tool" (the new power feature)

1. **Start.** In the connect tool, click an edge triangle of a tile. This enters
   *route mode* with an **open end** `head = { id, edge }` — the edge the track
   will grow out of. The head tile gets a soft glow (reusing the armed-tile
   glow).
2. **Preview.** Hovering another tile auto-routes the **turn-minimizing shortest
   path** from `head` to that tile and ghost-previews the rail across every cell
   on the route. Which **edge** of the destination you hover sets the arrival
   edge, so sliding to a different edge of the same tile re-routes the preview.
   Hovering a *different edge of the head's own tile* previews a single
   intra-tile connection (the old behaviour, now the degenerate 1-cell route).
3. **Extend.** Click → commit the previewed segment's connections, then advance
   the head to the clicked tile/edge. Keep clicking to add segment after segment
   → long routes, Ls, staircases, combs.
4. **Finish.** A second click on the **head tile itself** (or `Esc`, or
   switching tools) ends route mode. The next click on a fresh tile starts a new
   route.

### Click-drag — one-shot single segment

Press an edge, drag, release on a tile/edge → builds exactly one segment (intra-
or multi-tile) with the same preview, **no chaining**. This keeps a fast path for
quick single connections; the chained pen tool is click-only.

### Crossings

The route **merges** into existing rails: each cell's connection is *added*
(idempotent), forming crosses / T-junctions where the route overlaps existing
track. It never silently removes an existing connection (see `addConnection`
below — we must NOT reuse `toggleConnection` here, or re-crossing a tile would
delete its rail).

## The router (pure, testable, obstacle-ready)

New module `src/tiles/routePlanner.ts`, plain TS, no Vue/DOM, unit-tested.

```ts
type OpenEnd = { id: string; edge: Port };          // tile + the open edge
type RouteStep = { id: string; a: Port; b: Port };  // connection to ensure in a cell

interface RouteOpts {
  width: number;
  height: number;
  // Future-proofing for "blocked" tiles: cells for which this returns false are
  // never entered by the route. Defaults to "everything passable".
  passable?: (coord: Coord) => boolean;
}

// Returns the ordered per-cell connections to build, or null if no route fits
// (e.g. blocked in, or the geometry is impossible). Endpoints included.
function planRoute(from: OpenEnd, to: OpenEnd, opts: RouteOpts): RouteStep[] | null;
```

### Algorithm

1. **Forced ends.** The track must leave `from.id` through `from.edge`, so the
   first move goes to the neighbour across `from.edge`. It must enter `to.id`
   through `to.edge`, so the last move comes from the neighbour across `to.edge`.
   (Both neighbours must be in-bounds and `passable`, else `null`.)
2. **Search the cells between** those two fixed neighbours with **Dijkstra / 0-1
   BFS over grid cells**, where step cost is `0` for continuing straight and `1`
   for a turn. Minimising turns yields clean Ls/Zs and few curves; ties broken
   deterministically (e.g. prefer the lower-`(y,x)` cell) so previews are stable.
   `passable` gates which cells may be entered — this is the single hook the
   future blocks feature flips.
3. **Emit a `RouteStep` per cell.** For each cell `ci` on the path, `a =` edge
   toward the previous cell (or `from.edge` for the very first cell), `b =` edge
   toward the next cell (or `to.edge` for the last cell). Opposite edges → a
   straight; perpendicular → a curve. Geometry then comes for free from the
   existing `railPathsFor` / `segmentPathD`, which already turn an edge pair into
   rails.

### Endpoint geometry (verify visually while building)

- **Degenerate 1-cell route** (head and target are the same tile, different
  edges): a single `{id, a: from.edge, b: to.edge}` — exactly today's intra-tile
  connection.
- **Free tail** (the very first click's edge) and **free head** (the current
  open end while it is still the last cell) are real edge↔edge connections whose
  outward edge is the clicked/hovered edge; they read as open track ends, not
  centre stubs. **Extending past the head upgrades** that tile's connection from
  a dangling end to a through/curve as the route continues — so the head tile is
  re-emitted by the next segment's `planRoute`.
- This is the fiddliest part; the rule above is the intended behaviour and will
  be confirmed by eye in the running editor, adjusting only the endpoint rule if
  it looks wrong.

## Editor integration (`EditorView.vue`)

- **State:** replace the single `armed` with route-mode state: `head: OpenEnd |
  null`, plus a derived **preview map** `previewByCell: Record<string, string[]>`
  (cell id → ghost rail `d`s) computed from `planRoute(head, hoverEnd)` whenever
  `head` and a hover exist. `pressFrom` still drives the one-shot drag.
- **`hoverEnd`:** the hovered `{ id, edge }`, set on zone `mouseenter`
  (already tracked as `hoverPort`; reused). Edge granularity already exists from
  the per-triangle zones.
- **Preview rendering:** `previewRails(id)` becomes a lookup into
  `previewByCell[id]` (still per-cell, so the existing overlay `<path
  class="preview-rail">` loop is unchanged) — the ghost now simply spans multiple
  cells because the map has entries for each.
- **Commit:** apply each `RouteStep` via the new idempotent `addConnection`
  (below); then advance `head` to `{ id: target.id, edge: hoverEnd.edge }`.
- **Finish:** clicking `head.id` again, `Esc`, or `setTool` clears `head`.
- The amber armed-tile glow follows `head.id`.

### `src/tiles/editOps.ts`

Add an idempotent adder used by the route commit (toggle would wrongly remove on
re-cross):

```ts
export function addConnection(cell: TileCell, a: Port, b: Port): TileCell {
  if (cell.connections.some(c => samePair(c, [a, b]))) return cell;
  return { ...cell, connections: [...cell.connections, [a, b]] };
}
```

## Files

- **New** `src/tiles/routePlanner.ts` — `planRoute` + helpers (pure).
- **New** `src/tiles/routePlanner.spec.ts` — unit tests.
- `src/tiles/editOps.ts` — add `addConnection`.
- `src/views/EditorView.vue` — route-mode state, multi-cell preview, commit,
  finish; drag still one-shot. Hints updated.

## Testing

- **Unit (`routePlanner.spec.ts`):** straight run; single L; Z (two corners);
  turn-minimisation (prefers the straighter of equal-length paths); destination
  edge changes the route; `passable` makes the router avoid a blocked cell and
  return `null` when fully walled off; out-of-bounds ends → `null`; degenerate
  1-cell route.
- **Build:** `npm run build` (vue-tsc) green.
- **Manual / browser:** start a route, chain a 3-down-then-right L, confirm the
  ghost spans all cells and commit builds straights + a curve at the corner;
  re-cross an existing rail → junction (not deleted); finish with a second click
  on the head; drag still builds a one-shot segment; no console errors.

## Future (designed-for, not built now)

- **Impassable blocks:** a tile role/flag whose cells make `passable` return
  `false`. The router already routes around them and reports `null` when boxed
  in; only the editor UI to mark blocks and the `passable` wiring are new.

## Out of scope

- Block-tile authoring UI, depot auto-attach at route ends, undo/redo, and any
  change to the running simulation (this is editor-only; it still emits the same
  `TileCell` connections the sim already consumes).

## Revision — as built (2026-06-06)

Interaction refined during implementation. The destination edge is no longer a
forced "exit" (which could wrap the route around in a loop). Instead:

- **Shortest approach, never forced.** `planRoute` takes the shortest, turn-
  minimising approach to the target tile regardless of the pointed-at edge.
- **Per-edge frontier shaping.** The tile under the cursor is drawn
  `incoming → pointed-at edge` for any of its three *exit* edges (straight or
  curve). Pointing at the **incoming** edge is a U-turn (impossible in one
  tile), so that tile is left **blank** and the head trails one tile back,
  letting your next click decide its shape — both preview and commit "draw only
  to the last exit node."
- **Idempotent merge** via `addConnection` so re-crossing forms junctions.
- **Finish** by clicking the head's open-edge wedge (shown as a distinct red,
  pulsing "stop" highlight) or pressing `Esc`; the still-pending frontier tile
  then locks as a plain straight terminus. A one-shot **drag** commits its whole
  route (no trailing).
- **Grid clarity.** Wedge (inner-edge) outlines are hidden by default and only
  revealed on the hovered tile, so the board reads as plain tiles until you work
  on one.

The pure `planRoute` contract and its unit tests are unchanged; all of the above
lives in `EditorView.vue`.
