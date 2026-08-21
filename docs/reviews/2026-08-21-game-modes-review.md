# Game modes review — 2026-08-21

The mode-roster deep review (session `game-modes-maps-review`), committed here
so other sessions can read it; GitHub issues are the canonical tickets.

## Outcome (implemented, stacked PRs #120 → #121 → #124)

- **#115 / PR #120** — `/test/challenges/modes` is one demo per mode, each
  RUNNING its mode; Tycoon deep-dives moved to `challenges/economy`; the /test
  stage got a live objective strip (timer, star pips, Won/Lost).
- **#113 / PR #121** — picker focused to five pillars: **puzzle, tycoon,
  network, citizens, sandbox**. Daily = unregistered BOARD SOURCE
  (`?board=daily`, "Today's challenge" chip). Time Attack = unregistered
  puzzle VARIANT (a board whose trains carry `spawnAtSec` arms the spawner,
  backlog cap and rush stars from Puzzle itself). Crossing Keeper retired from
  the picker — its manual gate was never built (#112 parked).
- **#114 / PR #124** — board↔mode compatibility DERIVED from tiles
  (`modes/compat.ts` + per-mode `fits(caps)`): picker disables unfit cards
  with the missing requirement as reason and keeps `?board=` across mode
  switches; a URL guard resolves unfit pairs to the board's own mode. Boards
  stay multi-mode — compatibility filters, it never pins.
- **#119** — pre-existing red on master found during verification:
  `hinterlandTraffic` seed 11 deadlocks (40 frozen cars), independent of this
  work.

## Position: demand architecture (citizens XOR synthetic) — issue #117

Asked by the bicycle session (PR #102): does a Transport-Fever-shaped mode
need BOTH demand sources — simulated citizens riding buses/trains PLUS
external demand from off-map — or is today's XOR the right long-term shape?

**Facts, verified on master 372e1e9:**

- Demand is a per-mode XOR. Only `mode=citizens` passes `citizens:` into
  setup (`src/modes/citizens.ts`); `demandFor` (`src/game.ts` ~1285) then
  turns synthetic per-station demand OFF (interval = Infinity). Every other
  mode runs synthetic `stationDemandOf`/`busStopDemandOf` only.
- Buses (PR #97) carry the shared transit layer's abstract riders. Citizens
  cannot ride buses at all: their transit port binds to the RAIL sim only
  (`src/game.ts` ~1499-1503, `sim.enqueuePassenger` / `sim.serves`).

**Position: yes to coexistence, no to a third mode.** Long-term the XOR
should become additive — reinterpret synthetic demand as **edge demand**
(people from off-map) that a station carries ON TOP of its citizen catchment.
Citizens = demand the map explains; edge = demand the map imports. That
dissolves the double-counting objection the XOR guards against
(`src/modes/types.ts:60-63`), and it resolves the Network-vs-Citizens split
as **two objectives over ONE demand model** (scored target vs endless
population) — the Transport-Fever shape, without inventing a new mode.

**Ordering, so plans don't collide (tracked in #117):**

1. **#111 step 1 first** — citizens learn to ride buses: bind the citizen
   transit port to the shared transit layer (`src/sim/transit.ts`) instead of
   the rail sim. Citizens and abstract riders then become two rider sources on
   one carrier layer. Unifying demand BEFORE this would deepen the split
   (buses full of edge riders citizens can't board).
2. Then make `demandFor` additive: citizen catchment + optional per-station
   edge demand (a board/station dial, not a mode flag).
3. Then the #113 Network/Citizens decision falls out: one demand model, two
   objective flavours.

**#110 (round-trip contract) is orthogonal** — it changes trip legs, not
rider sources; no interaction with demand unification.

Short-term the XOR stays: it is honest today, and unification without #111
step 1 would make buses carry riders the citizens cannot join.
