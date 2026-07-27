import {
  EconomySetup,
  GameMode,
  ModeContext,
  ModeSetup,
  TrainDef,
  objectiveFromSpec,
} from "@/modes/types";
import { Counters, StarSpec } from "@/sim/objectives";
import { FareSpec } from "@/sim/economy";
import { CalendarSetup } from "@/sim/calendar";

// Tycoon — the build-and-dispatch loop, phase 1.
//
// Train Valley's level-1 sentence, minus the building: a train WAITS in its
// station showing a fare that is already ticking down; you send it with a click,
// route it with the switches, and it pays whatever the fare has decayed to when
// it parks in its matching station. Money is the only score.
//
// The decay starting while the train waits (not when it departs) is the whole
// point — see design doc §1.2 M7. A fare that only fell in transit would reward
// leaving trains on the platform.
//
// Phase 2 (2026-07-26) added the missing verb: BUILD. `controls.build` arms
// PlayView's in-play build tool, which routes with the editor's extracted
// gesture (routeDrawController) and commits through `game.buildRoute` — spend
// then lay, atomically, at TRACK_COST_PER_TILE per new piece.
//
// Deliberately NOT here (each with a reason in the design doc): reversing
// trains (§5.2 — weeks of interlocking work to avoid with level design),
// crashes (§2.2 G7 — our interlocking makes them impossible and that is a
// feature), production chains (§5.1).

// What a delivery is worth before any decay. A loco is the fixed part; each
// wagon is cargo, so a longer consist is a bigger prize AND a slower one — the
// mass model already makes heavy trains accelerate and brake more gently.
export const BASE_FARE = 400;
export const FARE_PER_WAGON = 200;

// How fast the fare falls, in money per second. This is the mode's genre dial
// (design doc §4.2): steep → a twitchy dispatch game, shallow → a planning game.
// 20/sec against a ~800 fare gives roughly 20 seconds of "prompt", which is about
// one lap of a small board.
export const FARE_DECAY_PER_SEC = 20;

// Seed capital — the build budget (phase 2 spends it at TRACK_COST_PER_TILE).
// Three tiles of track: enough to close a small gap the direct way, not enough
// to wander, so an over-long route is refused and the refusal is a real
// mechanic rather than a theoretical branch.
export const STARTING_BALANCE = 3000;

// The share of the theoretical maximum payout that counts as "you dispatched
// promptly". Reachable but not free: it needs the trains sent as they appear,
// not one at a time.
const PAYDAY_FRACTION = 0.6;

export function fareFor(
  def: TrainDef,
  decayPerSec: number = FARE_DECAY_PER_SEC
): FareSpec {
  return {
    base: BASE_FARE + FARE_PER_WAGON * def.wagonIds.length,
    decayPerSec,
  };
}

export function economyFor(
  trains: TrainDef[],
  tuning: TycoonTuning = GENERIC_TUNING
): EconomySetup {
  const fares: Record<string, FareSpec> = {};
  for (const def of trains) fares[def.id] = fareFor(def, tuning.fareDecayPerSec);
  return {
    startingBalance: tuning.startingBalance,
    fares,
    ...(tuning.calendar && { calendar: tuning.calendar }),
  };
}

// The most this board could ever pay: every fare collected at its base value.
export function maxPayoutOf(trains: TrainDef[]): number {
  return trains.reduce((sum, def) => sum + fareFor(def).base, 0);
}

// Three stars on three different axes, as the design doc insists (§5.3): money,
// hands-off routing, and colour discipline. You cannot get all three casually.
function tycoonStars(maxPayout: number): StarSpec[] {
  const payday = Math.round(maxPayout * PAYDAY_FRACTION);
  return [
    {
      id: "payday",
      label: `Payday (${payday})`,
      predicate: (c: Counters) => (c.earned ?? 0) >= payday,
    },
    {
      id: "hands-off",
      label: "Hands off",
      predicate: (c: Counters) => c.manualHolds + c.manualGreens === 0,
    },
    {
      id: "perfect-colours",
      label: "Perfect colours",
      predicate: (c: Counters) => c.mismatchedArrivals === 0,
    },
  ];
}

// --- per-board tuning --------------------------------------------------------
//
// The generic numbers above work on any board the mode is dropped onto, but a
// hand-authored opening level tunes its budget and its goals against its own
// geometry — Train Valley's levels each name their own targets. Keyed by the
// BOARD id, i.e. the levelId tail: PlayView passes "board:<scenario>" and the
// /test stage passes "test:<scenario>", so both routes into the same board get
// the same game.
export interface TycoonTuning {
  startingBalance: number;
  fareDecayPerSec: number;
  stars: (maxPayout: number) => StarSpec[];
  // The second clock (M1/M13): an in-game year and the annual upkeep levied on
  // the track the player laid. OPT-IN PER BOARD, like every other dial here.
  //
  // It is deliberately absent from the generic tuning. A tax is a pressure the
  // level has to be balanced against — Train Valley sets it per level — and the
  // boards that fall through to the generic numbers are the tiny feature-test
  // scenarios, each of which exists to teach exactly ONE mechanic on a $3,000
  // budget. A levy there would both muddy the lesson and, on that budget,
  // dominate it. `/test/taxyear` is where the mechanic gets taught instead.
  calendar?: CalendarSetup;
}

const GENERIC_TUNING: TycoonTuning = {
  startingBalance: STARTING_BALANCE,
  fareDecayPerSec: FARE_DECAY_PER_SEC,
  stars: tycoonStars,
};

// Lake Valley opening state (`lakevalley-open`): the rebuild the board asks for
// is 7 pieces / $7,000 — 5 to close the ring along row 5, 2 more to rebuild the
// yellow station's T-junction entry at 2,5 (see the scenario file for the
// geometry). The budget covers that with exactly one spare piece: comfortable,
// not lavish. A lean 6-piece build also wins but needs a mid-run switch flip.
// The budget is deliberately GENEROUS — about twice the rebuild. Train Valley's
// own level 1 hands you 100,000$ against a ~10,000$ ring, a tenfold cushion: the
// opening level teaches the verbs and does its steering through GOALS, not
// through scarcity. Ours was $8,000 (one spare piece) and that was too tight for
// a first level, because we lack both of TV's safety nets — there is no bulldoze
// to refund a misdrag, and no bankruptcy state to explain the dead end, so a
// fumbled drag just soft-locks the board into Retry with no feedback. Discipline
// is still rewarded, by the Under budget star, which measures SPEND and is
// therefore unaffected by how much you were given.
export const LAKEVALLEY_OPEN_BALANCE = 15000;
// Slower burn than the generic dial: the fares tick while the player is still
// buying track, and at 20/sec everything would sit at its floor before the first
// train could possibly move. 5/sec (halved after playtesting — 10 still read as
// rushed while learning the build tool) leaves the base fare alive for 120s on a
// two-wagon train, so a first-timer can build deliberately and still be paid for
// dispatching promptly.
export const LAKEVALLEY_OPEN_DECAY = 5;
// "Under budget": win while spending at most this — the lean 6-piece build.
export const LAKEVALLEY_OPEN_LEAN_SPEND = 6000;
// "Rail baron": buy at least the full 7-piece restoration.
export const LAKEVALLEY_OPEN_RING_PIECES = 7;
// "Payday": gross income target, and the one star that has to be RE-MEASURED
// whenever the decay dial moves — it is the only goal denominated in money that
// time eats. Measured on the e2e's scripted prompt run (build, then dispatch all
// three at once): $1,763 of the $2,200 maximum at 5/sec, where the same run
// banked $1,188 at 10/sec. Letting every fare rot to its floor banks $550.
// $1,500 is ~85% of the prompt run: a player who builds deliberately and sends
// trains as they free up clears it, one who dawdles does not, and the e2e keeps
// real headroom instead of balancing on the exact optimum.
export const LAKEVALLEY_OPEN_PAYDAY = 1500;

// The second clock (design doc §1.3). A Lake Valley year lasts 15 sim-seconds
// and each piece of track the player laid costs $150 a year to keep — 15% of
// what it cost to lay, which is a steep railway, but the levels are decades.
//
// Both dials were MEASURED, not chosen (scripted playtest through the real UI;
// the win TIMES are the pre-existing measurements, re-confirmed). At the
// shipping numbers:
//
//   full rebuild, prompt   won 35s → 2 levies × $1,050 = $2,100, earned $1,760
//   lean rebuild           won 75s → 5 levies ×   $900 = $4,500, earned   $692
//   full rebuild, dawdled  won 95s → 6 levies × $1,050 = $6,300, earned   $866
//
// That is the opposition §1.3 asks for, in one board. The lean line saves
// $1,000 of capital and hands more than twice that back in upkeep, because it
// runs slower; the full line pays more per year and finishes before it matters.
// Both still finish in the black — they are alternate GOALS, not a right and a
// wrong answer (§1.3: goals reward playing DIFFERENTLY, not better) — while
// dawdling pays three times a prompt run's upkeep AND forfeits Payday. And the
// upkeep on a prompt full rebuild ($2,100) is more than that run earns
// ($1,760), which is the sentence the whole mechanic exists to say: this
// railway costs more to hold than it earns, so finish it.
//
// Two rejected settings, both on the measurement rather than on taste:
//  · 20s/year — the prompt run finished inside its SECOND year and so paid the
//    levy exactly once. A tax you pay once is a fee, not a clock. At 15s every
//    line pays at least twice.
//  · $200/piece — the dawdling line then ran the capital to −$400 before its
//    fares arrived, i.e. one bad run could no longer afford a rescue build. With
//    no bankruptcy state to explain that (deliberately out of scope, see §8),
//    a silent soft-lock is the worst thing this dial can buy. $150 leaves the
//    worst measured line $1,700 — a spare piece of track — and is pinned by a
//    unit test so the next tweak cannot quietly cross back over it.
//
// A 15-second year is short for a game whose levels "span decades", but the
// level is 35-95 seconds long; with a longer year the levy never lands in a
// winning run. Months tick every ~1.25s, so the date visibly moves.
export const LAKEVALLEY_OPEN_START_YEAR = 1830;
export const LAKEVALLEY_OPEN_SEC_PER_YEAR = 15;
export const LAKEVALLEY_OPEN_TAX_PER_PIECE = 150;

// Three goals that pull in different directions, Train Valley style (§1.2 M9 —
// level 1 asks for an extra train, 46 track pieces AND $5,000, and you cannot
// chase them all in one run): Payday wants prompt dispatch, Under budget wants
// the lean build, Rail baron wants the full one. Under budget and Rail baron
// are mutually exclusive by arithmetic (6 pieces max vs 7 pieces min), so the
// board is worth at least two runs. "Deliver every train" is not a star — it is
// the win condition itself (deliveriesRequired).
function lakevalleyOpenStars(): StarSpec[] {
  return [
    {
      id: "payday",
      label: `Payday ($${LAKEVALLEY_OPEN_PAYDAY.toLocaleString("en-US")})`,
      predicate: (c: Counters) => (c.earned ?? 0) >= LAKEVALLEY_OPEN_PAYDAY,
    },
    {
      // Reads `trackSpent`, NOT `spent`. Once the annual tax books through the
      // same ledger, `spent` is "track + upkeep" — and a star predicated on it
      // would be lost by DAWDLING rather than by over-building, i.e. it would
      // quietly stop measuring build discipline and start measuring time, which
      // is the axis Payday already scores. The alternative (keeping tax out of
      // `spent`) was rejected because it redefines a field documented as
      // "lifetime outgoings" and would leave the ledger no longer summing to the
      // balance. Splitting the STAR is the smaller, truer change.
      id: "under-budget",
      label: `Under budget ($${LAKEVALLEY_OPEN_LEAN_SPEND.toLocaleString("en-US")})`,
      predicate: (c: Counters) => (c.trackSpent ?? 0) <= LAKEVALLEY_OPEN_LEAN_SPEND,
    },
    {
      id: "rail-baron",
      label: `Rail baron (${LAKEVALLEY_OPEN_RING_PIECES} pieces)`,
      predicate: (c: Counters) =>
        (c.tilesBuilt ?? 0) >= LAKEVALLEY_OPEN_RING_PIECES,
    },
  ];
}

const LAKEVALLEY_OPEN_TUNING: TycoonTuning = {
  startingBalance: LAKEVALLEY_OPEN_BALANCE,
  fareDecayPerSec: LAKEVALLEY_OPEN_DECAY,
  stars: lakevalleyOpenStars,
  calendar: {
    startYear: LAKEVALLEY_OPEN_START_YEAR,
    secPerYear: LAKEVALLEY_OPEN_SEC_PER_YEAR,
    taxPerTrackPiecePerYear: LAKEVALLEY_OPEN_TAX_PER_PIECE,
  },
};

// `taxyear` — the feature-test board for the second clock (project rule: every
// mechanic ships a scenario that shows it in isolation). Everything here is
// dialled for WATCHING rather than for balance: a 10-second year so a levy
// lands while you are still looking at it, $300 a piece so the step in the
// balance is unmistakable, and a purse deep enough that several years pass
// without the board soft-locking. Deliveries are almost beside the point — the
// thing under test is the balance falling on a schedule you did not choose, by
// an amount you did.
export const TAXYEAR_BALANCE = 9000;
export const TAXYEAR_SEC_PER_YEAR = 10;
export const TAXYEAR_TAX_PER_PIECE = 300;

const TAXYEAR_TUNING: TycoonTuning = {
  startingBalance: TAXYEAR_BALANCE,
  // The generic 20/s would floor both fares before a single year turned, and
  // this board is about the tax, not the fare.
  fareDecayPerSec: LAKEVALLEY_OPEN_DECAY,
  stars: tycoonStars,
  calendar: {
    startYear: 1830,
    secPerYear: TAXYEAR_SEC_PER_YEAR,
    taxPerTrackPiecePerYear: TAXYEAR_TAX_PER_PIECE,
  },
};

// The board id is the levelId tail ("board:x" from /play, "test:x" from /test).
export function boardIdOf(levelId: string): string {
  const i = levelId.indexOf(":");
  return i < 0 ? levelId : levelId.slice(i + 1);
}

// `bankrupt` — the feature-test board for the FAIL half of the second clock.
// Where `taxyear` has a deep purse and exists to be watched, this one is tuned
// so the upkeep is a countdown: a tight $5,000, an eight-second year, and $600
// a piece. Close the two-tile gap ($2,000) and you can afford exactly two
// levies; the third arrives around 24s and the railway folds. A prompt run
// delivers well inside that, a dawdled one does not, and an over-built one
// folds sooner still — with bulldoze as the way back, which is the whole reason
// the HUD warns before the bill lands rather than after.
export const BANKRUPT_BALANCE = 6000;
export const BANKRUPT_SEC_PER_YEAR = 8;
export const BANKRUPT_TAX_PER_PIECE = 600;

const BANKRUPT_TUNING: TycoonTuning = {
  startingBalance: BANKRUPT_BALANCE,
  fareDecayPerSec: LAKEVALLEY_OPEN_DECAY,
  stars: tycoonStars,
  calendar: {
    startYear: 1830,
    secPerYear: BANKRUPT_SEC_PER_YEAR,
    taxPerTrackPiecePerYear: BANKRUPT_TAX_PER_PIECE,
  },
};

const TUNING_BY_BOARD: Record<string, TycoonTuning> = {
  "lakevalley-open": LAKEVALLEY_OPEN_TUNING,
  taxyear: TAXYEAR_TUNING,
  bankrupt: BANKRUPT_TUNING,
};

export function tuningFor(levelId: string): TycoonTuning {
  return TUNING_BY_BOARD[boardIdOf(levelId)] ?? GENERIC_TUNING;
}

export const tycoonMode: GameMode = {
  id: "tycoon",
  label: "Tycoon / Dispatch",
  description:
    "Every train waits in its station with a fare that is already ticking " +
    "down. Send it, route it, bank whatever is left when it gets home.",
  setup(ctx: ModeContext): ModeSetup {
    const tuning = tuningFor(ctx.levelId);
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: {
        deliveriesRequired: ctx.trains.length,
        // Every train is in play from t=0 — waiting counts as in play, since its
        // fare is already burning. Without this the tracker's live `active`
        // backlog counts down through zero into negatives.
        initialActiveTrains: ctx.trains.length,
        // The tax's other half. Until it existed the only way to empty the
        // purse was to over-spend on track, i.e. to make a mistake you could
        // see; now TIME drains it too, and a board that silently stops
        // responding to the build tool is the worst kind of dead end. Declared
        // unconditionally because it is self-gating: no calendar ⇒ no levy ⇒ no
        // shortfall ⇒ this can never fire.
        fail: { onBankruptcy: true },
        stars: tuning.stars(maxPayoutOf(ctx.trains)),
      },
      economy: economyFor(ctx.trains, tuning),
    };
  },
  controls: {
    switches: true,
    signalHolds: true,
    crossingGate: false,
    // Phase 2: the Train Valley loop's missing half. Track costs
    // TRACK_COST_PER_TILE out of the same pool the fares fill.
    build: true,
    dispatch: true,
  },
  createObjective: objectiveFromSpec,
  hud: {
    deliveries: true,
    timer: true,
    stars: true,
    startOverlay: true,
    endOverlay: true,
    money: true,
  },
};
