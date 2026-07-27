# Parking — the next four pieces

Handoff for a fresh session. The parking layer shipped and works; these are the
four things left, in the order they should be done. Everything here was measured
in the session that wrote it, so **the numbers are real and are the acceptance
criteria** — do not re-derive them by eye.

**Read first:** `docs/KNOWHOW.md` → the PARKING section. It is dense and it
already records every trap this feature has produced. Several of them were found
twice because someone skipped it.

**Branch:** `claude/auto-parking-system-b7d52c` (based on `claude/terrain-world`).

**Maps to work against**

- [Every parking variant](http://localhost:5173/#/test/parkvariants) — the gallery
- [Kerbside bays, 2+2](http://localhost:5173/#/test/parkingkerb)
- [Car park + garage](http://localhost:5173/#/test/parkinglot)
- [The city](http://localhost:5173/#/test/parkcity)

**How to verify** — in this order, every time:

```
npm run test:unit
npm run build
npm run probe
npm run shot -- <scenario> --label after --port 5190
```

`npm run shot` starts its own dev server on 5181 with `--strictPort`; if another
worktree holds that port it now says so, but pass `--port` anyway.

---

## 1. The pivot-arc reverse (unblocks reverse-parking for 90°/echelon)

**State.** Backing into a *kerbside* bay ships and works: `canNoseIn` in
`sim/parking.ts` decides by geometry (free space ahead → nose in, otherwise
reverse in), and it took the swept penetration into a parked neighbour from
−7.6px to +0.1px on `parkingkerb` with no throughput cost.

Backing into a **90° or echelon** bay is built but **deliberately not live**
(`roadParking.ts` → `beginEntering`, the `style` line). It measures worse than
nosing in:

| bay | forward (2 neighbours) | reverse |
|---|---|---|
| 90° | +3.3 / +0.1 px | −3.3 / −5.6 px |
| echelon | −2.3 / +0.3 px | −8.6 / −15.0 px |

Widening the aisle barely helps (−5.6 → −1.8 with 42px more), so it is **not a
clearance problem**.

**Why it fails.** The reverse leg is a cubic Bézier laid between two known
tangents — down the lane at one end, along the bay axis at the other. That curve
*bulges across the bays either side*. A real reverse pivots: the rear enters the
space while the **front swings out through the aisle**, about a centre roughly
abeam the space. A Bézier between two tangents cannot express that.

**The job.** Replace the reversing leg with a **pivot arc**: a circular arc of a
plausible turning radius about a centre abeam the bay, entered tangentially from
the lane. `ManoeuvrePath` is already a list of `ManoeuvreLeg`s with a `reverse`
flag and a shared arc-length table (`tiles/parking.ts`), so a new leg *shape* is
the only new thing — the phase machine, the pace and the rendered heading all
fall out unchanged. Consider whether the leg type should become a union
(`{kind:"bezier"} | {kind:"arc"}`) or whether an arc approximated by two cubics
is enough; measure before deciding.

**Acceptance.** The swept-clearance test in `tests/unit/sim/parking.spec.ts`
(`never drives a manoeuvre through a car that is already parked`) must stay at
zero penetration with the preference switched ON for turning kinds, and the
long-run liveness test must still pass. Then delete the gate and let
`car.reverseParker` decide — the trait is already drawn from its own RNG stream
(`parkerRng`) so turning it on shifts no other seeded sequence.

**Pay-off to keep:** a car that backs in drives out **forwards**. That already
works — `exitsForward(kind, enteredReverse)` and `car.parkedReverse`.

---

## 2. A car leaving a bay has no right of way

**State.** Today a car whose dwell ends CLAIMS its lane slot at full body length
and traffic brakes for it. That is effectively priority, and it is wrong.

**The rule to build.**

1. Dwell ends → the car **waits in its bay**. Phase stays `parked`, so it has no
   road body and nobody brakes for it. `dwellLeft` keeps counting down past zero,
   so `-dwellLeft` is already "how long it has been waiting" — use that, do not
   add a timer.
2. It leaves only when the slot is **genuinely clear**, counted against real
   bodies **including stopped ones** (it has claimed nothing, so nobody is
   stopped "for" it).
3. **Courtesy:** after ~4s of waiting, the next approaching driver in that lane
   yields — bind its `clearAhead` distance to stop short of the leaver's slot.
   Expose the slot from the phase machine (it is `exitFor(...).endT + halfBody`,
   or the frozen peel-off point for a reverse-out) rather than recomputing it in
   `road.ts`.
4. Once it **commits and starts rolling** it claims the slot as today, and from
   that moment the existing rule applies again: a car stopped behind it is
   stopped *because of* it and is not an obstacle (`pullOutClear`).

**The trap, recorded so it is not rediscovered.** Making the claim conditional on
an existing gap *alone* was measured a no-win dial: 12 cars parked and 2 ever got
out. **The courtesy yield is the thing that makes the rule survivable** — without
it a leaver starves on any busy street. Build both together or neither.

**Acceptance.** Long-run liveness unchanged (>20 completed cycles per map, no
all-stop streak over 3s), and add a measure of the **worst wait between dwell-end
and rolling** — it should be seconds, not tens of seconds.

---

## 3. Reversing is much too fast

Reported by eye and correct. A reversing car currently moves at the same
`PARKING.speed × pace` as everything else. Reversing should be **visibly slower
and more careful** than driving in.

`ManoeuvreLeg.reverse` already exists, so the honest fix is a per-leg speed
factor: a reverse leg is driven at some fraction of the forward crawl. Do it in
`roadParking.ts` → `advanceParking`, where `step` is computed — it currently uses
one `pace` for the whole path, so it needs to become per-leg (ask the path which
leg `m` is on).

**Mind the interaction:** slowing the manoeuvre lengthens the time a car blocks
the lane, and this project has twice traded that badly. `parkingkerb` must keep
its ~75 completed park-and-leave cycles per run. If it drops, the compensation is
a shorter dwell on the demo maps, **not** a faster reverse.

---

## 4. The echelon (45°) apron does not line up

Reported as "the concrete does not match the lane". It is real and it is
`parkingApronPath` in `tiles/parkingGeometry.ts`.

Measured, 6 echelon bays on a 1+1 street (kerb 28, pitch 29, depth 42, tile 200):

```
apron  x[-21.0, 195.0]  y[128.0, 180.0]
bays   x[-21.0, 195.0]  y[138.0, 180.0]
```

Two separate things:

- **The apron is a parallelogram that overhangs the tile.** The echelon skew
  (`skew = depth`) shifts the near edge back by 21px and the far edge forward by
  21px, so the road-side edge runs −21 → 153 while the tile is 0 → 200. On a run
  of echelon tiles the aprons step past each other, and the last 47px of the
  tile's road edge has no apron at all. That is the mismatch you can see. Likely
  fix: clip the apron to the tile along the road axis (0..size) so consecutive
  tiles form one continuous strip, and check it against a 2-tile run.
- **A 10px band of apron with no bay on it** (`apronNear` 28 vs `bayNear` 38).
  That one is *by design* — it is the turn-in clearance being paved, see
  `apronNearPx` — but verify it reads as aisle and not as a misaligned edge once
  the overhang is fixed.

Check the 90° case too: it has the same 10px band and no skew, so it should look
right, but confirm rather than assume.

**Acceptance.** A screenshot of two adjacent echelon tiles with a continuous
apron, and `npm run probe` clean.

---

## Two things worth knowing before you touch any of it

- **Measure, do not eyeball.** Every number above came from sweeping oriented
  boxes (SAT) over the *rendered* poses. The helpers are in
  `tests/unit/sim/parking.spec.ts`. Three separate defects in this feature looked
  identical to a test that checked the designed curve rather than the driven one.
- **The registry sweep runs 40 simulated seconds** and cannot see a slow
  collapse. `parking.spec.ts` has a 200-second liveness test for exactly that —
  a total gridlock of `parkingkerb` once shipped green because the sweep's
  standstill predicate read `speed` (preferred cruise, never zero) instead of
  `velocity`.
