import { describe, it, expect } from "vitest";
import {
  cuesForEvents,
  rollingGain,
  ROLLING_BASE,
  ROLLING_CAP,
} from "@/audio/cues";
import { SimEvent } from "@/sim/simulation";

describe("cuesForEvents (event → sound mapping)", () => {
  it("maps a matched arrival to the delivery chime", () => {
    const events: SimEvent[] = [
      { type: "arrived", trainId: "t1", tileId: "2,0", matched: true },
    ];
    expect(cuesForEvents(events)).toEqual(["delivery"]);
  });

  it("maps a mismatched arrival to the bounce thud", () => {
    const events: SimEvent[] = [
      { type: "arrived", trainId: "t1", tileId: "2,1", matched: false },
    ];
    expect(cuesForEvents(events)).toEqual(["bounce"]);
  });

  it("is silent for movement bookkeeping events", () => {
    const events: SimEvent[] = [
      { type: "reserved", trainId: "t1", tiles: ["1,0"] },
      { type: "blocked", trainId: "t1", tileId: "1,0", reason: "occupancy" },
      { type: "proceeding", trainId: "t1", tileId: "1,0" },
      { type: "departed", trainId: "t1", tileId: "0,0" },
      { type: "retired", trainId: "t1", tileId: "0,0" },
    ];
    expect(cuesForEvents(events)).toEqual([]);
  });

  it("keeps one cue per arrival, in event order", () => {
    const events: SimEvent[] = [
      { type: "arrived", trainId: "a", tileId: "2,0", matched: true },
      { type: "reserved", trainId: "b", tiles: ["1,1"] },
      { type: "arrived", trainId: "b", tileId: "2,1", matched: false },
    ];
    expect(cuesForEvents(events)).toEqual(["delivery", "bounce"]);
  });
});

describe("rollingGain (ambient loop volume)", () => {
  it("is silent with nothing moving", () => {
    expect(rollingGain(0)).toBe(0);
    expect(rollingGain(-1)).toBe(0);
  });

  it("starts at the base for one train and grows per extra train", () => {
    expect(rollingGain(1)).toBe(ROLLING_BASE);
    expect(rollingGain(2)).toBeGreaterThan(rollingGain(1));
    expect(rollingGain(3)).toBeGreaterThan(rollingGain(2));
  });

  it("caps on a busy board", () => {
    expect(rollingGain(50)).toBe(ROLLING_CAP);
    expect(rollingGain(1000)).toBe(ROLLING_CAP);
  });
});
