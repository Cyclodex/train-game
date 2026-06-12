# Junction lane capacity: deriving which lanes may turn where

Date: 2026-06-12
Status: approved (brainstormed with visual mockups, all cases user-confirmed)

## Problem

Junction lanes are hand-authored (`Lane.to[]`), and nothing stops two approach
lanes from turning into a one-lane destination — the cars' arcs cross, the
markings fan into confetti, and the sim funnels everyone into exit lane 0. The
1L→3L fan-out is equally undefined. We need the real-world rule.

## The rule (receiving capacity)

> Never more turning lanes toward a destination than the destination has
> receiving lanes — and every movement is lane-true (no crossing arcs).

Per approach with `N` lanes (inner = highest index, kerb = index 0) and present
movements Left / Straight / Right with receiving capacities `cL / cS / cR`
(receiving lanes of that arm, counted per vehicle class — see Bus lanes):

1. **Right block (kerb side, dedicated):**
   `nR = R ? max(1, min(cR, N − (L?1:0) − (S?1:0))) : 0`
   The kerb-most `nR` lanes turn right, lane-true (kerb→kerb, next→next
   receiving lane, concentric arcs). When the `max(1, …)` floor was needed
   (N too small for a dedicated lane), the single right lane SHARES with
   straight (kerb = S+R).
2. **Left block (inner side):**
   `nL = L ? max(1, min(cL, N − nR − (S?1:0))) : 0`
   The inner-most `nL` lanes turn left, lane-true (inner→inner receiving).
   Floored single left shares with straight (inner = L+S) **only when N ≤ 2**
   — on N ≥ 3 approaches the inner-most lane is a dedicated LEFT pocket
   (classic big-junction rule: a waiting left-turner must not block a through
   lane). A DUAL left (`nL ≥ 2`) shares straight onto the left lane CLOSEST to
   the straight block (index `N − nL`, the middle lane of a 3L→2L approach),
   mirroring the dual-right share — two through lanes survive, the inner-most
   stays the dedicated left pocket.
3. **Straight block:** the middle lanes between the blocks go straight,
   lane-true from the kerb side (kerb→kerb, index→index), capped at `cS`
   (kerb-side priority when dropping). Additionally the right-turn lane
   CLOSEST to the straight block (index `nR − 1`) shares S+R when straight
   capacity remains — for a single right turn that is the kerb lane, for a
   DUAL right turn it is the inner of the two right lanes (the middle lane of
   a 3L→2L approach), so two through lanes survive instead of one.
4. **Fan-out (1L approach / nearest-lane rule):** a movement always lands in
   its nearest receiving lane — right→kerb-most, left→inner-most,
   straight→kerb-aligned index. Wider destinations leave their middle lanes
   unfed at this junction (they fill via the cross street's turns, as in
   reality). No free fan-out, no occupancy-based lane choice (deliberately
   rejected: a car dodging onto the inner lane gets stuck before its next
   right turn — that needs cross-junction lane planning we don't want).

### Confirmed examples

| Approach | Arms (caps) | Result (inner → kerb) |
|---|---|---|
| 2L | S(2) R(1) | inner = S · kerb = S+R |
| 2L cross | L(1) S(2) R(1) | inner = L+S · kerb = S+R |
| 2L cross | L(1) S(1) R(1) | inner = L · kerb = S+R |
| 3L T | S(3) R(2) | inner = S · mid = R+S · kerb = R (dual right, mid shares straight) |
| 3L T | L(2) S(3) | inner = L · mid = L+S · kerb = S (dual left, mid shares straight) |
| 3L cross | L(any) S(≥2) R(1) | inner = L only · mid = S · kerb = S+R (single left even if cL ≥ 2) |
| 1L → nL | any | the single lane gets all present movements, nearest-lane landings |

## Bus lanes

- Capacities are **per vehicle class**: car derivation counts only non-bus
  receiving lanes and skips bus approach lanes entirely (a 3L arm with a kerb
  bus lane has car capacity 2; the cars' "kerb lane" is the kerb-most non-bus
  lane, its right turn crossing the bus lane inside the box, as in reality).
- `busTo` gates and `syncJunctionBusGates` stay as built; the car derivation
  runs first, the bus-gate sync after (both inside the editor's `commit()`).

## Components

1. **`deriveJunctionLanes(level, id)`** (pure, `src/tiles/editOps.ts`, next to
   `syncJunctionBusGates`): reads the junction's arms' widths from its
   neighbours, returns the re-derived `road` lanes per the rule. Idempotent;
   self-heals on editor load like the bus gates.
2. **Editor wiring:** `commit()` calls it for affected junctions before the
   bus-gate sync; `mounted()` heals all junctions once.
3. **Validator:** new check — per movement, count of feeding lanes ≤ receiving
   class capacity; flags hand-authored violations in scenarios.
4. **Markings / sim:** no new code — turn guides, debug arrows and exit-lane
   matching all read `Lane.to[]`, so they follow the derived data.
5. **Scenarios:** migrate hand-authored junction centres (crosslanes,
   turngallery, …) to the derived assignments in a follow-up commit on the
   same branch (validator drives the list).

## Testing

Unit tests assert exactly the confirmed-examples table (plus bus-capacity
variants); the scenario registry test keeps every map valid.
