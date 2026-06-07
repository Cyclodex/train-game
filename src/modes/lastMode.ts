// Remembers the game mode the player last opened, so returning to /play (without
// an explicit ?mode=) reopens that mode instead of always defaulting. Pure
// localStorage helpers; safe when storage is unavailable (SSR/tests).

const KEY = "train-game:last-mode";

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadLastModeId(): string | null {
  return storage()?.getItem(KEY) ?? null;
}

export function saveLastModeId(id: string): void {
  storage()?.setItem(KEY, id);
}
