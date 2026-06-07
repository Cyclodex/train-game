import { Level } from "@/tiles/model";
import { migrateLevel } from "@/levelStore";

// A one-shot hand-off used to open the editor pre-loaded with an existing map —
// e.g. the "Edit" button on a /test scenario, so a map that needs manual
// correction can be fixed with the real editor tools and re-exported. The test
// stage writes here; EditorView reads it once on mount (and clears it), so a
// normal visit to /editor still restores the user's own in-progress level.
let pending: Level | null = null;

const KEY = "train-game:editor-seed";

export function setEditorSeed(level: Level): void {
  // Deep-clone so later edits in the editor never mutate the scenario's object.
  pending = JSON.parse(JSON.stringify(level)) as Level;
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // localStorage may be unavailable — keep the in-memory copy for this session.
  }
}

// Return the seeded level (migrating legacy road format) and consume it, so it
// only applies to the next editor mount.
export function takeEditorSeed(): Level | null {
  let seed = pending;
  pending = null;
  if (!seed) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) seed = JSON.parse(raw) as Level;
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return seed ? migrateLevel(seed) : null;
}
