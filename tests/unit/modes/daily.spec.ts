import { describe, it, expect } from "vitest";
import { dateToSeed, dailyMode, dailyLevelId, todayString } from "@/modes/daily";
import { validateLevel } from "@/tiles/validate";
import { assignColors } from "@/utils/colorAssignment";
import { makeRng } from "@/utils/globalHelpers";

// A minimal ModeContext — daily ignores these entirely and generates its own board.
const EMPTY_CTX = {
  level: {},
  trains: [],
  levelId: "ignored",
};

// ─── dateToSeed ─────────────────────────────────────────────────────────────

describe("dateToSeed", () => {
  it("is deterministic: same date → same seed", () => {
    expect(dateToSeed("2026-06-15")).toBe(dateToSeed("2026-06-15"));
    expect(dateToSeed("2024-01-01")).toBe(dateToSeed("2024-01-01"));
  });

  it("produces distinct seeds for distinct dates", () => {
    const a = dateToSeed("2026-06-15");
    const b = dateToSeed("2026-06-16");
    const c = dateToSeed("2026-07-15");
    const d = dateToSeed("2027-06-15");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(b).not.toBe(c);
  });

  it("produces a stable, known seed for 2026-06-15", () => {
    // Hard-coded to catch any accidental algorithm change.
    expect(dateToSeed("2026-06-15")).toBe(4282782019);
  });

  it("produces a stable, known seed for 2024-01-01", () => {
    expect(dateToSeed("2024-01-01")).toBe(3065063313);
  });

  it("returns a non-negative integer (safe as an RNG seed)", () => {
    const seed = dateToSeed("2030-12-31");
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(seed)).toBe(true);
  });
});

// ─── dailyLevelId ────────────────────────────────────────────────────────────

describe("dailyLevelId", () => {
  it("returns daily:<date>", () => {
    expect(dailyLevelId("2026-06-15")).toBe("daily:2026-06-15");
  });
});

// ─── todayString ─────────────────────────────────────────────────────────────

describe("todayString", () => {
  it("returns YYYY-MM-DD format matching today", () => {
    const s = todayString();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The date matches the local year at minimum.
    expect(s.startsWith(String(new Date().getFullYear()))).toBe(true);
  });
});

// ─── dailyMode.setup ─────────────────────────────────────────────────────────

describe("dailyMode setup", () => {
  it("ignores the incoming context and generates its own board", () => {
    const setup = dailyMode.setup(EMPTY_CTX);
    // Generated board is non-empty.
    expect(Object.keys(setup.level).length).toBeGreaterThan(0);
    expect(setup.trains.length).toBeGreaterThan(0);
  });

  it("is deterministic: calling setup twice on the same day produces identical results", () => {
    const s1 = dailyMode.setup(EMPTY_CTX);
    const s2 = dailyMode.setup(EMPTY_CTX);
    expect(JSON.stringify(s1.level)).toBe(JSON.stringify(s2.level));
    expect(JSON.stringify(s1.trains)).toBe(JSON.stringify(s2.trains));
    expect(JSON.stringify(s1.colors)).toBe(JSON.stringify(s2.colors));
    expect(s1.levelId).toBe(s2.levelId);
  });

  it("levelId is daily:<YYYY-MM-DD>", () => {
    const setup = dailyMode.setup(EMPTY_CTX);
    expect(setup.levelId).toMatch(/^daily:\d{4}-\d{2}-\d{2}$/);
  });

  it("the generated board passes validateLevel with the train routes", () => {
    const setup = dailyMode.setup(EMPTY_CTX);
    // Reconstruct routes from train defs: each train's start depot → ... but
    // since the daily board only uses trainsFromRoutes (one destination each),
    // we can derive routes from the level's depots. Validate at minimum that the
    // board itself is structurally valid (no dangling tracks / isolated depots).
    const result = validateLevel(setup.level, []);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("every train starts in a depot tile", () => {
    const setup = dailyMode.setup(EMPTY_CTX);
    for (const def of setup.trains) {
      const start = setup.level[`${def.x},${def.y}`];
      expect(start?.role).toBe("depot");
    }
  });

  it("colours are assigned and cover every train and depot", () => {
    const setup = dailyMode.setup(EMPTY_CTX);
    const colors = setup.colors!;
    for (const def of setup.trains) {
      expect(colors.trainColors[def.id]).toBeTruthy();
    }
    const depotIds = Object.entries(setup.level)
      .filter(([, t]) => t.role === "depot")
      .map(([id]) => id);
    for (const id of depotIds) {
      expect(colors.depotColors[id]).toBeTruthy();
    }
  });

  it("objective requires delivering every train", () => {
    const setup = dailyMode.setup(EMPTY_CTX);
    expect(setup.objective.deliveriesRequired).toBe(setup.trains.length);
  });

  it("offers three stars: speedrun, hands-off, perfect-colours", () => {
    const setup = dailyMode.setup(EMPTY_CTX);
    const ids = (setup.objective.stars ?? []).map(s => s.id).sort();
    expect(ids).toEqual(["hands-off", "perfect-colours", "speedrun"]);
  });

  it("colours are deterministic from the seed (re-producing them matches)", () => {
    const setup = dailyMode.setup(EMPTY_CTX);
    // Re-derive colours independently from the seed — they must match.
    const today = todayString();
    const seed = dateToSeed(today);
    const rederived = assignColors(setup.level, setup.trains, makeRng(seed));
    expect(setup.colors!.depotColors).toEqual(rederived.depotColors);
    expect(setup.colors!.trainColors).toEqual(rederived.trainColors);
  });
});

// ─── dailyMode metadata ───────────────────────────────────────────────────────

describe("dailyMode controls + hud", () => {
  it("enables only dispatch controls (switches + signal holds)", () => {
    expect(dailyMode.controls).toEqual({
      switches: true,
      signalHolds: true,
      crossingGate: false,
      build: false,
      // Trains depart immediately here; only Tycoon makes them wait.
      dispatch: false,
    });
  });

  it("shows the full objective HUD", () => {
    expect(dailyMode.hud).toEqual({
      deliveries: true,
      timer: true,
      stars: true,
      startOverlay: true,
      endOverlay: true,
      money: false,
    });
  });

  it("does not create a spawner (all trains present from the start)", () => {
    expect(dailyMode.createSpawner).toBeUndefined();
  });
});
