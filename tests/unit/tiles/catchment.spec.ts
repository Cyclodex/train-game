import { describe, it, expect } from "vitest";
import { Level, TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import {
  stationCatchment,
  stationDemandOf,
  parkAndRideTargets,
  WALK_RADIUS_TILES,
} from "@/tiles/catchment";

const town = (): TileCell => ({ connections: [], terrain: "urban" });
const works = (): TileCell => ({ connections: [], terrain: "industry" });

describe("stationCatchment", () => {
  it("counts urban and industry tiles within the walking radius, and nothing beyond", () => {
    const level: Level = {
      "5,5": expandKind("station", 1),
      // Inside the Chebyshev-2 ring.
      "4,4": town(),
      "7,5": town(),
      "5,3": works(),
      // One past the ring in each axis — must not count.
      "8,5": town(),
      "5,8": works(),
      // Non-catchment terrain in reach — must not count either.
      "6,6": { connections: [], terrain: "forest" },
    };
    const c = stationCatchment(level, "5,5");
    expect(c).toEqual({ urban: 2, industry: 1 });
    // Sanity: the radius the render advertises is the one the count uses.
    expect(WALK_RADIUS_TILES).toBe(2);
  });

  it("returns zeroes for a station in an empty meadow", () => {
    const level: Level = { "0,0": expandKind("station", 0) };
    expect(stationCatchment(level, "0,0")).toEqual({ urban: 0, industry: 0 });
  });
});

describe("stationDemandOf", () => {
  function withUrban(n: number): Level {
    const level: Level = { "5,5": expandKind("station", 1) };
    // Lay n town tiles inside the ring (row above the station).
    for (let i = 0; i < n; i++) level[`${3 + i},4`] = town();
    return level;
  }

  it("gives a lonely halt a trickle and a town station a crowd", () => {
    const lonely = stationDemandOf(withUrban(0), "5,5");
    const town3 = stationDemandOf(withUrban(3), "5,5");
    expect(lonely.intervalSec).toBeGreaterThan(town3.intervalSec);
    expect(town3.max).toBeGreaterThan(lonely.max);
    expect((town3.initial ?? 0) >= (lonely.initial ?? 0)).toBe(true);
  });

  it("is monotone in the urban count — nearer the houses is never worse", () => {
    let prev = stationDemandOf(withUrban(0), "5,5");
    for (let n = 1; n <= 5; n++) {
      const cur = stationDemandOf(withUrban(n), "5,5");
      expect(cur.intervalSec).toBeLessThanOrEqual(prev.intervalSec);
      expect(cur.max).toBeGreaterThanOrEqual(prev.max);
      expect(cur.initial ?? 0).toBeGreaterThanOrEqual(prev.initial ?? 0);
      prev = cur;
    }
  });

  it("keeps initial within the platform cap", () => {
    for (let n = 0; n <= 20; n++) {
      const d = stationDemandOf(withUrban(Math.min(n, 5)), "5,5");
      expect(d.initial ?? 0).toBeLessThanOrEqual(d.max);
    }
  });
});

describe("parkAndRideTargets", () => {
  it("maps every tile in walking reach to its nearest station, deterministically", () => {
    const level: Level = {
      "2,0": expandKind("station", 1),
      "8,0": expandKind("station", 1),
    };
    const t = parkAndRideTargets(level);
    expect(t["2,2"]).toBe("2,0"); // straight down, distance 2
    expect(t["4,0"]).toBe("2,0"); // between the two, nearer the left
    expect(t["6,0"]).toBe("8,0"); // nearer the right
    expect(t["5,0"]).toBeUndefined(); // distance 3 from both — out of reach
    expect(t["2,0"]).toBe("2,0"); // the station serves its own tile
  });

  it("breaks exact ties by station id, so the map never flickers", () => {
    const level: Level = {
      "0,0": expandKind("station", 1),
      "4,0": expandKind("station", 1),
    };
    // "2,0" is distance 2 from both; the lexicographically smaller id wins.
    expect(parkAndRideTargets(level)["2,0"]).toBe("0,0");
  });
});
