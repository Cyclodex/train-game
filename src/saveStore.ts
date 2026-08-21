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
// Set on the first failed setItem. From then on this session reads its own
// copy: with getItem still answering the OLD value, preferring localStorage
// would list a player's just-made save once (from memory, via the write) and
// then never again — success reported, save gone on tab close.
let storageBroken = false;

// Guard a parsed value: `"null"`, a number or a string all pass JSON.parse and
// would brick every caller downstream (Object.entries(null) throws), so a
// corrupt key degrades to "no saves" instead of a save UI that cannot open.
function asSlotMap(parsed: unknown): SlotMap | null {
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as SlotMap)
    : null;
}

function read(): SlotMap {
  if (storageBroken) return memory ?? {};
  try {
    const raw = localStorage.getItem(KEY);
    // No stored key: the in-memory copy still answers (a session whose
    // setItem fails — quota, private mode — keeps its own saves).
    if (!raw) return memory ?? {};
    return asSlotMap(JSON.parse(raw)) ?? memory ?? {};
  } catch {
    return memory ?? {};
  }
}

function write(slots: SlotMap): void {
  memory = slots;
  try {
    localStorage.setItem(KEY, JSON.stringify(slots));
    storageBroken = false;
  } catch {
    // Quota / private mode: the in-memory copy serves this session, and
    // `read` prefers it from now on so the save stays visible.
    storageBroken = true;
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
// by saving onto a listed slot, not by a name collision). The AUTOSAVE_ID is
// permanently reserved: a manual save named "Autosave" must not land on the
// slot the leave-autosave overwrites unasked.
export function slotIdFor(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "save";
  const slots = read();
  if (base !== AUTOSAVE_ID && !(base in slots)) return base;
  let n = 2;
  while (`${base}-${n}` in slots) n += 1;
  return `${base}-${n}`;
}

// A save STAGED for the navigation that is about to happen — the load path's
// in-memory hand-off (the same pattern levelStore uses). Read-and-clear.
//
// Why it exists at all: `?save=<id>` alone is not enough, because the OLD
// PlayView unmounts before the new one initializes, and its leave-autosave
// writes into the store first — loading the "autosave" slot would then read
// the state the player just left instead of the one they clicked on.
let stagedLoad: GameSave | null = null;

export function stageLoad(save: GameSave): void {
  stagedLoad = save;
}

export function takeStagedLoad(): GameSave | null {
  const staged = stagedLoad;
  stagedLoad = null;
  return staged;
}
