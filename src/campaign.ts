// The campaign: an ordered list of levels, an unlock rule, and a star total.
//
// Headless and pure — no Vue, no DOM beyond the localStorage the objective store
// already owns — so the whole progression is unit-testable.
//
// The design decision worth knowing: THERE IS NO NEW PERSISTED KEY. Progress is
// derived from `objectiveStore`, which is written exactly once, by PlayView's
// phase watcher, when a board is won, under the key `board:<scenarioId>`. So
// "have I cleared this level?" is `loadBest(...) !== null` over data the game has
// been recording all along. A second store would be a second source of truth to
// keep in step with the first.
//
// A level IS a /test scenario id. The board plumbing already handles the rest:
// `/#/play?mode=<modeId>&board=<id>` resolves the scenario, and the per-board
// Tycoon tuning is keyed off the same id, so /play and /test get identical games.

import { BestResult, loadBest } from "@/objectiveStore";

export interface CampaignLevel {
  // A /test scenario id. `SCENARIOS` must contain it — pinned by a unit test,
  // because both lookups fail SILENTLY on a typo (the registry returns its first
  // entry, and PlayView falls through to the default board), which would produce
  // a wrong-but-working level and no error anywhere.
  id: string;
  name: string;
  blurb: string;
  // The mode to open the board in. NOT optional, and not read off the scenario:
  // PlayView resolves the mode from `?mode=` or the last-used mode and ignores
  // `scenario.modeId` — only the /test stage honours that field.
  modeId: string;
  // How many stars the board offers, for the campaign total.
  stars: number;
}

// ---------------------------------------------------------------------------
// The levels.
//
// PLACEHOLDERS, and chosen by measurement rather than by taste. The eight
// designed levels live in
// `docs/superpowers/specs/2026-07-27-campaign-and-levels-design.md` Part B;
// swapping them in is a one-array edit.
//
// Every entry here is a board with a PASSING END-TO-END TEST THAT REACHES A WIN.
// That bar exists because the unlock rule below is a chain: a level that cannot
// be won is not a hard level, it is a wall across the whole campaign.
//
// Two obvious-looking candidates were probed and rejected on 2026-07-27:
// `dispatch` and `faredistance` each deliver ONE of their two trains and then
// run forever (measured: `mismatchedArrivals` climbing, the second train
// bouncing off a deliberately mismatched depot). They are shuttle demos of a
// mechanic, not levels — the same trick `/test/rollingstock` uses to keep its
// trains on screen. Do not seed a campaign from a board without checking it.
export const CAMPAIGN: CampaignLevel[] = [
  {
    id: "objectives",
    name: "First Delivery",
    blurb: "Get the trains home. Nothing to build, nothing to pay for.",
    modeId: "puzzle",
    stars: 3,
  },
  {
    id: "buildgap",
    name: "Mind the Gap",
    blurb: "The line is two tiles short and there is a pond in the way.",
    modeId: "tycoon",
    stars: 3,
  },
  {
    id: "lakevalley-open",
    name: "Lake Valley",
    blurb: "Buy back the south side of the ring, then run all three stations.",
    modeId: "tycoon",
    stars: 3,
  },
  {
    // The first level authored as a TIMETABLE rather than as a pile of trains
    // present at t=0 — twelve arrivals over two minutes through one shed. See
    // docs/superpowers/specs/2026-08-22-level-pacing-design.md for why every
    // level before it is over in well under a minute.
    id: "thefork",
    name: "The Fork",
    blurb: "Trains keep coming, for one town or the other. The junction decides.",
    modeId: "tycoon",
    stars: 3,
  },
];

// The objective store's key for a level — the same string PlayView records a win
// under (`board:<scenarioId>`).
export function campaignKeyOf(level: CampaignLevel): string {
  return `board:${level.id}`;
}

// Where a levelId sits in the campaign, or -1 if it is not a campaign level.
// Accepts the full levelId (`board:x` from /play, `test:x` from the stage) as
// well as a bare scenario id, so callers never have to strip it themselves.
export function campaignIndexOf(levelId: string): number {
  const i = levelId.indexOf(":");
  const board = i < 0 ? levelId : levelId.slice(i + 1);
  return CAMPAIGN.findIndex(l => l.id === board);
}

// The level after this one, or null at the end of the campaign (or off it).
// Pure over the module constant — no storage read — so a view may expose it as
// a computed without going stale.
export function nextLevelAfter(levelId: string): CampaignLevel | null {
  const i = campaignIndexOf(levelId);
  if (i < 0) return null;
  return CAMPAIGN[i + 1] ?? null;
}

export function bestFor(level: CampaignLevel): BestResult | null {
  return loadBest(campaignKeyOf(level));
}

// Cleared = won at least once. A NULL CHECK, never `stars > 0`: a scraped
// zero-star win is still a win, and gating the next level on a star would make
// the campaign unfinishable for a player who beat a board the hard way.
export function isCleared(level: CampaignLevel): boolean {
  return bestFor(level) !== null;
}

// The first level is always open; every other one waits on the level before it.
export function isUnlocked(index: number): boolean {
  if (index <= 0) return true;
  const prev = CAMPAIGN[index - 1];
  return prev !== undefined && isCleared(prev);
}

export function starsFor(level: CampaignLevel): number {
  return bestFor(level)?.stars ?? 0;
}

// Stars earned across the campaign, and the most it could offer.
export function campaignTotals(): { earned: number; total: number } {
  return {
    earned: CAMPAIGN.reduce((sum, l) => sum + starsFor(l), 0),
    total: CAMPAIGN.reduce((sum, l) => sum + l.stars, 0),
  };
}

// One row per level, ready for the level-select screen. Reads storage once.
export interface CampaignRow {
  level: CampaignLevel;
  index: number;
  unlocked: boolean;
  cleared: boolean;
  stars: number;
}

export function campaignRows(): CampaignRow[] {
  return CAMPAIGN.map((level, index) => ({
    level,
    index,
    unlocked: isUnlocked(index),
    cleared: isCleared(level),
    stars: starsFor(level),
  }));
}
