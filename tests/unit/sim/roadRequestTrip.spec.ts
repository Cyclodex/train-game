import { describe, it, expect } from "vitest";
import { createRoadSim, roadEntries } from "@/sim/road";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { buildCitizenWorld } from "@/tiles/cities";
import { twoWay } from "@/tiles/lanes";
import { Position } from "@/types";
import type { Level } from "@/tiles/model";

// `requestTrip` is the road sim's second way to make a car exist. Ambient
// traffic enters at a map edge and leaves by another one; a REQUESTED car is
// somebody going somewhere, dispatched on their behalf, and it stops when it
// arrives. Everything in between — lanes, queues, junctions, crossings — is the
// same machinery every other car uses.
const LEVEL = citizencars.level;
const W = 12;
const H = 9;

function sim() {
  return createRoadSim({ level: LEVEL, width: W, height: H, seed: 1 });
}

function roadTileOf(plotId: string): string {
  const world = buildCitizenWorld(LEVEL);
  const plot = world.plots.find(p => p.id === plotId);
  if (!plot?.roadTile) throw new Error(`no road tile for ${plotId}`);
  return plot.roadTile;
}

describe("road: requested trips", () => {
  it("the ring road has no ambient spawn entries at all", () => {
    // The property the citizencars board is built on: a closed ring OPENS
    // nowhere, so ambient traffic cannot spawn and every car on that board is
    // provably a citizen. If this ever goes non-zero the scenario stops proving
    // what it claims to prove.
    expect(roadEntries(LEVEL, W, H)).toEqual([]);
    const s = sim();
    for (let t = 0; t < 60; t += 0.2) s.step(0.2, () => false);
    expect(s.cars()).toEqual([]);
  });

  it("dispatches a car that drives to its address and stops being traffic", () => {
    const s = sim();
    const id = s.requestTrip(roadTileOf("0,3"), roadTileOf("11,3"));
    expect(id).toBeTruthy();
    expect(s.cars()).toHaveLength(1);
    expect(s.tripStatus(id as string)).toBe("driving");

    // It takes real time: the ring is one-way, so the car drives up and over.
    let arrivedAt = -1;
    for (let t = 0; t < 200; t += 0.2) {
      s.step(0.2, () => false);
      if (s.tripStatus(id as string) === "arrived") {
        arrivedAt = t;
        break;
      }
    }
    expect(arrivedAt).toBeGreaterThan(0);
    // Arriving means leaving the road — a car standing at its destination for
    // ever would be a permanent obstruction on a single-lane street.
    expect(s.cars()).toEqual([]);
  });

  it("refuses a trip it cannot make, rather than inventing a car", () => {
    const s = sim();
    expect(s.requestTrip("1,2", "1,2")).toBeNull(); // already there
    expect(s.requestTrip("0,3", "1,2")).toBeNull(); // origin is a house, not a road
    expect(s.requestTrip("1,2", "0,3")).toBeNull(); // so is the destination
  });

  it("an unknown trip id reads arrived, so nobody waits on a car that is gone", () => {
    expect(sim().tripStatus("car-that-never-was")).toBe("arrived");
  });

  it("tries every way out of the street before deciding it cannot park", () => {
    // A driver leaves their street by one of its approaches, and WHICH ONE
    // decides what they can reach: `planParkingNear` runs from `(tile, entry)`,
    // so a space that lies east is invisible to the westbound approach.
    //
    // The ports are tried in a fixed order (ascending, so Right — the westbound
    // approach — comes first here), and the parking refusal used to `return`
    // out of that loop on the very first failure. A driver who could have
    // parked by turning the other way out of their own street was told the town
    // was full and never set off.
    const street = () => ({ connections: [], road: twoWay(Position.Left, Position.Right) });
    const level: Level = {
      // A dead end: nothing west of 1,1 and no junction to turn round at, so
      // the westbound approach can reach no parking at all.
      "1,1": street(),
      "2,1": street(),
      "3,1": street(),
      "4,1": {
        ...street(),
        parking: {
          facility: "P",
          rows: [{ from: Position.Left, side: "right", kind: "perpendicular", count: 2 }],
        },
      },
    };
    expect(Position.Right).toBeLessThan(Position.Left); // the order this turns on
    const s = createRoadSim({ level, width: 6, height: 3, seed: 1 });
    const id = s.requestTrip("2,1", "4,1", "car", { park: true });
    expect(id).toBeTruthy();
    // ...and it is a real journey, not just an id: the car reaches the bay.
    let parked = false;
    for (let t = 0; t < 200 && !parked; t += 0.2) {
      s.step(0.2, () => false);
      parked = s.tripStatus(id as string) === "parked";
    }
    expect(parked).toBe(true);
    expect(s.tripParkedAt(id as string)).toBe("4,1");
  });

  it("runs many trips at once without losing any of them", () => {
    const s = sim();
    const ids: string[] = [];
    for (const y of [1, 2, 3, 4, 5, 6, 7]) {
      const id = s.requestTrip(roadTileOf(`0,${y}`), roadTileOf("11,4"));
      if (id) ids.push(id);
      // Space the departures out: a street only lets so many cars pull out at once.
      for (let t = 0; t < 6; t += 0.2) s.step(0.2, () => false);
    }
    expect(ids.length).toBeGreaterThan(3);
    for (let t = 0; t < 400; t += 0.2) s.step(0.2, () => false);
    for (const id of ids) expect(s.tripStatus(id)).toBe("arrived");
  });
});
