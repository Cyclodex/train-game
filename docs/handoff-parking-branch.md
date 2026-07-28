# Handover — the parking branch

For a fresh session (cloud or local) picking this up cold. Written 2026-07-27,
brought up to date 2026-07-28 when the outstanding work was finished.

---

## 0. Before anything else

**Branch:** `claude/cloud-session-clone-start-3jjyg7`. It contains
`claude/auto-parking-system-b7d52c` in full, so that branch is history now.

Work on this line has repeatedly finished with commits that were **not yet on the
remote** — a cloud session clones from the remote and would silently redo them.
Check before you start:

```bash
git fetch origin
git status -sb          # "ahead N" means N commits exist only locally
git log --oneline -5
```

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
model the router reads, an editor tool, and nine test scenarios.

Read these two, in this order, before touching anything:

1. `docs/KNOWHOW.md` → the **PARKING** section. Dense, and it already records
   every trap this feature has produced. Several were found twice because
   somebody skipped it.
2. `docs/handoff-parking-next.md` — what the four outstanding pieces WERE, what
   they measured, and the two things still open.

Where the code lives, and why it is split that way:

| file | question it answers |
|---|---|
| `src/tiles/parking.ts` | where bays ARE (data + geometry, no state) |
| `src/tiles/parkingGeometry.ts` | what they LOOK like (SVG paths) |
| `src/components/TileParking.vue` | drawing them (three z-layers, one `layer` prop) |
| `src/sim/parking.ts` | which are TAKEN (the registry) |
| `src/sim/roadParking.ts` | what a car DOES about them (the phases) |

---

## 2. Where it stands

Everything in the brief is built. In order:

- **Parking is out of `Tile.vue`** (2346 → 2028 lines). `TileParking.vue` takes a
  `layer` prop and is placed three times: `apron` under the road's own markings,
  `paint` over them, `sign` outside the SVG. Verified as a move, not a rewrite —
  see the note on pixel comparison below.
- **Backing into a 90° bay is live**, on a pivot arc, and the driver preference
  decides. Echelon stays nose-in, for a geometric reason worth reading.
- **A leaver has no right of way**, with a serialised courtesy yield.
- **Reversing is driven at 0.55 of the forward crawl**, per leg.
- **The echelon apron is square** and a packed rank reaches the tile seam.

Two things are open and both are recorded in `handoff-parking-next.md` → *What is
still open*: a −2.10px echelon nose-in clip on parkvariants, and the fact that a
single-lane aisle deadlocks at 2.5× the shipped car density (it did before this
work too).

---

## 3. How to work here

```bash
npm ci                 # .npmrc sets ignore-scripts
npm run test:unit
npm run build          # vue-tsc + vite; the fastest correctness gate
npm run probe          # render-level audit of all 91 scenarios in a real browser
npm run shot -- <id> --label after --port 5190
```

`npm run browsers` now maps every platform, but a cloud session usually needs
nothing: `scripts/browser.mjs` falls back to whatever Chromium the container
already ships and PRINTS which one it used.

**A SHOT IS NOT REPRODUCIBLE PIXEL-FOR-PIXEL WHILE TRAFFIC MOVES.** The render
loop steps on wall-clock time, so two runs of an unchanged tree differ by ~24.7k
pixels on `parkvariants`. To compare paint, use `--density 0` AND take a
same-code control diff to establish the floor. Without the control number,
"pixel-identical" is unfalsifiable.

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
  swept-clearance test, the no-spin test, the leaver-wait test and the
  reverse-pace test. Keep them all green. Its long tests are budgeted for a
  shared container, not a laptop — a timeout there is a slow box, never a bug.

**Pages that show the work** — the dev server is usually 5173:

- [Every parking variant](http://localhost:5173/#/test/parkvariants) — the gallery
- [Kerbside bays, 2+2](http://localhost:5173/#/test/parkingkerb)
- [Car park + garage](http://localhost:5173/#/test/parkinglot)
- [Echelon rank across a seam](http://localhost:5173/#/test/parkechelon)
- [Lorry + bus lay-bys](http://localhost:5173/#/test/parkinglorry)
- [Bus halt vs lay-by](http://localhost:5173/#/test/busstops)
- [One bus, one bay](http://localhost:5173/#/test/buslayby)
- [The city](http://localhost:5173/#/test/parkcity)

---

## 4. Things the user has asked for that are settled

Do not re-open these; they were decided with the numbers in hand.

- **Forward parking when the geometry allows it, reverse only when forced.** For
  a kerbside bay `canNoseIn` decides, not the driver.
- **Backing in was wanted for 90°/echelon too.** It ships for 90°. It does not
  for echelon, and that is geometry rather than an unfinished curve — a
  forward-raked bay backed into leaves the car facing the wrong way up a one-way
  aisle.
- **Hand back the links.** Every task ends with the URLs of the pages that show
  the work, as markdown links, never in a code fence. This is in `CLAUDE.md`.
