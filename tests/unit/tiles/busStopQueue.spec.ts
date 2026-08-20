import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { busStopGeometry, busStopQueueSpots } from "@/tiles/parkingGeometry";
import type { ParkingRow } from "@/tiles/parking";

// WHERE THE PEOPLE WAITING FOR A BUS STAND.
//
// A platform draws its queue along the slab and always has; a kerb drew nothing,
// so a halt with six people waiting looked exactly like an empty one — the HUD
// counted a crowd the board never showed. These are the rules that make the dots
// read as "standing at the stop" rather than as litter:
//   · on the VERGE, never on the carriageway (or a bus drives through them);
//   · backed up AWAY from the shelter, against the direction of travel, which is
//     both how a real queue forms and how it stays out from under the stop's
//     sign — that stands at the downstream end;
//   · inside the tile, however many are waiting.
const SIZE = 200;
const KERB = 28; // a two-lane road's kerb offset, in px

const halt = (from: Position): ParkingRow => ({ from, kind: "busstop", count: 1 });

describe("the queue at a bus stop", () => {
  it("stands on the verge, clear of the road", () => {
    // A halt on the LEFT approach: travel runs left to right, so "out" from the
    // kerb is +y and the carriageway is everything above it.
    const spots = busStopQueueSpots(halt(Position.Left), SIZE, KERB, 6);
    expect(spots).toHaveLength(6);
    for (const p of spots) expect(p.y).toBeGreaterThan(100 + KERB);
  });

  it("stands clear of the shelter rather than on top of it", () => {
    const row = halt(Position.Left);
    const spots = busStopQueueSpots(row, SIZE, KERB, 6);
    const geo = busStopGeometry(row, SIZE, KERB);
    // The shelter's own extent along the road: nobody stands inside it.
    const xs = (geo.shelter.match(/-?\d+(\.\d+)?\s-?\d+(\.\d+)?/g) ?? []).map(p =>
      Number(p.split(" ")[0])
    );
    const shelterEnd = Math.max(...xs);
    for (const p of spots) expect(p.x).toBeGreaterThan(shelterEnd);
    // ...and the queue really is a line, not a pile on one spot.
    expect(spots[spots.length - 1].x).toBeGreaterThan(spots[0].x);
  });

  it("keeps a full stop inside its own tile", () => {
    // 12 is the cap the view draws; the last of them must still be on this tile
    // rather than queueing into the neighbour's garden.
    for (const from of [Position.Left, Position.Right, Position.Top, Position.Bottom]) {
      for (const p of busStopQueueSpots(halt(from), SIZE, KERB, 12)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(SIZE);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(SIZE);
      }
    }
  });

  it("puts nobody anywhere when nobody is waiting", () => {
    expect(busStopQueueSpots(halt(Position.Left), SIZE, KERB, 0)).toEqual([]);
  });
});
