import {
  EconomySetup,
  GameMode,
  ModeContext,
  ModeSetup,
  Spawner,
  TrainDef,
  objectiveFromSpec,
} from "@/modes/types";
import { createScheduleSpawner, scheduleFor } from "@/modes/schedule";
import { Counters, StarSpec } from "@/sim/objectives";
import { FareSpec, fareFloor } from "@/sim/economy";
import { CalendarSetup } from "@/sim/calendar";
import { DEFAULT_SPEED } from "@/sim/simulation";
import { parseCoordId } from "@/tiles/model";

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

// --- what a delivery is worth ------------------------------------------------
//
// A fare answers two questions at once, and they need different terms:
//
//   "was this job worth doing?"   → the BASE, priced from the demand: cargo and
//                                   how far it has to travel.
//   "did you do it well?"         → the DECAY, normalised to that same distance,
//                                   so a long haul is a bigger prize and NOT a
//                                   harder one to score.
//
// Before 2026-07-26 the base was cargo-only and the decay a flat per-board rate,
// which meant distance was priced ONLY as decay eaten in transit: a far delivery
// was strictly worse than a near one, and on a demoworld-sized board the map's
// most interesting geometry paid worst. Both halves below exist to fix that.

// The fixed part of a fare: what any delivery is worth for happening at all.
export const FARE_HANDLING = 250;
// Per wagon of cargo. Freight wagons pay more because they weigh more —
// `physics.ts` gives a freight wagon 1.6x a passenger wagon's weight, so a
// freight consist genuinely pulls away and stops more slowly. The premium is
// the compensation for hauling it, not flavour.
export const FARE_PER_WAGON = { people: 150, fraight: 200 } as const;
// Per tile of DEMAND distance (see `demandTilesOf` — straight-line, not the
// route actually driven, so a scenic detour cannot pay for itself).
export const FARE_PER_TILE = 35;

// What a train is priced for when a level names no destination for it (a demo
// board, a scenery train). A middling haul rather than 0, so an unpaired train
// is worth something sane instead of collapsing to the handling fee with an
// undefined ideal travel time.
export const FALLBACK_DEMAND_TILES = 6;

// How many times the IDEAL travel time a fare survives before it bottoms out at
// its floor. This — not a money-per-second rate — is the mode's genre dial now
// (design doc §4.2): a small grace makes a twitchy dispatch game, a large one a
// planning game, and because it is measured in trips rather than seconds it
// means the same thing on a 3-tile test lane and on a 20-tile ring.
//
// 4 reproduces the old flat 20/sec on a small board, which is roughly "one lap
// to think about it, then you are losing money".
export const GENERIC_FARE_GRACE = 4;

// Seed capital — the build budget (phase 2 spends it at TRACK_COST_PER_TILE).
// Three tiles of track: enough to close a small gap the direct way, not enough
// to wander, so an over-long route is refused and the refusal is a real
// mechanic rather than a theoretical branch.
export const STARTING_BALANCE = 3000;

// The share of the theoretical maximum payout that counts as "you dispatched
// promptly". Reachable but not free: it needs the trains sent as they appear,
// not one at a time.
const PAYDAY_FRACTION = 0.6;

// Manhattan tiles from the train's depot through the depots it is asked to
// reach, in order. STRAIGHT-LINE on purpose, not the shortest rail path:
//   - on a build board (lakevalley-open, buildgap) the rail does not exist yet
//     at setup, so a path query would answer null exactly when it matters;
//   - it prices the DEMAND, so it cannot be inflated by routing the long way
//     round, and it does not change under the player's own track edits.
// Manhattan rather than Euclidean because our trains only ever travel along
// grid edges, so it is the honest lower bound on the trip.
export function demandTilesOf(def: TrainDef): number {
  const legs = def.destinations ?? [];
  if (legs.length === 0) return FALLBACK_DEMAND_TILES;
  let tiles = 0;
  let [x, y] = [def.x, def.y];
  for (const to of legs) {
    const { x: tx, y: ty } = parseCoordId(to);
    tiles += Math.abs(tx - x) + Math.abs(ty - y);
    [x, y] = [tx, ty];
  }
  // A same-tile "demand" would divide by zero in the decay below; one tile is
  // the smallest trip the board can actually contain.
  return Math.max(1, tiles);
}

// Seconds this delivery would take if the line were clear and straight: the
// yardstick the decay is normalised against. Uses the sim's own cruise speed, so
// retuning train speed retunes the fares with it.
export function idealTravelSec(tiles: number): number {
  return tiles / DEFAULT_SPEED;
}

export function fareFor(
  def: TrainDef,
  grace: number = GENERIC_FARE_GRACE
): FareSpec {
  const tiles = demandTilesOf(def);
  const base =
    FARE_HANDLING +
    FARE_PER_WAGON[def.type] * def.wagonIds.length +
    FARE_PER_TILE * tiles;
  // Spend the whole decayable part (base down to the floor) over `grace` ideal
  // trips, so every train on the board has the same shape: full fare if sent at
  // once and routed well, floor only if you take many times longer than the job
  // needs. Distance therefore raises the prize without raising the difficulty.
  const spec: FareSpec = { base, decayPerSec: 0 };
  const decayable = base - fareFloor(spec);
  return { base, decayPerSec: decayable / (grace * idealTravelSec(tiles)) };
}

export function economyFor(
  trains: TrainDef[],
  tuning: TycoonTuning = GENERIC_TUNING
): EconomySetup {
  const fares: Record<string, FareSpec> = {};
  for (const def of trains) fares[def.id] = fareFor(def, tuning.fareGrace);
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
      hint: "Bank at least that much in fares",
      predicate: (c: Counters) => (c.earned ?? 0) >= payday,
    },
    {
      id: "hands-off",
      label: "Hands off",
      hint: "Win without holding or forcing a single signal",
      predicate: (c: Counters) => c.manualHolds + c.manualGreens === 0,
    },
    {
      id: "perfect-colours",
      label: "Perfect colours",
      hint: "No train ever arrives at the wrong station",
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
  // Ideal trips a fare survives before bottoming out (see GENERIC_FARE_GRACE).
  fareGrace: number;
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
  fareGrace: GENERIC_FARE_GRACE,
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
// Twice the generic grace: on this board the fares tick while the player is
// still learning the build tool and buying track, and at the generic 4 trips
// everything would be at its floor before the first train could possibly move.
// 8 ideal trips reproduces the hand-tuned 5/sec this board carried before fares
// were normalised (blue: $830 over 128s ⇒ 4.9/sec), so the playtested feel is
// preserved — it is now expressed as "you get eight trips' worth of thinking
// time" instead of a number that only meant anything on this one map.
export const LAKEVALLEY_OPEN_GRACE = 8;
// "Under budget": win while spending at most this — the lean 6-piece build.
export const LAKEVALLEY_OPEN_LEAN_SPEND = 6000;
// "Rail baron": buy at least the full 7-piece restoration.
export const LAKEVALLEY_OPEN_RING_PIECES = 7;
// "Payday": gross income target, and the one star that has to be RE-MEASURED
// whenever the pricing moves — it is the only goal denominated in money that
// time eats. Re-measured 2026-07-26 after fares were priced by distance and the
// decay normalised, all in a real browser on this board:
//   prompt run (build, then dispatch all three at once)   $2,040 of $2,440 max
//   same run but sent 60s late                            $1,140
//   every fare left to rot to its 25% floor                 $611
// $1,700 is ~85% of the prompt run: a player who builds deliberately and sends
// the trains as they free up clears it, one who dawdles does not, and the e2e
// keeps real headroom instead of balancing on the exact optimum.
//
// Note this board CANNOT be played one train at a time: the three demands form
// a 3-cycle (blue→red's shed→yellow's shed→blue's), so nobody can park until
// everybody has left. Sending all three is the board's lesson, not an optimum.
export const LAKEVALLEY_OPEN_PAYDAY = 1700;

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
      hint: "Bank at least that much in fares - send trains promptly",
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
      hint: "Spend no more than that on track",
      predicate: (c: Counters) => (c.trackSpent ?? 0) <= LAKEVALLEY_OPEN_LEAN_SPEND,
    },
    {
      id: "rail-baron",
      label: `Rail baron (${LAKEVALLEY_OPEN_RING_PIECES} pieces)`,
      hint: "Buy the full restoration - rules out Under budget",
      predicate: (c: Counters) =>
        (c.tilesBuilt ?? 0) >= LAKEVALLEY_OPEN_RING_PIECES,
    },
  ];
}

const LAKEVALLEY_OPEN_TUNING: TycoonTuning = {
  startingBalance: LAKEVALLEY_OPEN_BALANCE,
  fareGrace: LAKEVALLEY_OPEN_GRACE,
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
  // The generic grace would floor both fares before a single year turned, and
  // this board is about the tax, not the fare — so it borrows the opening
  // level's slower burn.
  fareGrace: LAKEVALLEY_OPEN_GRACE,
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
  // The fares are not the point here either  borrow the opening level's
  // slower burn so the TAX is what runs the clock down.
  fareGrace: LAKEVALLEY_OPEN_GRACE,
  stars: tycoonStars,
  calendar: {
    startYear: 1830,
    secPerYear: BANKRUPT_SEC_PER_YEAR,
    taxPerTrackPiecePerYear: BANKRUPT_TAX_PER_PIECE,
  },
};

// Land prices (`landprices`): the terrain build surcharge in isolation. The
// three-tile gap crosses grass, wood and town — $1,000 + $1,500 + $2,500 =
// $5,000 for the direct link (TERRAIN_BUILD_FACTOR × TRACK_COST_PER_TILE) —
// and the budget covers that with one spare grass piece: the surcharge, not
// the base rate, is what makes a wandering route unaffordable.
export const LANDPRICES_BALANCE = 6000;

const LANDPRICES_TUNING: TycoonTuning = {
  startingBalance: LANDPRICES_BALANCE,
  fareGrace: GENERIC_FARE_GRACE,
  stars: tycoonStars,
};

const TUNING_BY_BOARD: Record<string, TycoonTuning> = {
  "lakevalley-open": LAKEVALLEY_OPEN_TUNING,
  taxyear: TAXYEAR_TUNING,
  bankrupt: BANKRUPT_TUNING,
  landprices: LANDPRICES_TUNING,
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
    // TIMED ARRIVALS. A board whose trains carry a spawnAtSec runs as a SHIFT
    // rather than a pile: some trains stand in their sheds at t=0 and the rest
    // arrive during the run, each appearing at its platform in the "waiting"
    // state (the sim's addTrain honours waitForDispatch), fare ticking, asking
    // to be sent. Puzzle has read the same board data since #113 — this is the
    // identical schedule, arriving in a mode that charges for it. A board with
    // no spawnAtSec anywhere is untouched.
    const scheduled = ctx.trains.filter(t => (t.spawnAtSec ?? 0) > 0);
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: {
        deliveriesRequired: ctx.trains.length,
        // Trains in play at t=0 — waiting counts as in play, since its fare is
        // already burning. Without this the tracker's live `active` backlog
        // counts down through zero into negatives. A SCHEDULED train is not in
        // play yet: counting it here would open the level with a backlog that
        // includes trains nobody can see, and every later arrival would then be
        // double-counted against it.
        initialActiveTrains: ctx.trains.length - scheduled.length,
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
  // The schedule cursor, from the same helper Puzzle uses — a spawner is a pure
  // schedule cursor and game.ts performs the injection, so nothing about it is
  // mode-specific. Yields an empty schedule (and therefore never fires) for
  // every board authored without a spawnAtSec.
  createSpawner(setup: ModeSetup): Spawner {
    return createScheduleSpawner(scheduleFor(setup.trains));
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
  fits(caps) {
    // The whole loop is fares on dispatched trains; build alone earns nothing.
    return caps.trains > 0 ? null : "Needs a train to dispatch";
  },
};
