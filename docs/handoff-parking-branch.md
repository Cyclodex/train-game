# Handover — the parking branch

For a fresh session (cloud or local) picking this up cold. Written 2026-07-27.

---

## 0. Before anything else

**Branch:** `claude/auto-parking-system-b7d52c`.

Work on this branch has repeatedly finished with commits that were **not yet on
the remote** — a cloud session clones from the remote and would silently redo
them. Check before you start:

```bash
git fetch origin
git status -sb          # "ahead N" means N commits exist only locally
git log --oneline -5
```

If you are on a fresh clone and the log does not end with a merge of master and
a parking commit, ask before doing anything — the work you need may still be
sitting on somebody's laptop.

**Merging master into this branch is a solved problem, and there is a tool.**
`.gitattributes` (LF everywhere) landed here but master's blobs are still CRLF,
so any file both sides have touched still comes out as ONE whole-file conflict.
The last two merges were resolved by comparing each side against the merge base
with the endings normalised and transplanting only where the change sets were
shown to touch DISJOINT regions — seven of eight files, mechanically, the eighth
(the scenario registry) by hand because both sides genuinely add to the same
lists. The commit messages of those two merges carry the per-file numbers.

---

## 1. What this branch is

A complete **parking layer** for the road simulation: kerbside bays, 90° and
echelon bays, underground garages with separate in/out ramps, lorry and bus
lay-bys, in-lane bus halts, reserved bay classes, a facility-level "is it full?"
model the router reads, an editor tool, and eight test scenarios.

Read these two, in this order, before touching anything:

1. `docs/KNOWHOW.md` → the **PARKING** section. Dense, and it already records
   every trap this feature has produced. Several were found twice because
   somebody skipped it.
2. `docs/handoff-parking-next.md` — **the four outstanding pieces of work**, each
   with the measurements that are its acceptance criteria.

Where the code lives, and why it is split that way:

| file | question it answers | lines |
|---|---|---|
| `src/tiles/parking.ts` | where bays ARE (data + geometry, no state) | 1354 |
| `src/tiles/parkingGeometry.ts` | what they LOOK like (SVG paths) | 347 |
| `src/sim/parking.ts` | which are TAKEN (the registry) | 503 |
| `src/sim/roadParking.ts` | what a car DOES about them (the phases) | 812 |
| `src/components/Tile.vue` | drawing it — **and this is the problem, see §2** | 2346 |

---

## 2. The task in front of you: get parking OUT of `Tile.vue`

**Why.** `Tile.vue` is 2346 lines and every branch in this project edits it. The
parking paint is ~350 of those lines, spread over four places. Merging master
into this branch conflicted on it, and the resolution took an hour.

**What that merge actually taught us** — worth knowing before you decide how to
split anything:

> With line endings normalised, our 12 changed regions and master's 15 had **zero
> overlap**. The conflict was not two people editing the same code; it was the
> file having different line endings on the two sides, which marks every line as
> changed on both. `.gitattributes` (commit `3d053c2`) fixes that class outright.

So the modularisation is **not** urgent for correctness. It is worth doing
because a 2300-line component is hard to read and because the next person to
touch parking paint should not have to open the file that draws rails, switches,
signals, depots and fare pins. Treat it as a tidy, not a rescue.

**The pieces to move** (line numbers as of `3d053c2`):

- template, ~23–110: the parking **apron** — painted UNDER the road's own
  markings, so it must stay early in the SVG
- template, ~113–150: the parking **bay lines**, **kerb line**, **garage ramps**,
  **bus-stop markings** — over the road paint
- template, ~323–336: the **facility sign** ("P 3/12", "P VOLL") — an HTML
  overlay above everything
- script: `parkingKerbFor` (~875), `parkingPaths` (~903), `parkingSign` (~962),
  and the parking imports
- style: the `/* --- Parking --- */` block at the end

**The design decision, and my recommendation.** The paint needs to sit in **two
different z-layers** (apron under the road markings, sign above the tile), so one
child component cannot simply be dropped in one place. Options:

- **One `TileParking.vue` with a `layer` prop** — `<TileParking layer="apron">`
  early, `<TileParking layer="paint">` after the road markings, `<TileParking
  layer="sign">` last. Geometry is recomputed per instance, which is a handful of
  path strings per tile and does not matter. **This is what I would do.**
- Two or three components sharing a `useTileParking(cell, coordId)` composable.
  Cleaner in theory; more moving parts for the same result.

Either way the geometry itself already lives in `tiles/parkingGeometry.ts` — the
component only assembles path strings, so this really is a move, not a rewrite.

**Acceptance.** `npm run probe` clean (it is a render-level audit and will catch
a z-order mistake), plus a before/after screenshot pair of
`/#/test/parkvariants` and `/#/test/parkinglot` that are pixel-identical.

---

## 3. Then the four parking pieces

All in `docs/handoff-parking-next.md`, in the order they should be done:

1. **The pivot-arc reverse** — unblocks reverse-parking for 90°/echelon bays.
   Backing into a kerbside bay already ships; the turning kinds are built but
   deliberately gated OFF because the Bézier version measures *worse* than nosing
   in. Numbers are in the brief.
2. **A car leaving a bay has no right of way** — it waits for a real gap, and a
   driver behind lets it in after a few seconds. Note the recorded trap: the
   gap-only version was measured a no-win dial (12 parked, 2 ever out).
3. **Reversing is much too fast** — needs a per-leg speed, and watch the
   throughput trade.
4. **The echelon apron overhangs its tile** — quantified in the brief; the
   parallelogram skew runs the road-side edge from −21 to 153 on a 200px tile.

---

## 4. How to work here

```bash
npm ci                 # .npmrc sets ignore-scripts, so browsers are NOT installed
npm run browsers       # once per machine, before probe or shot
npm run test:unit
npm run build          # vue-tsc + vite; the fastest correctness gate
npm run probe          # render-level audit of all 90 scenarios in a real browser
npm run shot -- <id> --label after --port 5190
```

A cloud session almost certainly needs `npm run browsers` before `probe` or
`shot` will work. Use `scripts/install-browsers.mjs` (that is what the script
runs) — **not** `npx playwright install`, which hangs during extraction on some
Windows machines and leaves a half-written browser directory.

**The measurement discipline this feature runs on.** Every number in the briefs
came from sweeping oriented boxes (SAT) over the **rendered** poses, not from
looking at a screenshot. The helpers are in `tests/unit/sim/parking.spec.ts`.
Three separate defects here looked identical to a test that checked the
*designed* curve rather than the *driven* one — if you change a manoeuvre, sweep
the sim, not the geometry.

**Two guards, and what each cannot see.**

- `tests/unit/sim/roadScenarioSweep.spec.ts` runs **40 simulated seconds** per
  scenario. It cannot see a slow collapse: a total gridlock of `parkingkerb` once
  shipped green because the collapse takes 50–120s *and* the standstill predicate
  read `speed` (preferred cruise, never zero) instead of `velocity`.
- `parking.spec.ts` has a **200-second liveness test** for exactly that, plus the
  swept-clearance test. Keep both green.

**Pages that show the work** — the dev server is usually 5173:

- [Every parking variant](http://localhost:5173/#/test/parkvariants) — the gallery
- [Kerbside bays, 2+2](http://localhost:5173/#/test/parkingkerb)
- [Car park + garage](http://localhost:5173/#/test/parkinglot)
- [Lorry + bus lay-bys](http://localhost:5173/#/test/parkinglorry)
- [Bus halt vs lay-by](http://localhost:5173/#/test/busstops)
- [One bus, one bay](http://localhost:5173/#/test/buslayby)
- [The city](http://localhost:5173/#/test/parkcity)

---

## 5. Things the user has asked for that are settled

Do not re-open these; they were decided with the numbers in hand.

- **Forward parking when the geometry allows it, reverse only when forced.** Not
  a driver preference for kerbside bays — `canNoseIn` decides.
- **Backing in was wanted for 90°/echelon too**, and it is built, but it is gated
  off until the pivot arc exists because the current curve measures worse. The
  `reverseParker` trait is drawn from its own RNG stream and is stream-stable, so
  turning it on later shifts no other seeded sequence.
- **Hand back the links.** Every task ends with the URLs of the pages that show
  the work, as markdown links, never in a code fence. This is in `CLAUDE.md`.
