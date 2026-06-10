// World-backdrop theme registry. Each theme is just a label/icon plus a
// matching `.theme-<id>` block in `src/scss/global/_themes.scss`. This is the
// single source of truth for the available themes and their order; the
// `WorldTheme` type is derived from it.
//
// Adding a theme: append an entry here and a `.theme-<id>` block in `_themes.scss`.
export const THEMES = [
  { id: "meadow", label: "Meadow", icon: "🌳" },
  { id: "table", label: "Wooden table", icon: "🪵" },
] as const;

export type WorldTheme = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: WorldTheme = "meadow";

// The next theme in registry order, wrapping around — drives the drawer's
// single 🎨 cycle button.
export function nextTheme(current: WorldTheme): WorldTheme {
  const i = THEMES.findIndex(t => t.id === current);
  return THEMES[(i + 1) % THEMES.length].id;
}

export function themeMeta(theme: WorldTheme) {
  return THEMES.find(t => t.id === theme) ?? THEMES[0];
}

export function isWorldTheme(value: unknown): value is WorldTheme {
  return typeof value === "string" && THEMES.some(t => t.id === value);
}
