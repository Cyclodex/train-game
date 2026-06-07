# Road Network — Sub-project Progress

## Vision (Transport-Fever-like, ordered by dependency)

| # | Sub-project | Status |
|---|---|---|
| A | Directed lane model (`Lane { from, to[], index, kind? }`) | **Done — merged to `develop`** |
| B+C | Multi-lane roads (render + sim) | **Done — on branch, not yet merged** |
| D | Junction turn restrictions / one-way | Effectively done as part of A; editor UI still JSON-only |
| E | Lane attributes (bus lanes; `kind` field exists, unenforced) | Not started |
| F | Route planner v2 (lane + restriction aware) | Not started |
| G | Lane switching (overtake, pre-turn positioning) | Not started |

---

## Sub-project A — Directed Lane Model (done, merged)

Replaced undirected `PortPair[]` with `Lane[]` (`{ from, to[], index, kind? }`).
One-way roads and per-junction turn restrictions work end-to-end.

Key files: `src/tiles/lanes.ts`, `src/sim/road.ts`, `src/sim/roadPlanner.ts`
Spec: `docs/superpowers/specs/2026-06-06-directed-lane-road-model-design.md`
Plan: `docs/superpowers/plans/2026-06-06-directed-lane-road-model.md`
Test scenarios: `roadoneway`, `rightturncross`, `noleftturn`

---

## Sub-project B+C — Multi-Lane Roads (done, awaiting merge)

Branch: `worktree-road-junction-routing`
Tests: 473 unit tests green, build clean.

### What was built

- `laneCount(road, from)` — derives lane count per approach from `max(lane.index)+1`
- `nWayLanes(a, b, count)` — generates N bidirectional lane slots
- `Car.laneIndex: number` — physical lane slot, assigned at spawn/route-plan
- Per-lane car following: cars only block cars in the same lane
- `conflictKey` lane-indexed: parallel lanes cross junctions independently
- Road surface width scales to `(lanesA + lanesB) × 28px` per edge in `Tile.vue`
- Per-car visual offset: `(laneCount - 0.5 - laneIndex) × LANE_WIDTH_FRAC × tileSize`
- Lane markings: solid yellow centre divider + dashed white between-lane lines
  (straight tiles only; curved tiles get centre divider only — parallel Bézier
  offsets are skipped as complex)
- `migrateLevel()` in `levelStore.ts` — converts old `PortPair[][]` localStorage
  format to `Lane[]` on read (fixes `/play` and `/editor` crashes from stale data)
- Test scenarios: `roadtwolane` (updated), `roadmultilane` (3 lanes/dir),
  `roadlanemerge` (2-lane tiles → 1-lane tiles)

Plan: `docs/superpowers/plans/2026-06-06-multi-lane-roads.md`

### Known follow-up (not blocking merge)

No smooth visual taper where a 2-lane tile meets a 1-lane tile — each tile
derives its own surface width independently. Simulation is correct across the
merge; this is cosmetic only. Options when addressing: transition tile art,
SVG clip/mask blending at tile edges, or accept as-is for a tile-based game.

### To finish

Choose one:
1. Merge to `develop` locally
2. Push and create a Pull Request
3. Keep branch as-is
4. Discard
