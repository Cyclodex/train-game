# The street cross-section — parking, pavement, and who crosses whom

Date: 2026-08-20
Status: implemented
Replaces: the per-tile pavement outset from the 2026-08-05 parking-walk work
Follows: `2026-08-05-home-parking-design.md`

## The problem

> "the current solution looks fragile and makes the sidewalks not connected …
> in real scenarios there might be parkings at houses, where the car drives
> over the sidewalk. and in other areas there are parkings on the street, and
> the sidewalk should come afterwards, but the tricky thing is how to connect
> those to the outside of the tile"

The 2026-08-05 fix stopped walkers going through parked cars by pushing each
tile's pavement outward by the depth of whatever parking that tile carried.
Correct on a single tile, and structurally wrong as a system, in three ways:

1. **Discontinuous.** The outset was per TILE. A parking tile's band sat 13–24
   units further out than its parking-free neighbour's, so the pavement broke
   into disconnected segments at every seam — and the walkers, positioned by the
   same number, teleported sideways crossing each one.
2. **Blind to what is behind the parking.** An outward push cannot know what it
   is pushing INTO. Measured on `/test/parkinglot`: the two aisles of the
   surface car park carry back-to-back 90° ranks, and each aisle's pushed-out
   pavement ran straight through the OTHER aisle's bays.
3. **Wrong for a driveway.** At a house, the car crosses the pavement and parks
   behind it (the dropped kerb / Gehwegüberfahrt). Pushing the pavement out
   behind a 48px-deep drive modelled the exact opposite, and left the band
   clamped against the tile edge — the fragile 42→50 case.

## The rule: a fixed cross-section, built outward from the centreline

    carriageway
      → kerbside parking   (parallel: marked bays, informal kerb, lay-bys)
        → pavement
          → across-kerb parking   (drives, forecourt ranks, garage mouths)
            → the plot

Every layer sits outside the ones it knows about, and the two kinds of parking
sit on OPPOSITE sides of the pavement — which is the user's two real-world
cases, stated as one rule:

**Along the kerb = street furniture.** A parallel row is part of the street.
The pavement runs behind it, and a pedestrian never crosses it to stay on the
footway.

**Across the kerb = property access.** A nose-in row belongs to the ground
behind the street. The pavement runs IN FRONT of it, continuous, and the CAR
crosses the pavement to reach its bay — not the other way round.

**A car-park aisle has no pavement at all** (`footway: "none"`, the opt-out the
footway design listed for exactly this). Real aisles have none; you walk on the
aisle. Bays stay at the aisle kerb and there is nothing to connect or break.

## How each half is built

### Across the kerb: data, not geometry

`ParkingRow.gap` already means "clearance between the kerb and the bays, in
lane widths — a pavement, a verge". One lane width (28px) is exactly the
pavement strip (4 gap + 8 band + 2 clear = 14 ground units). So:

- `deriveHomeParking` authors `gap: 1` on every drive. The bays sit behind the
  band; `apronNearPx` already paves across an across-kerb row's gap from the
  road kerb ("the clearance is the aisle the car swings through"), so the
  private hardstanding fill crosses the pavement — the dropped-kerb crossover,
  for free, from machinery that existed before this design.
- The validator learns the rule both ways: an across-kerb row on a footway tile
  MUST carry the gap (or the tile opts out of the footway), and in exchange may
  overhang the tile edge by up to one strip — onto the plot behind, which is the
  plot it serves. (Perpendicular at gap 1 beside a 2-lane road reaches 104px on
  a 200px tile; the art clips at the viewBox, costing the outermost 4px of an
  outline that a drive doesn't even paint.)
- The pavement outset for across-kerb rows is simply DELETED. The band never
  moves for them; the manoeuvre crosses it (`bayNearPx` honours the gap, so the
  pull-in curve does too).

Not modelled, deliberately: a car on the crossover does not yield to walkers
(and vice versa). Same standing as every other car/pedestrian non-interaction
outside zebras; filed as an open end.

### Along the kerb: seam-agreed, tapered, and shared

The outset survives only for the parallel family — and it stops being per-tile:

- **Agreement at every seam.** The pavement's offset where it crosses a tile
  edge is `max` of what the two adjacent tiles need on that flank. Symmetric by
  construction (both tiles compute the same two inputs), same philosophy as the
  road's own min-seam paint rule — and combined with `roadSeamPaintTotal`
  already agreeing about the tarmac half-width, both ends of the equation match
  from both sides. The flank is named by an absolute PORT (the edge's two
  perpendicular neighbours), so no travel-relative side mapping is involved and
  bends/junctions need no special case: their own outset is zero and their
  bands taper toward whatever their straight neighbours need.
- **Linear taper across the tile** between the two seam values — through the
  `offEntry`/`offExit` the band machinery already carries and the tapered kerb
  helpers already draw.
- **One source for paint and people.** `pavementBandEndsFor` returns the two
  end offsets; `bandsFor` draws them and the walkers pass them straight into
  `laneSegmentPointAt`, whose two-offset taper the cars have used all along.
  The 2026-08-05 lesson stands: the paint and the people disagreeing is people
  walking beside the pavement.

Informal kerb (`ParkingRow.informal`) keeps its outset. It is laid on nearly
every straight, so the strip it reserves is UNIFORM along whole streets — the
cross-section reads as road → parking verge → pavement, which is what a
residential street is — and the taper at junction approaches reads as the kerb
build-out real streets put there.

## What this deletes

- `bankOfSide` + the per-tile outset in `pavementOffsetFor` (replaced by the
  seam machinery).
- The clamp-against-the-tile-edge case: across-kerb rows no longer produce
  42→50 offsets at all. `pave()` keeps the clamp as a backstop for lay-bys.

## Verification

- Seam continuity is asserted directly: for every pair of adjacent footway
  tiles on the parking boards, the offset at the shared seam computes equal
  from both sides.
- The walker no-jump sweep gains the parking boards.
- `/test/parkinglot` restored to its pre-2026-08-05 look (aisles opt out);
  `/test/homeparking` shows drives behind a continuous pavement with the
  crossover apron; `/test/workparking` shows the tapered kerbside strip.
