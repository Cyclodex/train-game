import { describe, it, expect } from "vitest";
import {
  createEconomy,
  createFareBook,
  fareAt,
  fareFloor,
  fareStepAmount,
  fareStepSec,
  DEFAULT_FARE_FLOOR_FRAC,
  DEFAULT_FARE_STEP_SEC,
} from "@/sim/economy";

describe("economy ledger", () => {
  it("starts at its starting balance with nothing earned or spent", () => {
    const eco = createEconomy({ startingBalance: 1000 });
    expect(eco.balance).toBe(1000);
    expect(eco.earned).toBe(0);
    expect(eco.spent).toBe(0);
    expect(eco.entries).toEqual([]);
  });

  it("defaults to a zero starting balance", () => {
    expect(createEconomy().balance).toBe(0);
  });

  it("earning raises the balance and logs a positive entry", () => {
    const eco = createEconomy({ startingBalance: 100 });
    const entry = eco.earn(250, "fare", "blue");
    expect(eco.balance).toBe(350);
    expect(eco.earned).toBe(250);
    expect(entry).toMatchObject({ amount: 250, reason: "fare", label: "blue" });
  });

  it("spending lowers the balance and logs a NEGATIVE entry, so the log sums to the balance", () => {
    const eco = createEconomy({ startingBalance: 1000 });
    eco.earn(500, "fare");
    eco.spend(300, "build", "3 tiles");
    expect(eco.balance).toBe(1200);
    expect(eco.spent).toBe(300);
    const sum = eco.entries.reduce((a, e) => a + e.amount, 0);
    expect(1000 + sum).toBe(eco.balance);
  });

  it("refuses an unaffordable spend rather than going into debt", () => {
    const eco = createEconomy({ startingBalance: 100 });
    expect(eco.canAfford(101)).toBe(false);
    expect(eco.spend(101, "build")).toBeNull();
    expect(eco.balance).toBe(100);
    expect(eco.spent).toBe(0);
    expect(eco.entries).toHaveLength(0);
  });

  it("allows debt when the level opts in", () => {
    const eco = createEconomy({ startingBalance: 100, allowDebt: true });
    expect(eco.canAfford(500)).toBe(true);
    expect(eco.spend(500, "tax")).not.toBeNull();
    expect(eco.balance).toBe(-400);
  });

  it("ignores non-positive amounts instead of logging noise", () => {
    const eco = createEconomy({ startingBalance: 50 });
    expect(eco.earn(0, "fare")).toBeNull();
    expect(eco.spend(0, "build")).toBeNull();
    expect(eco.earn(-10, "fare")).toBeNull();
    expect(eco.balance).toBe(50);
    expect(eco.entries).toHaveLength(0);
  });

  it("timestamps entries from its own ticked clock", () => {
    const eco = createEconomy();
    eco.tick(1.5);
    eco.earn(10, "fare");
    eco.tick(2);
    eco.earn(10, "fare");
    expect(eco.entries.map(e => e.atSec)).toEqual([1.5, 3.5]);
    expect(eco.entries.map(e => e.seq)).toEqual([0, 1]);
  });

  it("caps the entry log without losing money", () => {
    const eco = createEconomy({ maxEntries: 3 });
    for (let i = 0; i < 10; i++) eco.earn(5, "fare");
    expect(eco.entries).toHaveLength(3);
    expect(eco.balance).toBe(50);
    expect(eco.earned).toBe(50);
  });

  it("reset returns to the starting state (a true do-over)", () => {
    const eco = createEconomy({ startingBalance: 400 });
    eco.tick(10);
    eco.earn(100, "fare");
    eco.spend(50, "build");
    eco.reset();
    expect(eco.balance).toBe(400);
    expect(eco.earned).toBe(0);
    expect(eco.spent).toBe(0);
    expect(eco.entries).toEqual([]);
    eco.earn(1, "fare");
    expect(eco.entries[0]).toMatchObject({ seq: 0, atSec: 0 });
  });
});

describe("fare decay", () => {
  const spec = { base: 1000, decayPerSec: 20 };
  const step = DEFAULT_FARE_STEP_SEC;

  it("pays the full base for an instant delivery", () => {
    expect(fareAt(spec, 0)).toBe(1000);
  });

  it("falls with time — the reason prompt dispatch matters", () => {
    expect(fareAt(spec, step)).toBe(920);
    expect(fareAt(spec, 5 * step)).toBe(600);
  });

  it("falls in STEPS, not per frame: the number holds, then drops in one chunk", () => {
    expect(fareStepSec(spec)).toBe(step);
    expect(fareStepAmount(spec)).toBe(spec.decayPerSec * step);
    // Anywhere inside a step the fare is the same number — this is what stops
    // the pin from flickering every frame.
    expect(fareAt(spec, 0)).toBe(1000);
    expect(fareAt(spec, step - 0.01)).toBe(1000);
    expect(fareAt(spec, step)).toBe(1000 - fareStepAmount(spec));
    expect(fareAt(spec, 2 * step - 0.01)).toBe(1000 - fareStepAmount(spec));
    expect(fareAt(spec, 2 * step)).toBe(1000 - 2 * fareStepAmount(spec));
  });

  it("sits ON the old continuous curve at every step boundary — the rate is unchanged", () => {
    for (const n of [1, 2, 3, 7]) {
      const age = n * step;
      expect(fareAt(spec, age)).toBe(spec.base - spec.decayPerSec * age);
    }
  });

  it("honours a per-fare step, including stepSec 0 for the raw slope", () => {
    expect(fareAt({ ...spec, stepSec: 10 }, 9.9)).toBe(1000);
    expect(fareAt({ ...spec, stepSec: 10 }, 10)).toBe(800);
    expect(fareAt({ ...spec, stepSec: 0 }, 5)).toBe(900);
  });

  it("never falls below the floor (a quarter of base by default)", () => {
    expect(fareFloor(spec)).toBe(spec.base * DEFAULT_FARE_FLOOR_FRAC);
    expect(fareAt(spec, 1000)).toBe(250);
  });

  it("honours an explicit floor, including a floor of zero", () => {
    expect(fareAt({ ...spec, floor: 600 }, 1000)).toBe(600);
    expect(fareAt({ ...spec, floor: 0 }, 1000)).toBe(0);
  });

  it("always pays whole money", () => {
    expect(Number.isInteger(fareAt({ base: 333, decayPerSec: 7 }, 3.7))).toBe(true);
    expect(Number.isInteger(fareAt({ base: 333, decayPerSec: 7.3 }, 30))).toBe(true);
  });
});

describe("fare book", () => {
  const specs = {
    a: { base: 1000, decayPerSec: 20 },
    b: { base: 600, decayPerSec: 10 },
  };

  it("ages every unsettled fare on tick", () => {
    const book = createFareBook(specs);
    book.tick(5); // one 4s step gone
    expect(book.ageOf("a")).toBe(5);
    expect(book.valueOf("a")).toBe(920);
    expect(book.valueOf("b")).toBe(560);
  });

  it("settles at the value the fare has decayed to, and only once", () => {
    const book = createFareBook(specs);
    book.tick(12); // three steps
    expect(book.settle("a")).toBe(760);
    expect(book.isSettled("a")).toBe(true);
    // Idempotent: a duplicated arrival event cannot pay twice.
    expect(book.settle("a")).toBe(0);
    expect(book.valueOf("a")).toBe(0);
  });

  it("stops ageing a settled fare but keeps ageing the rest", () => {
    const book = createFareBook(specs);
    book.tick(10);
    book.settle("a");
    book.tick(10);
    expect(book.ageOf("a")).toBe(10);
    expect(book.ageOf("b")).toBe(20);
  });

  it("knows the most a run could ever pay out", () => {
    expect(createFareBook(specs).maxPayout()).toBe(1600);
  });

  it("is silent about trains it does not know", () => {
    const book = createFareBook(specs);
    expect(book.has("ghost")).toBe(false);
    expect(book.valueOf("ghost")).toBe(0);
    expect(book.settle("ghost")).toBe(0);
  });

  it("takes trains added mid-run at full value", () => {
    const book = createFareBook(specs);
    book.tick(10);
    book.add("c", { base: 500, decayPerSec: 10 });
    expect(book.valueOf("c")).toBe(500);
    book.tick(5);
    expect(book.valueOf("c")).toBe(460);
  });

  it("reset un-settles everything at full value", () => {
    const book = createFareBook(specs);
    book.tick(20);
    book.settle("a");
    book.reset();
    expect(book.isSettled("a")).toBe(false);
    expect(book.valueOf("a")).toBe(1000);
    expect(book.ageOf("b")).toBe(0);
  });

  it("is deterministic: the same dt sequence gives the same payout", () => {
    const run = () => {
      const book = createFareBook(specs);
      for (let i = 0; i < 37; i++) book.tick(0.16);
      return book.settle("a");
    };
    expect(run()).toBe(run());
  });
});
