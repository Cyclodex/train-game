// The second clock: an in-game calendar, and the annual levy that falls due on
// it. Pure maths — no Vue, no DOM, deterministic — like everything else in
// `src/sim/`. `game.ts` is the only place it meets the ledger.
//
// Design notes: docs/superpowers/specs/2026-07-25-train-valley-mode-design.md
// §1.2 M1/M13 and §1.3 "two clocks, opposed". Train Valley's HUD reads "Feb
// 1832" with a tax figure beside the capital, and levels span decades — the
// point is not the date but that time is a SECOND way to lose money, pulling
// against the fare decay:
//
//   · the fare decays  → hurry
//   · the tax accrues  → build lean
//
// Neither is a timer bar; both are money, so they stay comparable (§1.3, "one
// resource"). That opposition is the whole reason the tax is charged PER PIECE
// OF TRACK rather than as a flat annual sum: a flat levy is just a steeper fare
// decay wearing a hat — it pushes in the same direction and the player decides
// nothing about it. Upkeep on the network you chose to lay is a decision.
//
// Only track the PLAYER laid is taxed. The authored board is the company's
// existing line, already paid for; taxing it would be a constant the player
// cannot act on, which is exactly what §1.3 says a tax must not be. It also
// means a dispatch-only board (`/test/dispatch`) pays nothing without needing a
// special case.

export interface CalendarSetup {
  // The year the level opens in. Cosmetic, but it is what makes the readout a
  // calendar rather than a stopwatch (M13).
  startYear: number;
  // How many SIM seconds one in-game year lasts. The genre dial, same shape as
  // the fare's `decayPerSec`: short → the tax is a drumbeat, long → it is a
  // distant deadline. Must be > 0; anything else disables the calendar.
  secPerYear: number;
  // The annual levy per piece of track the player has bought this run, net of
  // bulldoze refunds. 0 = a calendar with no tax, i.e. just a clock.
  taxPerTrackPiecePerYear: number;
}

export const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface CalendarDate {
  year: number;
  month: number; // 0-11, index into MONTH_NAMES
  label: string; // "Feb 1832"
}

// Where the calendar stands after `sec` seconds of scored play. The level opens
// on 1 January of `startYear`, so a year boundary is always a whole multiple of
// `secPerYear` — which is what lets the levy schedule below be a plain floor.
export function calendarAt(spec: CalendarSetup, sec: number): CalendarDate {
  if (!(spec.secPerYear > 0)) {
    return { year: spec.startYear, month: 0, label: `Jan ${spec.startYear}` };
  }
  const years = Math.max(0, sec) / spec.secPerYear;
  const year = spec.startYear + Math.floor(years);
  // Clamped, because a fractional year of exactly 1 (floating point) would
  // otherwise index a 13th month.
  const month = Math.min(11, Math.floor((years % 1) * 12));
  return { year, month, label: `${MONTH_NAMES[month]} ${year}` };
}

// How many annual levies have fallen due by `sec`. The first is charged at the
// END of the first year (the level opens tax-free), so a run shorter than one
// in-game year pays nothing — an important property for the small scenarios,
// where a levy in the first seconds would read as the game taking money for no
// reason.
export function leviesDue(spec: CalendarSetup, sec: number): number {
  if (!(spec.secPerYear > 0)) return 0;
  return Math.max(0, Math.floor(sec / spec.secPerYear));
}

// Which year a levy is FOR. Levy 1 closes the books on `startYear`.
export function levyYear(spec: CalendarSetup, levy: number): number {
  return spec.startYear + Math.max(0, levy - 1);
}

// What one year's upkeep costs on a network of `pieces` player-laid tiles.
export function taxFor(spec: CalendarSetup, pieces: number): number {
  return Math.max(0, Math.round(spec.taxPerTrackPiecePerYear * Math.max(0, pieces)));
}
