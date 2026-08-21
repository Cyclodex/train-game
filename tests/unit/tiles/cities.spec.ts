import { describe, it, expect } from "vitest";
import { Level, TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { twoWay } from "@/tiles/lanes";
import { Position } from "@/types";
import {
  buildCitizenWorld,
  citiesOf,
  parkAndRideStationsOf,
  plotCapacity,
  plotsOf,
  boardingPointsInReachOf,
} from "@/tiles/cities";

const town = (city?: string): TileCell => ({
  connections: [],
  terrain: "urban",
  ...(city ? { city } : {}),
});
const works = (): TileCell => ({ connections: [], terrain: "industry" });

function block(level: Level, x0: number, y0: number, w: number, h: number, cell: () => TileCell) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) level[`${x},${y}`] = cell();
  }
}

describe("cities: clustering", () => {
  it("reads two separated blocks of urban ground as two cities", () => {
    const level: Level = {};
    block(level, 0, 0, 3, 3, () => town());
    block(level, 8, 0, 3, 3, () => town());
    const cities = citiesOf(level);
    expect(cities).toHaveLength(2);
    expect(cities[0].plots).toHaveLength(9);
    expect(cities[1].plots).toHaveLength(9);
    // Named deterministically, in reading order.
    expect(cities[0].name).not.toEqual(cities[1].name);
    expect(citiesOf(level)[0].name).toEqual(cities[0].name);
  });

  it("an explicit city tag splits towns a flood fill would merge", () => {
    const level: Level = {};
    // Two 2x2 blocks that TOUCH — clustering alone would call them one place.
    block(level, 0, 0, 2, 2, () => town("alpha"));
    block(level, 2, 0, 2, 2, () => town("beta"));
    const cities = citiesOf(level);
    expect(cities.map(c => c.id).sort()).toEqual(["alpha", "beta"]);

    const untagged: Level = {};
    block(untagged, 0, 0, 2, 2, () => town());
    block(untagged, 2, 0, 2, 2, () => town());
    expect(citiesOf(untagged)).toHaveLength(1);
  });

  it("infrastructure is not an address — rail, road and nothing-ground hold no plots", () => {
    const level: Level = {};
    block(level, 0, 0, 3, 3, () => town());
    // A street and a railway drawn THROUGH the town: the tiles they occupy stop
    // being plots, because a street is not a house.
    level["1,1"] = { ...expandKind("straight", 1), terrain: "urban" };
    level["0,2"] = { connections: [], road: twoWay(Position.Left, Position.Right), terrain: "urban" };
    const plots = plotsOf(level);
    expect(plots.map(p => p.id)).not.toContain("1,1");
    expect(plots.map(p => p.id)).not.toContain("0,2");
    expect(plots).toHaveLength(7);
  });
});

describe("cities: plots", () => {
  it("industry is work, urban is homes, and the centre gets the shops", () => {
    const level: Level = {};
    block(level, 0, 0, 4, 4, () => town());
    block(level, 0, 5, 2, 1, () => works());
    const plots = plotsOf(level);
    const byKind = (k: string) => plots.filter(p => p.kind === k);
    expect(byKind("work").map(p => p.id).sort()).toEqual(["0,5", "1,5"]);
    expect(byKind("shop").length).toBeGreaterThan(0);
    expect(byKind("home").length).toBeGreaterThan(byKind("shop").length);
  });

  it("is deterministic — the same map yields the same plots every time", () => {
    const level: Level = {};
    block(level, 0, 0, 5, 5, () => town());
    expect(plotsOf(level, 7)).toEqual(plotsOf(level, 7));
    // ...and a different seed is allowed to differ (it moves the densities).
    const a = plotsOf(level, 1).map(p => p.density).join("");
    const b = plotsOf(level, 99).map(p => p.density).join("");
    expect(a).not.toEqual(b);
  });

  it("capacity doubles with each density step", () => {
    expect(plotCapacity("home", 0)).toBe(4);
    expect(plotCapacity("home", 3)).toBe(32);
    expect(plotCapacity("work", 0)).toBeGreaterThan(plotCapacity("home", 0));
  });
});

describe("cities: access facts", () => {
  it("finds the boarding points within walking reach, and only those", () => {
    const level: Level = {};
    block(level, 0, 0, 6, 3, () => town());
    level["3,0"] = expandKind("station", 1);
    expect(boardingPointsInReachOf(level, 2, 1)).toEqual(["3,0"]);
    expect(boardingPointsInReachOf(level, 0, 2)).toEqual([]);
  });

  it("a bus stop is a boarding point exactly like a platform (#117 step 1)", () => {
    const level: Level = {};
    block(level, 0, 0, 6, 3, () => town());
    level["3,0"] = expandKind("station", 1);
    level["1,2"] = {
      connections: [],
      road: twoWay(Position.Left, Position.Right),
      parking: {
        facility: "halt",
        rows: [{ from: Position.Left, kind: "busstop", count: 1 }],
      },
    };
    // The plot at 2,1 reaches both; the far corner reaches only the kerb.
    expect(boardingPointsInReachOf(level, 2, 1)).toEqual(["1,2", "3,0"]);
    expect(boardingPointsInReachOf(level, 0, 3)).toEqual(["1,2"]);
  });

  it("a station only counts for park & ride when there is parking beside it", () => {
    const level: Level = {};
    level["3,0"] = expandKind("station", 1);
    expect(parkAndRideStationsOf(level)).toEqual([]);
    level["3,1"] = {
      connections: [],
      road: twoWay(Position.Left, Position.Right),
      parking: {
        facility: "P1",
        rows: [{ from: Position.Left, side: "right", kind: "parallel", count: 3 }],
      },
    };
    expect(parkAndRideStationsOf(level).map(s => s.station)).toEqual(["3,0"]);
    // ...and the P+R knows which road network reaches it — a lot you cannot
    // drive to is not a park & ride.
    expect(parkAndRideStationsOf(level)[0].roadComponent).not.toBeNull();
  });

  it("buildCitizenWorld hands the sim access facts, never tiles", () => {
    const level: Level = {};
    block(level, 0, 0, 4, 3, () => town());
    level["2,0"] = expandKind("station", 1);
    level["0,2"] = { connections: [], road: twoWay(Position.Left, Position.Right) };
    const world = buildCitizenWorld(level);
    const withRoad = world.plots.filter(p => p.hasRoad).map(p => p.id);
    expect(withRoad).toContain("0,1");
    expect(withRoad).not.toContain("3,0");
    const served = world.plots.filter(p => p.stationsInReach.length > 0);
    expect(served.length).toBeGreaterThan(0);
    // Nothing tile-shaped crossed the line.
    expect(Object.keys(world.plots[0])).not.toContain("connections");
  });
});
