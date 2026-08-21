# Where an informally parked car stands

**Status: option B implemented (2026-08-21, user-approved).** The pose:
`stallPose` centres an informal stall on the kerb line. The squeeze:
`game.ts updateRoadCars` eases passing traffic around informally parked cars
(read from `roadSim.informalParked()`), renderer-only, scaled away for inner
lanes and capped at 4px — the exact bound at which no body can cross the
centreline, per the proof in the code comment. Original report: an overflow
car standing ON the pavement of `/test/homeparking`; the debug ghosts
(dashed cyan stall boxes) make the cause visible on any board.

## Why it happens — two right decisions that collide

`stallPose` places every `parallel` stall `depth/2` BEYOND the kerb line
(`parking.ts:713`) — correct for a painted bay, which is a widening of the
street with the pavement moved out behind it. But informal kerb deliberately
paints nothing and moves nothing (the cross-section rule + commit 9e3d2a0's
"bare kerb moves nothing"). The numbers on a 1+1 street at the native tile:

    kerb at 28px from the centreline
    pavement band       kerb+8 … kerb+24
    informal car body   kerb+3 … kerb+23   ← on the band, almost exactly

Each rule is right alone; combined they stand the car on the pavement.

## What really happens on a street

A car left at bare kerb stands ON the carriageway hugging the kerb, or — on
narrow streets, everywhere in Europe — half on the kerb. Passing traffic
squeezes by, using the middle of the road. Streets too narrow even for that
are no-stopping zones.

## Sim constraints (measured, not guessed)

- A `parked` car without `parkOnLane` is INVISIBLE to moving traffic — every
  blocking gate keys on `parkOnLane` (`road.ts:1273`). Standing it on the
  carriageway does nothing until something reacts to it.
- The one on-lane precedent, the bus HALT, BLOCKS the lane behind it — right
  for a 20-second stop, fatal for a car parked for hours.
- There is no contraflow use and no obstacle-avoidance for parked bodies;
  overtaking is a same-direction lane-change machine.

## Options, with the numbers

**A. Half on the kerb.** Stall centre moves from `kerb + depth/2` to the kerb
line (or `kerb − 2px` to sit flush with the band's near edge). Works on every
street including a 1-lane one-way. Cost: the body reaches ~10px into the
carriageway, so a passing car clips it visually by ~6px on a 1+1 and on a 1L
one-way (traffic still flows — parked cars stay collision-invisible).

**B. A + the squeeze (recommended).** Same pose, plus a small lateral
avoidance shift for MOVING cars on a tile with an informally parked car on
their kerb side: ~6px toward the centre, eased in and out along the tile —
the exact mechanism `cycleStripShiftPx` already uses (sampling-side offset,
no routing, deterministic). Passing traffic visibly squeezes past, which is
what the real street does. On a 1L one-way the passer grazes the centre edge
by a pixel or two — accepted, and honest.

**C. Fully on the carriageway + real avoidance.** The most truthful: park in
the kerb lane, moving traffic treats the body as an obstacle (multi-lane:
overtaking; single-lane: wait or squeeze via contraflow). A genuine feature
with sim semantics to design (blocking vs avoidance vs contraflow). Later,
if ever — B delivers the picture at a fraction of the risk.

**D. Optional restriction.** Declare 1-lane one-ways no-stopping (skip them
in `deriveKerbOverflow`) if B still reads too tight there. Costs overflow
capacity on aisle-heavy boards; not needed unless the picture demands it.

## Recommendation

B, in two steps that are each verifiable alone: (1) the pose — informal
stalls centre on the kerb line, `/test/homeparking` before/after; (2) the
squeeze — passing cars ease around them. D held in reserve. C filed as the
long-term realism dial next to enforcement (IMPROVEMENTS.md).
