import { describe, it, expect } from "vitest";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { stationName, stationNames } from "@/tiles/stationNames";
import { networkmode } from "@/levels/test/scenarios/networkmode";

describe("station names", () => {
  it("uses the name a board authored", () => {
    expect(stationName(networkmode.level, "2,1")).toBe("Nordstadt");
    expect(stationName(networkmode.level, "4,2")).toBe("Ostmarkt");
  });

  it("falls back to a letter, in reading order, for a board with no names", () => {
    const level: Level = {
      "5,0": expandKind("station", 1), // top row, right
      "1,0": expandKind("station", 1), // top row, left → A
      "1,3": expandKind("station", 1), // lower row → C
      "2,9": expandKind("straight", 1), // not a station
    };
    expect(stationNames(level)).toEqual({ "1,0": "A", "5,0": "B", "1,3": "C" });
  });

  it("keeps going past Z rather than running out", () => {
    const level: Level = {};
    for (let i = 0; i < 28; i++) level[`${i},0`] = expandKind("station", 1);
    const names = stationNames(level);
    expect(names["25,0"]).toBe("Z");
    expect(names["26,0"]).toBe("AA");
    expect(names["27,0"]).toBe("AB");
  });

  it("names only stations, and answers for an unknown tile without throwing", () => {
    const level: Level = { "0,0": expandKind("depot", 1) };
    expect(stationNames(level)).toEqual({});
    expect(stationName(level, "0,0")).toBe("0,0");
  });
});
