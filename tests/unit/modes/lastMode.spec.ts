// @vitest-environment jsdom
// This suite needs a real localStorage; the project default env is "node".
import { describe, it, expect, beforeEach } from "vitest";
import { loadLastModeId, saveLastModeId } from "@/modes/lastMode";

describe("last-mode persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing has been saved", () => {
    expect(loadLastModeId()).toBeNull();
  });

  it("round-trips the saved mode id", () => {
    saveLastModeId("time-attack");
    expect(loadLastModeId()).toBe("time-attack");
  });

  it("overwrites with the most recent selection", () => {
    saveLastModeId("puzzle");
    saveLastModeId("daily");
    expect(loadLastModeId()).toBe("daily");
  });
});
