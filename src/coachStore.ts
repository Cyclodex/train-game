// Which coach-marks this PLAYER has already been shown, persisted to
// localStorage — the memory the Transport-Fever model needs: a first-encounter
// hint (tier "player", see src/coach.ts) is taught once ever, not once per
// session. In the mould of objectiveStore: pure helpers, safe when
// localStorage is unavailable (SSR/tests), one key holding a JSON array.
//
// Deliberately NOT used for the campaign's lesson marks — a lesson belongs to
// its level and re-teaches on a fresh session (design decision recorded in
// docs/superpowers/specs/2026-08-22-teaching-depth-design.md §4 step 3).

const KEY = "train-game:coach-seen";

// What createCoach actually needs — an interface, so tests inject a plain Set
// and never touch real storage.
export interface CoachSeen {
  has(id: string): boolean;
  add(id: string): void;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSeen(): Set<string> {
  const s = storage();
  if (!s) return new Set();
  try {
    const raw = s.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : []
    );
  } catch {
    return new Set();
  }
}

export function recordSeen(id: string): void {
  const s = storage();
  if (!s) return;
  const seen = loadSeen();
  seen.add(id);
  s.setItem(KEY, JSON.stringify([...seen]));
}

// The "Reset hints" escape hatch (a streamer, a second household player).
export function resetSeen(): void {
  storage()?.removeItem(KEY);
}

// The store the game hands to createCoach: reads once (localStorage per tick
// would be absurd), writes through on completion.
export function coachSeenStore(): CoachSeen {
  const seen = loadSeen();
  return {
    has: id => seen.has(id),
    add: id => {
      if (seen.has(id)) return;
      seen.add(id);
      recordSeen(id);
    },
  };
}
