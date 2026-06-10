// Per-level best result (most stars, then fastest time) persisted to
// localStorage. Pure helpers; safe when localStorage is unavailable (SSR/tests).

export interface BestResult {
  stars: number;
  timeSec: number;
}

const KEY_PREFIX = "train-game:best:";

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadBest(levelId: string): BestResult | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(KEY_PREFIX + levelId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BestResult;
    if (typeof parsed.stars === "number" && typeof parsed.timeSec === "number")
      return parsed;
    return null;
  } catch {
    return null;
  }
}

// Records a result if it beats the stored best (more stars, or same stars but
// faster). Returns the (possibly updated) best.
export function recordResult(levelId: string, result: BestResult): BestResult {
  const prev = loadBest(levelId);
  const better =
    !prev ||
    result.stars > prev.stars ||
    (result.stars === prev.stars && result.timeSec < prev.timeSec);
  const best = better ? result : prev!;
  const s = storage();
  if (s && better) s.setItem(KEY_PREFIX + levelId, JSON.stringify(best));
  return best;
}
