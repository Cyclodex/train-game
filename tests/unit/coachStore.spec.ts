import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { coachSeenStore, loadSeen, recordSeen, resetSeen } from "@/coachStore";

// The once-per-player memory behind tier-"player" coach-marks: one
// localStorage key, a JSON array of mark ids. The suite runs in the node
// environment (no DOM), so localStorage is stubbed with a minimal in-memory
// Storage — which also documents that the helpers only need getItem/setItem/
// removeItem.
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: k => map.get(k) ?? null,
    key: i => [...map.keys()][i] ?? null,
    removeItem: k => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

const hadStorage = "localStorage" in globalThis;
(globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
afterAll(() => {
  if (!hadStorage) delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("coachStore", () => {
  beforeEach(() => resetSeen());

  it("starts empty and remembers what was recorded", () => {
    expect(loadSeen().size).toBe(0);
    recordSeen("held-train");
    recordSeen("first-levy");
    expect([...loadSeen()].sort()).toEqual(["first-levy", "held-train"]);
  });

  it("reset forgets everything (the 'Reset hints' escape hatch)", () => {
    recordSeen("held-train");
    resetSeen();
    expect(loadSeen().size).toBe(0);
  });

  it("survives garbage in the key rather than throwing", () => {
    localStorage.setItem("train-game:coach-seen", "{not json");
    expect(loadSeen().size).toBe(0);
    localStorage.setItem("train-game:coach-seen", JSON.stringify({ a: 1 }));
    expect(loadSeen().size).toBe(0);
    localStorage.setItem("train-game:coach-seen", JSON.stringify(["ok", 7]));
    expect([...loadSeen()]).toEqual(["ok"]);
  });

  it("the live store reads once and writes through", () => {
    const store = coachSeenStore();
    expect(store.has("held-train")).toBe(false);
    store.add("held-train");
    expect(store.has("held-train")).toBe(true);
    // Written through to storage, so the NEXT session's store sees it.
    expect(loadSeen().has("held-train")).toBe(true);
    // Idempotent.
    store.add("held-train");
    expect([...loadSeen()]).toEqual(["held-train"]);
  });
});
