# Turn-aware lane discipline for cars — design

## Problem

Approaching a junction, a car often sits in the wrong lane: it stays kerb-most
(right) even when it will turn **left** at the next junction, then cuts across
the box. Real lane discipline ("move left to turn left, keep right otherwise")
is missing.

The machinery to fix this already exists. `desiredLane()` in `src/sim/road.ts`
already looks ahead `TURN_LANE_LOOKAHEAD = 4` tiles to the next junction
(`junctionAhead`) and tries to position the car in a lane permitting its turn.
But it only commits to a specific lane when the junction has **dedicated** turn
lanes — i.e. when `lanesAllowingExitFor()` returns a strict *subset* of the
approach lanes. On an ordinary multi-lane road where **every** lane may legally
turn either way, it picks the lane *nearest* the car's current one, which is a
no-op: the car stays where it spawned. There is also no active keep-right
default — with no near junction the car simply holds its current lane.

## Goal

1. **Directional lane choice** that applies even when all lanes are legal:
   left turn → innermost lane, right turn → kerb-most lane, straight →
   keep-right.
2. **Keep-right default** so multi-lane roads run right-aligned like a motorway
   when no junction is near; overtaking still pulls cars out and back.
3. Preserve everything already working: dedicated turn-lane pockets, the 1→3
   `pendingExitLane` exit-lane fan-out, bus-lane riding, the bus
   no-oscillation guard, and merge/lane-drop priority.

Non-goals: no new tuning constants, no change to `TURN_LANE_LOOKAHEAD` (4 tiles
stays — within the user's "3–5 tiles" ask, kept as a hard on/off window), no
change to the lateral easing / gap-acceptance machinery (`updateLateral`).

## Design

All changes are in `desiredLane()` (`src/sim/road.ts:850`). The precedence
order is unchanged; two of the existing branches change behaviour. Reuses
existing helpers — no new lane math:

- `turnKind(entryPort, exitPort)` (`src/tiles/lanes.ts:218`) → `"left" |
  "right" | "straight"`.
- `kerbMostLane(road, from, cls)` (already used by the overtake "returning"
  phase).
- `lanesAllowingExitFor(road, from, exit, cls)` (already computes `allow`).

### Precedence in `desiredLane` (order unchanged)

1. On a junction tile → committed to the turn (`clampLane(cur, …)`). Unchanged.
2. Lane-drop merge (G): next tile has fewer lanes → merge to innermost
   surviving lane. Unchanged (urgent, wins).
3. Overtake `passing` / `returning` → pass lane / kerb-most. Unchanged.
4. **Junction turn → directional pick.** CHANGED (see below).
5. `pendingExitLane` settle (gated `!ahead`). Unchanged.
6. Bus-lane preference. Unchanged.
7. **Keep-right default.** CHANGED (see below).

### Branch 4 — directional pick (the main change)

Inside the existing `if (ahead)` block, `allow =
lanesAllowingExitFor(jTile.road, ahead.entry, myExit, cls)` is already
computed. Replace the "nearest permitted lane to `cur`" selection with a pick
keyed on the turn direction:

```
const kind = turnKind(ahead.entry, myExit);
// among lanes that permit the movement:
//   left  → innermost permitted (highest index)
//   right → kerb-most permitted (lowest index)
//   straight → kerb-most permitted (keep-right)
const pick = kind === "left" ? Math.max(...pool) : Math.min(...pool);
return clampLane(pick, curCount);
```

Where `pool` keeps the existing bus rule: a bus prefers a bus lane among the
permitted lanes (`busAllowed`), otherwise `pool = allow`. The directional pick
then runs over `pool`.

Why this subsumes dedicated turn lanes: a dedicated left pocket gives `allow =
{innerLane}`, so `Math.max` selects that pocket; a right-only lane gives `allow
= {kerb}`, so `Math.min` selects it; straight-only middle lanes give their own
single index. The unrestricted case (`allow` = every car lane) is the new
behaviour: left → max index (inner), right/straight → min index (kerb).

Bus no-oscillation guard: the current code returns even when `best === cur` to
avoid a bus being dragged back onto a kerb bus lane every tick. The directional
pick preserves this — it always returns a definite lane from `pool`, and for a
bus turning where the bus lane can't feed the turn, the bus lane is absent from
`pool`, so the pick is a non-bus permitted lane and does not oscillate.

### Branch 7 — keep-right default

The final fallthrough today is `return clampLane(cur, curCount)` (hold current
lane). Change it to:

```
return clampLane(kerbMostLane(tile?.road, head.entryPort, cls), curCount);
```

so a car with no near junction actively eases toward the kerb. This sits AFTER
the `pendingExitLane` settle and the bus-lane preference, so:

- the 1→3 cross exit-lane fan-out (branch 5) still spreads traffic correctly
  right after a junction;
- a bus still rides its bus lane (branch 6);
- only a plain car with nothing else to do drifts right.

Overtaking is unaffected: it is handled in branch 3 (above this), and
`considerOvertake` still pulls a held car out into the pass lane and back.

### Spawn lane

`preferredSpawnLane()` (`src/sim/road.ts:955`) currently returns `-1` (no
preference, even spawn fill) when the junction is unrestricted, to avoid every
car piling into lane 0. With directional discipline now doing the sorting on
the approach, this stays as-is: the car spawns wherever the rotating filler
puts it, then sorts into the correct lane within 4 tiles. No change needed.
(If review finds cars don't have room to sort from the far lane on very short
spawns, a follow-up can extend `preferredSpawnLane` to honour `turnKind`; left
out of this change to keep it minimal.)

## Test scenario (project rule)

Add `src/levels/test/scenarios/laneDiscipline.ts` and register it in the
road → junctions category of the `DOMAINS` tree
(`src/levels/test/index.ts`):

- A multi-lane straight approach (≥2 car lanes) into an **unrestricted**
  junction (every lane may turn), with a route that turns **left** — so the car
  is seen crossing to the inner lane before the box, not cutting across it.
- A second route turning right / going straight to show the kerb-most /
  keep-right pick.
- Kept as small as the mechanic allows.

The registry test `tests/unit/levels/testScenarios.spec.ts` validates the map
(connectivity, route reachability, trains/vehicles, grid fit) automatically.

## Verification

- `npm run build` (vue-tsc + vite) — type + compile gate.
- `npm run test:unit` — existing road/lane math stays green; add a focused unit
  test asserting `desiredLane` (or an extracted pure helper) returns the inner
  lane for a left turn and the kerb lane for right/straight on an unrestricted
  multi-lane approach.
- `npm run shot -- laneDiscipline --label before|after` — before/after pair
  (debug overlay on, flat backdrop) showing the car in the correct lane on the
  approach.

## Implementation amendment (what actually shipped)

Branch 4 (directional pick) shipped as designed and is the core fix.

**Branch 7 keep-right was NOT shipped as a blanket `kerbMostLane` pull.** During
implementation the aggressive always-on version broke five existing road tests,
two of which encode invariants we must keep:

- `fans 1→3: a left-turner reaches the inner lane …` — the matched exit lane must
  hold across the exit arm.
- `overtakeloop: a ramp car lands ON its merge lane — no dip to the kerb and back`
  — a **user-reported** regression; the blanket kerb-pull yanks a freshly-merged
  car off lane 2 and re-creates the exact "dip" that bug fixed.

The only non-regressive way to keep an always-on kerb-pull is to hold the matched
exit lane across the whole arm (sticky `pendingExitLane`), which in turn suppresses
buses drifting onto bus lanes — a cascade of risk for marginal benefit.

Decision: keep-right is delivered where it is correct — branch 4 already sorts
straight/right movements to the kerb on a junction **approach**, `junctionExitLane`
kerb-aligns straight-through exits, and overtake-return pulls a passer back — so the
branch-7 fallthrough stays `return cur` (hold the lane the last movement set). A car
between junctions therefore keeps its lane (after a straight/right it is already
kerb-most; after a left turn it holds the inner lane until the next approach re-sorts
it), instead of weaving. This honours "keep-right is generally OK" without the dip.

A blanket "drift any inner-lane car to the kerb on a junctionless stretch" remains
possible as a follow-up if desired, but requires the sticky-exit-lane + bus-reorder
work above and test updates; deliberately out of scope here.

## KNOWHOW upkeep

Add one line under ROADS in `docs/KNOWHOW.md`: lane discipline on an approach is
turn-keyed (`desiredLane` + `turnKind`): left→inner permitted lane,
right/straight→kerb-most; keep-right is the default with no junction near;
dedicated turn-lane pockets fall out of the same `allow`-set pick. Overtake and
`pendingExitLane` still take precedence.
```
