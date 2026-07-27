// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  CAMPAIGN,
  campaignIndexOf,
  campaignKeyOf,
  campaignRows,
  campaignTotals,
  isCleared,
  isUnlocked,
  nextLevelAfter,
  starsFor,
} from "@/campaign";
import { recordResult } from "@/objectiveStore";
import { SCENARIOS } from "@/levels/test";

describe("campaign", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // The load-bearing test. BOTH lookups a bad id would hit fail SILENTLY:
  // `scenarioById` returns the registry's first entry for an unknown id, and
  // PlayView falls through to the default board. A typo would therefore produce
  // a wrong-but-working level and no error anywhere in the app.
  it("every level id resolves to a real scenario", () => {
    for (const level of CAMPAIGN) {
      expect(
        SCENARIOS.some(s => s.id === level.id),
        `campaign level "${level.id}" is not a scenario id`,
      ).toBe(true);
    }
  });

  it("declares a mode for every level", () => {
    // Not optional: PlayView ignores `scenario.modeId`, so a level opened
    // without an explicit mode runs under whatever the player last played.
    for (const level of CAMPAIGN) expect(level.modeId).toBeTruthy();
  });

  it("keys progress the way PlayView records it", () => {
    expect(campaignKeyOf(CAMPAIGN[0])).toBe(`board:${CAMPAIGN[0].id}`);
  });

  it("finds a level by bare id and by either levelId prefix", () => {
    const id = CAMPAIGN[1].id;
    expect(campaignIndexOf(id)).toBe(1);
    expect(campaignIndexOf(`board:${id}`)).toBe(1);
    expect(campaignIndexOf(`test:${id}`)).toBe(1);
    expect(campaignIndexOf("board:not-a-level")).toBe(-1);
  });

  it("walks forward and stops at the end", () => {
    expect(nextLevelAfter(`board:${CAMPAIGN[0].id}`)?.id).toBe(CAMPAIGN[1].id);
    const last = CAMPAIGN[CAMPAIGN.length - 1];
    expect(nextLevelAfter(`board:${last.id}`)).toBeNull();
    // Off the campaign entirely — a /test board, say.
    expect(nextLevelAfter("board:straight")).toBeNull();
  });

  it("opens the first level and locks the rest", () => {
    expect(isUnlocked(0)).toBe(true);
    expect(isUnlocked(1)).toBe(false);
    expect(isUnlocked(2)).toBe(false);
  });

  it("unlocks the next level once the previous one is won", () => {
    recordResult(campaignKeyOf(CAMPAIGN[0]), { stars: 2, timeSec: 30 });
    expect(isCleared(CAMPAIGN[0])).toBe(true);
    expect(isUnlocked(1)).toBe(true);
    // ...and no further than that.
    expect(isUnlocked(2)).toBe(false);
  });

  // A win is a win. Gating on stars would make the campaign unfinishable for a
  // player who scraped a board with none.
  it("counts a zero-star win as cleared", () => {
    recordResult(campaignKeyOf(CAMPAIGN[0]), { stars: 0, timeSec: 99 });
    expect(starsFor(CAMPAIGN[0])).toBe(0);
    expect(isCleared(CAMPAIGN[0])).toBe(true);
    expect(isUnlocked(1)).toBe(true);
  });

  it("totals the stars earned against the stars on offer", () => {
    const offered = CAMPAIGN.reduce((n, l) => n + l.stars, 0);
    expect(campaignTotals()).toEqual({ earned: 0, total: offered });
    recordResult(campaignKeyOf(CAMPAIGN[0]), { stars: 2, timeSec: 30 });
    recordResult(campaignKeyOf(CAMPAIGN[1]), { stars: 1, timeSec: 30 });
    expect(campaignTotals()).toEqual({ earned: 3, total: offered });
  });

  it("builds one row per level with its unlock state", () => {
    recordResult(campaignKeyOf(CAMPAIGN[0]), { stars: 3, timeSec: 12 });
    const rows = campaignRows();
    expect(rows).toHaveLength(CAMPAIGN.length);
    expect(rows[0]).toMatchObject({ index: 0, unlocked: true, cleared: true, stars: 3 });
    expect(rows[1]).toMatchObject({ index: 1, unlocked: true, cleared: false, stars: 0 });
    expect(rows[2]).toMatchObject({ index: 2, unlocked: false, cleared: false });
  });
});
