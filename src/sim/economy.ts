// The money model: a pure ledger and a book of decaying fares.
//
// This sits beside `objectives.ts` and follows the same rules — plain data and
// pure reducers, no Vue, no DOM, deterministic under a fixed dt sequence. The
// objective tracker scores the *outcome* of a run; this owns the *resource* a
// run spends and earns. `game.ts` is the only place the two meet.
//
// Design notes: docs/superpowers/specs/2026-07-25-train-valley-mode-design.md
// (§2.2 G1, phase 1). Money is deliberately the single resource: track, clearing
// and calling trains will all drain the same pool that deliveries fill, so every
// decision stays comparable without a second tutorial.

// Why money moved. Kept as a closed union so the log can be grouped/filtered and
// a typo can't invent a category. `build`/`clearing` are unused in phase 1 — the
// in-play build tool is phase 2 — but naming them here is what stops the ledger
// from being retrofitted with a stringly-typed reason later.
export type LedgerReason =
  | "fare" // a delivery paid out
  | "build" // track laid (phase 2)
  | "clearing" // scenery cleared (phase 3)
  | "tax" // periodic upkeep (phase 4)
  | "dispatch" // calling an extra train (phase 5)
  | "adjustment"; // a level's own bookkeeping

// One signed movement of money. `amount` is positive for income and negative for
// spending, so the log sums to the balance and needs no second field to read.
export interface LedgerEntry {
  seq: number; // monotonic within a run, so the log has a stable order
  atSec: number; // sim time the entry was booked at
  amount: number; // signed: + earned, − spent
  reason: LedgerReason;
  label?: string; // what exactly (a train id, a tile count, …)
}

export interface EconomySpec {
  // What the player starts the level with.
  startingBalance?: number;
  // Whether `spend()` may take the balance below zero. Off by default: a level
  // that cannot afford something should refuse it, not quietly go into debt.
  allowDebt?: boolean;
  // Ring cap on the entry log, so a long session can't grow without bound. The
  // running totals are kept separately, so trimming the log never loses money.
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 200;

export interface Economy {
  readonly balance: number;
  readonly earned: number; // lifetime income this run
  readonly spent: number; // lifetime outgoings this run (positive)
  readonly entries: readonly LedgerEntry[];
  // Advance the ledger's clock so entries carry a sim timestamp. Callers already
  // own the clock; this keeps `earn`/`spend` to the two arguments that matter.
  tick(dt: number): void;
  earn(amount: number, reason: LedgerReason, label?: string): LedgerEntry | null;
  canAfford(amount: number): boolean;
  // Books the spend and returns its entry, or null when it was refused (an
  // unaffordable amount with debt disallowed). Callers must treat null as "the
  // purchase did not happen" — it is the same answer as a failed edit.
  spend(amount: number, reason: LedgerReason, label?: string): LedgerEntry | null;
  reset(): void;
}

export function createEconomy(spec: EconomySpec = {}): Economy {
  const start = spec.startingBalance ?? 0;
  const maxEntries = spec.maxEntries ?? DEFAULT_MAX_ENTRIES;
  let balance = start;
  let earned = 0;
  let spent = 0;
  let seq = 0;
  let clock = 0;
  let entries: LedgerEntry[] = [];

  function book(amount: number, reason: LedgerReason, label?: string): LedgerEntry {
    const entry: LedgerEntry = { seq: seq++, atSec: clock, amount, reason, label };
    entries.push(entry);
    if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
    return entry;
  }

  return {
    get balance() {
      return balance;
    },
    get earned() {
      return earned;
    },
    get spent() {
      return spent;
    },
    get entries() {
      return entries;
    },
    tick(dt: number) {
      clock += dt;
    },
    earn(amount, reason, label) {
      // A zero/negative payout is a no-op rather than an error: a fare that has
      // decayed to nothing should leave no trace in the log.
      if (!(amount > 0)) return null;
      balance += amount;
      earned += amount;
      return book(amount, reason, label);
    },
    canAfford(amount) {
      if (!(amount > 0)) return true;
      return (spec.allowDebt ?? false) || balance >= amount;
    },
    spend(amount, reason, label) {
      if (!(amount > 0)) return null;
      if (!(spec.allowDebt ?? false) && balance < amount) return null;
      balance -= amount;
      spent += amount;
      return book(-amount, reason, label);
    },
    reset() {
      balance = start;
      earned = 0;
      spent = 0;
      seq = 0;
      clock = 0;
      entries = [];
    },
  };
}

// --- fares -------------------------------------------------------------------
//
// A train carries a fare that FALLS with time, and the clock starts while the
// train is still WAITING in its station (Train Valley M7: 2000$ → 1700$ → 1600$
// before it has moved). That is the whole reason prompt dispatch matters — a
// fare that only decayed in transit would reward dawdling at the platform.
//
// The curve is a designer dial, not a constant (design doc §4.2): a steep decay
// makes a twitchy dispatch game, a shallow one makes a build-planning game.

export interface FareSpec {
  base: number; // the payout for an instant delivery
  decayPerSec: number; // money lost per second of the train's life
  // The payout never falls below this. Defaults to a fraction of `base` so a
  // long haul is still worth running; an explicit 0 means it can decay away.
  floor?: number;
}

// A quarter of the base: late is bad, but never worthless. Chosen so a slow run
// still funds something rather than turning the level into an instant loss.
export const DEFAULT_FARE_FLOOR_FRAC = 0.25;

export function fareFloor(spec: FareSpec): number {
  return spec.floor ?? Math.round(spec.base * DEFAULT_FARE_FLOOR_FRAC);
}

// The payout for a train that has been alive `ageSec` seconds. Whole money only
// — a fractional fare would render as noise and make ledger totals irreproducible.
export function fareAt(spec: FareSpec, ageSec: number): number {
  const decayed = spec.base - spec.decayPerSec * Math.max(0, ageSec);
  return Math.max(fareFloor(spec), Math.round(decayed));
}

// Per-train fare state for one run. Ages every unsettled fare on `tick`, and
// `settle` freezes one at the moment of delivery and hands back what it is worth.
export interface FareBook {
  add(trainId: string, spec: FareSpec): void;
  has(trainId: string): boolean;
  ids(): string[];
  // Seconds this train's fare has been decaying (0 for an unknown train).
  ageOf(trainId: string): number;
  // What the fare is worth right now (0 for an unknown or already-settled train).
  valueOf(trainId: string): number;
  // The most this run can possibly pay out: every fare at its base. The
  // yardstick a "you dispatched promptly" star scores against.
  maxPayout(): number;
  isSettled(trainId: string): boolean;
  tick(dt: number): void;
  // Freeze this fare and return the payout. Idempotent: a second call returns 0,
  // so a duplicated arrival event can never pay twice.
  settle(trainId: string): number;
  // Back to age 0, nothing settled — for a true do-over (game.reset()).
  reset(): void;
}

export function createFareBook(specs: Record<string, FareSpec> = {}): FareBook {
  const fares = new Map<string, FareSpec>(Object.entries(specs));
  const ages = new Map<string, number>();
  const settled = new Set<string>();
  for (const id of fares.keys()) ages.set(id, 0);

  return {
    add(trainId, spec) {
      fares.set(trainId, spec);
      ages.set(trainId, 0);
      settled.delete(trainId);
    },
    has: trainId => fares.has(trainId),
    ids: () => [...fares.keys()],
    ageOf: trainId => ages.get(trainId) ?? 0,
    valueOf(trainId) {
      const spec = fares.get(trainId);
      if (!spec || settled.has(trainId)) return 0;
      return fareAt(spec, ages.get(trainId) ?? 0);
    },
    maxPayout() {
      let total = 0;
      for (const spec of fares.values()) total += spec.base;
      return total;
    },
    isSettled: trainId => settled.has(trainId),
    tick(dt) {
      if (!(dt > 0)) return;
      for (const id of fares.keys()) {
        if (settled.has(id)) continue;
        ages.set(id, (ages.get(id) ?? 0) + dt);
      }
    },
    settle(trainId) {
      const spec = fares.get(trainId);
      if (!spec || settled.has(trainId)) return 0;
      const value = fareAt(spec, ages.get(trainId) ?? 0);
      settled.add(trainId);
      return value;
    },
    reset() {
      settled.clear();
      for (const id of fares.keys()) ages.set(id, 0);
    },
  };
}
