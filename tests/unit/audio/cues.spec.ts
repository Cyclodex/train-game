import { describe, it, expect } from "vitest";
import {
  cuesForEvents,
  rollingGain,
  takeClacks,
  ROLLING_BASE,
  ROLLING_CAP,
  CLACK_SPACING_TILES,
  MAX_CLACKS_PER_FRAME,
} from "@/audio/cues";
import { SAMPLES } from "@/audio/samples";
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

describe("takeClacks (rail joints keep time with the trains)", () => {
  it("stays silent until a whole joint has been rolled over", () => {
    const r = takeClacks(CLACK_SPACING_TILES * 0.9);
    expect(r.clacks).toBe(0);
    // ...and carries the distance forward rather than dropping it.
    expect(r.rest).toBeCloseTo(CLACK_SPACING_TILES * 0.9, 6);
  });

  it("fires one knock per joint and carries the remainder", () => {
    const r = takeClacks(CLACK_SPACING_TILES * 1.5);
    expect(r.clacks).toBe(1);
    expect(r.rest).toBeCloseTo(CLACK_SPACING_TILES * 0.5, 6);
  });

  it("keeps time over a long run — the count follows distance, not frames", () => {
    // A train at the 0.5 tiles/sec cruise speed, stepped in 60fps frames for
    // ten simulated seconds: five tiles of track, so twenty joints. The point
    // is that the remainder is CARRIED, so the count tracks distance instead of
    // drifting — off-by-one at the very last threshold is float rounding on the
    // final frame, not drift, hence the tolerance of one.
    let accum = 0;
    let total = 0;
    const perFrame = 0.5 / 60;
    for (let i = 0; i < 600; i++) {
      accum += perFrame;
      const r = takeClacks(accum);
      accum = r.rest;
      total += r.clacks;
    }
    const expected = (600 * perFrame) / CLACK_SPACING_TILES; // 20
    expect(Math.abs(total - expected)).toBeLessThanOrEqual(1);
  });

  it("doubles the knocks when the speed dial doubles", () => {
    // The rhythm is a function of DISTANCE, so 2x speed covers twice the track
    // in the same wall-clock second and knocks twice as often. This is the
    // property a recorded loop cannot have.
    const run = (tilesPerSec: number) => {
      let accum = 0;
      let total = 0;
      for (let i = 0; i < 600; i++) {
        accum += tilesPerSec / 60;
        const r = takeClacks(accum);
        accum = r.rest;
        total += r.clacks;
      }
      return total;
    };
    const slow = run(0.5);
    const fast = run(1.0);
    expect(fast).toBeGreaterThanOrEqual(slow * 2 - 1);
    expect(fast).toBeLessThanOrEqual(slow * 2 + 1);
  });

  it("does not machine-gun after a long stall, and drops the backlog", () => {
    // A backgrounded tab hands back a huge dt; the joints it covers are in the
    // past, so they are capped AND discarded rather than paid back later.
    const r = takeClacks(CLACK_SPACING_TILES * 40);
    expect(r.clacks).toBe(MAX_CLACKS_PER_FRAME);
    expect(r.rest).toBeCloseTo(0, 6);
  });

  it("treats a standstill as no distance at all", () => {
    expect(takeClacks(0)).toEqual({ clacks: 0, rest: 0 });
  });
});

describe("the CC0 sample manifest", () => {
  it("gives every cue a bundled file and a sane gain", () => {
    const cues = ["delivery", "bounce", "cash", "switch", "signal"] as const;
    for (const cue of cues) {
      const spec = SAMPLES[cue];
      expect(spec, `${cue} has no sample`).toBeDefined();
      expect(spec.url).toBeTruthy();
      expect(spec.gain).toBeGreaterThan(0);
      expect(spec.gain).toBeLessThanOrEqual(1);
    }
  });
});
