import { describe, it, expect } from "vitest";
import { toLogEntry } from "@/gameLog";
import { SimEvent } from "@/sim/simulation";

describe("toLogEntry", () => {
  it("carries the id, time and originating train through", () => {
    const e: SimEvent = { type: "reserved", trainId: "t1", tiles: ["1,0"] };
    const entry = toLogEntry(e, 7, 12.34);
    expect(entry.id).toBe(7);
    expect(entry.time).toBe(12.34);
    expect(entry.trainId).toBe("t1");
    expect(entry.kind).toBe("reserved");
  });

  it("lists the reserved tiles", () => {
    const e: SimEvent = {
      type: "reserved",
      trainId: "t1",
      tiles: ["1,0", "2,0", "3,0"],
    };
    const entry = toLogEntry(e, 1, 0);
    expect(entry.text).toContain("1,0");
    expect(entry.text).toContain("2,0");
    expect(entry.text).toContain("3,0");
  });

  it("describes a signal-hold block with the tile and a readable reason", () => {
    const e: SimEvent = {
      type: "blocked",
      trainId: "t1",
      tileId: "1,0",
      reason: "signal-hold",
    };
    const entry = toLogEntry(e, 1, 0);
    expect(entry.text).toContain("1,0");
    expect(entry.text.toLowerCase()).toContain("signal");
  });

  it("names the blocking train when a block is caused by another", () => {
    const e: SimEvent = {
      type: "blocked",
      trainId: "follow",
      tileId: "1,0",
      reason: "reservation",
      blockedBy: "lead",
    };
    const entry = toLogEntry(e, 1, 0);
    expect(entry.text).toContain("lead");
  });

  it("describes a proceeding event with the tile", () => {
    const e: SimEvent = { type: "proceeding", trainId: "t1", tileId: "1,0" };
    const entry = toLogEntry(e, 1, 0);
    expect(entry.text.toLowerCase()).toContain("proceed");
    expect(entry.text).toContain("1,0");
  });

  it("describes a matched arrival as a delivery and an unmatched one as a bounce", () => {
    const delivered = toLogEntry(
      { type: "arrived", trainId: "t1", tileId: "5,0", matched: true },
      1,
      0
    );
    expect(delivered.text.toLowerCase()).toContain("deliver");

    const bounced = toLogEntry(
      { type: "arrived", trainId: "t1", tileId: "5,0", matched: false },
      2,
      0
    );
    expect(bounced.text.toLowerCase()).toContain("bounce");
  });
});
