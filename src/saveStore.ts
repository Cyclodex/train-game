import { GameSave, SAVE_VERSION } from "@/game";

// Named save slots (Spielstand) in localStorage, with the same in-memory
// fallback `levelStore.ts` uses so a private-mode session still works for its
// own lifetime. One key holds every slot: a handful of saves on boards this
// size is well under the localStorage budget, and one key keeps writes atomic.
//
// Versioning: a slot whose `version` differs from the current SAVE_VERSION is
// listed (so the player can see and delete it) but refuses to load — there is
// no migration in v1, and restoring a mismatched shape would corrupt a run
// silently, which is worse than a slot that says it is too old.
// Design: docs/superpowers/specs/2026-08-21-save-load-design.md.

const KEY = "train-game:saves";

// The slot the leave-autosave writes into (PlayView's beforeUnmount).
export const AUTOSAVE_ID = "autosave";

export interface SaveMeta {
  id: string;
  name: string;
  savedAt: number;
  modeId: string;
  levelId: string;
  // False for a slot written by a different SAVE_VERSION — visible, deletable,
  // not loadable.
  compatible: boolean;
}

type SlotMap = Record<string, GameSave>;

// In-memory copy of the store, so a session without storage (private mode /
// SSR) still saves and loads within itself. localStorage is the SOURCE when it
// works — a cache-first read served a stale slot to any second tab (and to
// anything else writing the key), and stale state restored silently is the
// worst failure a save system can have.
let memory: SlotMap | null = null;

function read(): SlotMap {
  try {
    const raw = localStorage.getItem(KEY);
    // No stored key: the in-memory copy still answers (a session whose
    // setItem fails — quota, private mode — keeps its own saves).
    return raw ? (JSON.parse(raw) as SlotMap) : (memory ?? {});
  } catch {
    return memory ?? {};
  }
}

function write(slots: SlotMap): void {
  memory = slots;
  try {
    localStorage.setItem(KEY, JSON.stringify(slots));
  } catch {
    // Quota / private mode: the in-memory copy still serves this session.
  }
}

export function listSaves(): SaveMeta[] {
  const slots = read();
  return Object.entries(slots)
    .map(([id, save]) => ({
      id,
      name: save.name,
      savedAt: save.savedAt,
      modeId: save.modeId,
      levelId: save.levelId,
      compatible: save.version === SAVE_VERSION,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

// The slot's save, or null when it is absent or from a different version.
export function getSave(id: string): GameSave | null {
  const save = read()[id];
  if (!save || save.version !== SAVE_VERSION) return null;
  return save;
}

export function putSave(id: string, save: GameSave): void {
  write({ ...read(), [id]: save });
}

export function deleteSave(id: string): void {
  const slots = { ...read() };
  delete slots[id];
  write(slots);
}

// A url-safe slot id from a player-typed name, unique against the existing
// slots (a numeric suffix rather than an overwrite — overwriting is expressed
// by saving onto a listed slot, not by a name collision).
export function slotIdFor(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "save";
  const slots = read();
  if (!(base in slots)) return base;
  let n = 2;
  while (`${base}-${n}` in slots) n += 1;
  return `${base}-${n}`;
}
