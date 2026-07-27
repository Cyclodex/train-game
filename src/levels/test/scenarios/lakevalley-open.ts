import { TestScenario } from "@/levels/test/scenario";
import { Level } from "@/tiles/model";
import { lakevalley } from "@/levels/test/scenarios/lakevalley";

// Lake Valley — the OPENING state (Tycoon). This is the level the complete
// `lakevalley` board was always standing ready for: Train Valley's first level
// as it actually opens, with the southern run of the ring MISSING and a budget
// to buy it back.
//
// Derived from the complete board by deleting exactly the south run, so the two
// can never drift apart: same stations, same lake, same terrain, same trains.
// `structuredClone` gives this scenario its own cell objects — scenario levels
// are handed to createGame and edited in play, so sharing cell references with
// the reference board would let one board's session leak into the other's.
//
// What the cut does to the game:
//  - The yellow station (2,6) is completely unreachable — its spur junction
//    (2,5) went with the run, so its depot's north seam opens onto grass.
//  - The west side (2,3–2,4) and east side (6,3–6,4) dangle at their south
//    ends. Those two open ends are where the rebuild anchors.
//  - Only the blue↔red trunk still works, and it is SINGLE TRACK. That matters
//    more than it looks: three trains that each start in the others' target
//    stations (the seeded assignment is a 3-cycle) provably CANNOT all deliver
//    over a tree of single track — every schedule deadlocks at the 1,2–2,2
//    needle. The ring is not decoration, it is the passing loop. Closing it is
//    the level.
//
// The intended rebuild, at $1,000 a piece (TRACK_COST_PER_TILE). A build
// gesture lays the route up to the clicked edge, one pair per tile, so the
// original T-junction at 2,5 (three pairs) is bought pair by pair:
//  - Close the ring: drag 2,4-S → 6,4-S along row 5 — 5 pieces, $5,000
//    (2,5 [N,E], three straights, 6,5 [W,N]).
//  - Station entry from the ring: 3,5-W → 2,5-S — 1 piece ([E,S] at 2,5).
//  - Station entry from the west side: 2,4-S → 2,5-S — 1 piece ([N,S]).
//  Total: 7 pieces, $7,000 of the $8,000 budget (see LAKEVALLEY_OPEN_TUNING in
//  modes/tycoon.ts — one spare piece, not a shopping spree). That restores
//  2,5's full T-junction, and the three trains can then run simultaneously on
//  disjoint routes. A 6-piece build (ring + the [E,S] entry only) also wins,
//  but only fully serialized — yellow laps east and waits at the 4,2 signal,
//  red descends the east side into the freed station, one switch flip at 6,2
//  sends blue round the south — and that lean line is what the "Under budget"
//  goal pays for. (The [N,S]-entry variant is a trap: a train pinned at the
//  4,2 signal keeps stale rear reservations on 5,2/6,2, and every lap to the
//  red station crosses one of them — measured, not theorised.)
//
// This board is DELIBERATELY incomplete — `allowIncomplete` makes the registry
// validation tolerate the dangling ends and the two unreachable train routes,
// which are the whole point. The blue→red trunk route carries no flag and is
// still fully validated, so the half of the board that must work on open is
// still guarded by CI.
//
// The /test stage shows the opening board with its three waiting trains; the
// build loop itself lives in PlayView — play it at
// /#/play?mode=tycoon&board=lakevalley-open (that exact flow is the e2e test).

// The tiles the opening state removes from the complete board: the south run of
// the ring, including the yellow station's spur junction at its west end.
export const LAKEVALLEY_SOUTH_RUN = ["2,5", "3,5", "4,5", "5,5", "6,5"];

function withoutSouthRun(level: Level): Level {
  const out = structuredClone(level);
  for (const id of LAKEVALLEY_SOUTH_RUN) delete out[id];
  return out;
}

export const lakevalleyOpen: TestScenario = {
  id: "lakevalley-open",
  name: "Lake Valley — opening",
  description:
    "Train Valley's first level as it opens: the ring is missing its south run, the yellow station is cut off, and the budget buys it back.",
  modeId: "tycoon",
  allowIncomplete: true,
  size: { ...lakevalley.size! },
  level: withoutSouthRun(lakevalley.level),
  trains: structuredClone(lakevalley.trains),
};
