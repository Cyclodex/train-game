import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level, TileCell } from "@/tiles/model";
import { twoWay } from "@/tiles/lanes";
import { expandKind } from "@/tiles/kinds";
import { accessPathSvg, accessPortOf, localAccessOf } from "@/tiles/access";
import { citiesOf, plotsOf } from "@/tiles/cities";

const town = (): TileCell => ({ connections: [], terrain: "urban" });
const works = (): TileCell => ({ connections: [], terrain: "industry" });
const street = (terrain?: "urban" | "industry"): TileCell => ({
  connections: [],
  road: twoWay(Position.Left, Position.Right),
  ...(terrain ? { terrain } : {}),
});

describe("local access: the last block draws itself", () => {
  it("points a plot at the street across its boundary", () => {
    const level: Level = { "0,0": town(), "0,1": street() };
    expect(accessPortOf(level, "0,0")).toBe(Position.Bottom);
  });

  it("takes a street on the diagonal too — the reach is a square ring", () => {
    const level: Level = { "0,0": town(), "1,1": street() };
    expect(accessPortOf(level, "0,0")).toBe(Position.Right);
  });

  it("gives nothing to a plot with no street in reach", () => {
    const level: Level = { "0,0": town(), "3,0": street() };
    expect(accessPortOf(level, "0,0")).toBeNull();
  });

  it("draws no path across the infrastructure itself", () => {
    // A street is not an address, and neither is a railway: nobody's driveway
    // crosses the carriageway they are joining.
    const level: Level = {
      "0,0": street("urban"),
      "1,0": { ...expandKind("straight", 1), terrain: "urban" },
      "0,1": street(),
    };
    expect(accessPortOf(level, "0,0")).toBeNull();
    expect(accessPortOf(level, "1,0")).toBeNull();
  });

  it("is stable: the same board picks the same side every time", () => {
    // Two streets in reach — the choice must not wobble between reloads.
    const level: Level = { "1,1": town(), "1,0": street(), "0,1": street() };
    const first = accessPortOf(level, "1,1");
    for (let i = 0; i < 5; i++) expect(accessPortOf(level, "1,1")).toBe(first);
    expect(first).toBe(Position.Top); // sides in port order, Top first
  });

  it("localAccessOf is the whole-board view of the same rule", () => {
    const level: Level = {
      "0,0": town(),
      "1,0": town(),
      "0,1": street(),
      "5,5": town(), // out of reach of anything
    };
    const all = localAccessOf(level);
    expect(Object.keys(all).sort()).toEqual(["0,0", "1,0"]);
    expect(all["0,0"]).toBe(accessPortOf(level, "0,0"));
  });

  it("re-derives when the street moves — no stored state to go stale", () => {
    const level: Level = { "0,0": town(), "0,1": street() };
    expect(accessPortOf(level, "0,0")).toBe(Position.Bottom);
    delete level["0,1"];
    level["1,0"] = street();
    expect(accessPortOf(level, "0,0")).toBe(Position.Right);
  });

  it("draws a wedge that overshoots the tile edge, so no seam shows", () => {
    const svg = accessPathSvg(Position.Bottom, "2,3");
    expect(svg).toMatch(/^<path d="M .* Z" fill="hsl\(36 /);
    // Four corners, and the far pair sits past the 100-unit edge.
    const nums = [...svg.matchAll(/-?\d+\.\d/g)].map(m => Number(m[0]));
    expect(Math.max(...nums)).toBeGreaterThan(100);
    // The works get their own, cooler tone.
    expect(accessPathSvg(Position.Bottom, "2,3", "industry")).toContain("hsl(212");
  });
});

describe("a street may run THROUGH a town", () => {
  it("does not cut the town in two", () => {
    // Houses either side of a street that crosses the middle. Before the
    // clustering walked over town GROUND rather than only over addresses, this
    // read as two separate towns — laying a road through a place split it.
    const level: Level = {};
    for (let x = 0; x <= 4; x++) {
      level[`${x},0`] = town();
      level[`${x},1`] = street("urban"); // the street, on the town's own ground
      level[`${x},2`] = town();
    }
    const cities = citiesOf(level);
    expect(cities).toHaveLength(1);
    // ...and the carriageway holds nobody: it is ground, not an address.
    expect(cities[0].plots).not.toContain("2,1");
    expect(plotsOf(level).map(p => p.id)).not.toContain("2,1");
    expect(cities[0].plots).toHaveLength(10);
  });

  it("still keeps genuinely separate towns separate", () => {
    const level: Level = {};
    for (let x = 0; x <= 2; x++) level[`${x},0`] = town();
    for (let x = 8; x <= 10; x++) level[`${x},0`] = town();
    expect(citiesOf(level)).toHaveLength(2);
  });

  it("a run of street with no houses beside it is not a town", () => {
    const level: Level = { "0,0": street("urban"), "1,0": street("urban") };
    expect(citiesOf(level)).toEqual([]);
  });

  it("industry ground bridges to town ground the same way", () => {
    const level: Level = {
      "0,0": town(),
      "1,0": street("industry"),
      "2,0": works(),
    };
    expect(citiesOf(level)).toHaveLength(1);
  });
});
