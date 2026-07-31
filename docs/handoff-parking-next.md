# Parking — the four pieces, and what became of them

All four shipped on 2026-07-27/28. This file is kept as the RECORD: what was
built, what it measured, and the two things it turned up that are still open.
The dense canon lives in `docs/KNOWHOW.md` → PARKING; read that first, this is
the story of one session.

**Branch:** `claude/auto-parking-system-b7d52c` (rebased onto the terrain
roadmap 2026-08-01; the parking commits are the tip).

**Maps**

- [Every parking variant](http://localhost:5173/#/test/parkvariants) — the gallery
- [Kerbside bays, 2+2](http://localhost:5173/#/test/parkingkerb)
- [Car park + garage](http://localhost:5173/#/test/parkinglot)
- [Echelon rank across a seam](http://localhost:5173/#/test/parkechelon) — new
- [The city](http://localhost:5173/#/test/parkcity)

**How to verify** — in this order, every time:

```
npm run test:unit
npm run build
npm run probe
npm run shot -- <scenario> --label after --port 5190
```

A cloud session does NOT need `npm run browsers` any more: `scripts/browser.mjs`
falls back to whatever Chromium the box already has and says which it used.

---

## 1. The pivot-arc reverse — DONE

Backing into a 90° bay is live and the driver preference (`reverseParker`)
decides. The reverse leg is no longer a Bézier between two known tangents: the
car pulls one length past the bay, reverses through a quarter circle of that
radius about a centre abeam it, then reverses straight the rest of the way in
(`pivotReverseLegs` in `tiles/parking.ts`). The straight finish is what keeps the
pull-past at a car's length — a pure quarter circle needs the whole lateral shift
(48–62px) and runs off the end of a packed tile.

No new leg type: a cubic approximates a quarter arc to a hundredth of a pixel at
these radii, so `bezierAt` / `buildArcTable` / `locate` are untouched.

Measured, 3000 ticks × 2 seeds: parkinglot 0 → 19/10 reverse parkers with swept
clearance unchanged at +0.02px; cycles 34/40 → 32/39, parkcity 23 → 20. A reverse
takes longer than a nose-in and that is the price.

**ECHELON IS NOSE-IN ONLY, and that is geometry.** The bay is raked FORWARD, so a
car backed into one rests facing back up the aisle it came down, and a far-bank
rank is only legal on a one-way aisle. The recorded "reverse measures −8.6/−15.0px
there" was that fact showing up as a swept overlap, not a curve waiting to be
written. `canReverseIn` says so; `canNoseIn` now hems in kerbside bays alone.

**The 180° spin this turned up.** The entry curve and the exit curve each decided
for themselves which way a parked car faced, and disagreed: every reverse-parked
kerbside car spun 180° on the tick its dwell ended and unwound another 102° as
its looping exit straightened. 47 jumps over 25° on parkingkerb seed 1, worst
180.0°; now worst 26.3°. One answer, `parkedHeadingDeg`, and both curves ask it.

## 2. A car leaving a bay has no right of way — DONE

It waits IN the bay (phase stays `parked`, no road body, nobody brakes for it)
and claims its slot only when the slot is genuinely clear. `-dwellLeft` is the
wait; `cars()` exposes it.

The courtesy yield after 4s is the other half, and it is serialised: ONE leaver
at a time per car park. Bays are 28px apart and a car is 38px long, so on a rank
of 90° spaces every place a yielding driver can stop is inside SOME neighbour's
slot — three asking at once deadlocked parkinglot for 88 seconds.

Measured at shipped density, 12 runs: worst wait 1.4–9.6s, average 0.7–2.4s, no
all-stop, throughput unchanged (606 cycles against 610). At 2.5× traffic the
courtesy halves the average wait (10–13s → 2.9–5.8s) at a throughput cost.

## 3. Reversing is much too fast — DONE, twice

The first ship (2026-07-27) multiplied `REVERSE_PACE` onto the pace-scaled
speed, and the two cancelled: `pace` speeds a path up in proportion to its
length, the pivot-reverse path is long (pace ≈ 3–4), so cars still backed into
bays at up to twice the crawl. The user reported it verbatim the next day.

Now (2026-07-28) a backing leg is an ABSOLUTE speed: `REVERSE_PACE` 0.75 × the
0.16 t/s base crawl = 0.12 t/s, with `clampToDirectionChange` stopping the step
at a leg join so the straddling tick cannot run at the old leg's speed. Slowing
the reverse made several leavers ready at once, which exposed two liveness bugs
in item 2's courtesy machinery (a float knife-edge on the stop line, and the
phantom-claim ordering disagreeing with the courtesy ordering) — both wedged
whole maps permanently and both are fixed; see KNOWHOW → PARKING. The guard test
measures the rendered body's MIDPOINT (the nose legitimately sweeps faster on a
curved leg) and asserts median = cap.

## 4. The echelon apron — DONE

It is a rectangle now, and a packed row reaches the tile seam (`apronSpan`, the
one answer shared by the apron and its kerb line). `/test/parkechelon` is the new
scenario: two tiles of 45° bays on both banks, which is the smallest thing that
can have a SEAM. Before/after in `docs/verify/echelon-apron`.

---

## What is still open

Two things, both measured, neither invented by the work above.

- **parkvariants seed 1 sweeps −2.10px** on tile 1,1: a car NOSING into an echelon
  bay clips its parked neighbour. Identical before and after the pivot work — it
  is the "−2.3px echelon forward" already in the canon, and the only manoeuvre
  overlap left on the parking maps. parkvariants is deliberately NOT in the swept
  test's guarded set because of it.
- **A single-lane aisle deadlocks under saturation.** At 2.5× the shipped car
  density parkinglot gridlocks, and it did so BEFORE any of this (122.6s of
  all-stop on the baseline). Do not read a heavy-density gridlock there as one of
  these rules misbehaving. If it is ever worth fixing, the fix is capacity — a
  second lane or a shorter rank — not another gate.
