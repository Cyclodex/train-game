import { describe, it, expect, beforeEach, vi } from "vitest";
import { GameSave, SAVE_VERSION } from "@/game";
import {
  deleteSave,
  getSave,
  listSaves,
  putSave,
  slotIdFor,
} from "@/saveStore";

// Slot bookkeeping only — the CONTENT round trip is gameSave.spec's job. A
// minimal GameSave shell is enough here.
function mkSave(name: string, version = SAVE_VERSION): GameSave {
  return {
    version,
    name,
    savedAt: Date.now(),
    modeId: "puzzle",
    levelId: "default",
    colorSeed: 1,
    level: {},
    pristineLevel: {},
    trains: [],
    colors: { depotColors: {}, trainColors: {} },
    switches: {},
    sim: {
      trains: [],
      reservations: {},
      manualHold: [],
      manualProceed: [],
      transit: {
        lines: [],
        lineSeq: 0,
        queues: {},
        spawnClocks: {},
        destCursors: {},
        delivered: 0,
      },
    },
    objective: {
      phase: "playing",
      counters: {
        delivered: 0,
        mismatchedArrivals: 0,
        elapsedSec: 0,
        manualHolds: 0,
        manualGreens: 0,
        maxCarWaitSec: 0,
        carsDelivered: 0,
        crossingIncidents: 0,
      },
    },
    game: {
      clock: 0,
      deliveries: 0,
      manualHoldTotal: 0,
      manualGreenTotal: 0,
      tilesBuiltTotal: 0,
      trackSpentTotal: 0,
      leviesBilled: 0,
      taxPaidTotal: 0,
      unpaidTaxTotal: 0,
      boughtPieces: [],
      boughtCount: 0,
      queuedTrainIds: [],
      buses: [],
    },
  };
}

beforeEach(() => {
  for (const meta of listSaves()) deleteSave(meta.id);
});

describe("saveStore slots", () => {
  it("puts, lists (newest first) and gets saves back", () => {
    const a = mkSave("First run");
    a.savedAt = 1000;
    const b = mkSave("Second run");
    b.savedAt = 2000;
    putSave("first", a);
    putSave("second", b);

    const metas = listSaves();
    expect(metas.map(m => m.id)).toEqual(["second", "first"]);
    expect(metas[0].compatible).toBe(true);
    expect(getSave("first")?.name).toBe("First run");
  });

  it("deletes a slot", () => {
    putSave("gone", mkSave("Gone"));
    deleteSave("gone");
    expect(getSave("gone")).toBeNull();
    expect(listSaves()).toHaveLength(0);
  });

  it("lists a version-mismatched slot as incompatible and refuses to load it", () => {
    putSave("old", mkSave("Old format", SAVE_VERSION + 1));
    const metas = listSaves();
    expect(metas).toHaveLength(1);
    expect(metas[0].compatible).toBe(false);
    expect(getSave("old")).toBeNull();
  });

  it("derives unique, url-safe slot ids from player names", () => {
    expect(slotIdFor("Mein Spielstand #1!")).toBe("mein-spielstand-1");
    putSave("mein-spielstand-1", mkSave("Mein Spielstand #1!"));
    expect(slotIdFor("Mein Spielstand #1!")).toBe("mein-spielstand-1-2");
    expect(slotIdFor("!!!")).toBe("save");
  });

  it("reserves the autosave slot: a manual save named 'Autosave' never lands on it", () => {
    // The leave-autosave overwrites AUTOSAVE_ID unasked; a player's named save
    // must not be the thing it clobbers.
    expect(slotIdFor("Autosave")).not.toBe("autosave");
    expect(slotIdFor("Autosave")).toBe("autosave-2");
  });

  it("degrades a corrupt stored value to 'no saves' instead of crashing", () => {
    // The unit env is node (no localStorage; the store falls back to memory
    // everywhere else in this file) — stub one holding a corrupt value:
    // "null" passes JSON.parse, and Object.entries(null) would brick the
    // overlay if read() trusted it.
    const backing = new Map<string, string>([["train-game:saves", "null"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    });
    try {
      expect(listSaves()).toEqual([]);
      expect(getSave("anything")).toBeNull();
      // …and the store recovers on the next write.
      putSave("fresh", mkSave("Fresh"));
      expect(listSaves().map(m => m.id)).toEqual(["fresh"]);
    } finally {
      vi.unstubAllGlobals();
      deleteSave("fresh");
    }
  });
});
