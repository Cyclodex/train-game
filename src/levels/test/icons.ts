import { locate } from "@/levels/test";

// Big glyphs that give each gallery tile an instant identity, on top of the
// (samey, grey-on-green) level previews. Emoji are used deliberately: zero
// assets, universally recognisable, trivial to extend. Kept here rather than on
// the scenario objects so the scenario `.ts` files stay untouched.
//
// Resolution order for a scenario tile: its own entry → its category's icon →
// a generic fallback. Domain and category tiles use their own maps directly.

export const DOMAIN_ICONS: Record<string, string> = {
  trains: "🚂",
  streets: "🚗",
  challenges: "🏁",
};

// Keyed by `${domainId}/${categoryId}` because category ids repeat across
// domains (e.g. "basics" under both Trains and Streets).
export const CATEGORY_ICONS: Record<string, string> = {
  "trains/basics": "🚆",
  "trains/signals": "🚦",
  "trains/junctions": "🔀",
  "trains/grades": "⛰️",
  "trains/stations": "🚉",
  "trains/crossings": "🚧",
  "streets/basics": "🚗",
  "streets/curves": "🛞",
  "streets/lanes": "🛣️",
  "streets/crosses": "✖️",
  "streets/turning": "↩️",
  "streets/signals": "🚥",
  "streets/overtaking": "🏎️",
  "streets/priority": "⚠️",
  "streets/vehicles": "🚌",
  "streets/cycling": "🚲",
  "streets/routing": "📍",
  "streets/parking": "🅿️",
  "challenges/modes": "🎯",
  "challenges/worlds": "🌍",
};

// Per-scenario overrides, where a distinct glyph reads better than the category
// default. Anything not listed falls back to its category icon.
export const SCENARIO_ICONS: Record<string, string> = {
  // Trains
  straight: "🚆",
  curve: "🛤️",
  depot: "🏠",
  signals: "🚦",
  switchDefault: "🎚️",
  junction: "🔀",
  cross: "✖️",
  flyover: "🌉",
  grades: "⛰️",
  mountainpass: "🚞",
  tunnel: "🚇",
  crossing: "🚧",
  keepcrossingclear: "🚧",
  crossingkeeper: "💂",
  // Trains — stations
  station: "🚉",
  platformstop: "🛑",
  stationhouse: "🏛️",
  boarding: "🧍",
  transfer: "🔁",
  busrail: "🚌",
  catchment: "🏘️",
  parkandride: "🅿️",
  busfeeder: "🚏",
  // Streets — vehicles
  trucks: "🚛",
  buslane: "🚌",
  buses: "🚌",
  buscross: "🚌",
  // Streets — turning / priority / overtaking
  turnlanes: "↩️",
  rightturncross: "➡️",
  noleftturn: "🚫",
  overtaketwolane: "🏎️",
  overtakeloop: "🏎️",
  roadpriority: "⚠️",
  // Streets — traffic signals
  signaltwophase: "🚥",
  signalroundrobin: "🔃",
  signalbuslane1l: "🚌",
  signalbuspriority: "🚌",
  signalbuslane3l: "🚌",
  // Streets — routing
  cardestination: "📍",
  carroute: "🗺️",
  // Streets — parking
  bikeforecourt: "🚲",
  // Streets — curves
  carcircle: "🔄",
  carscurve: "🛤️",
  roadcurveloops: "🔁",
  // Challenges
  backdroptrees: "🌳",
  objectives: "🎯",
  timeattack: "⏱️",
  buildgap: "🏗️",
  daily: "📅",
  networkmode: "🚉",
};

export function iconForDomain(domainId: string): string {
  return DOMAIN_ICONS[domainId] ?? "🧩";
}

export function iconForCategory(domainId: string, categoryId: string): string {
  return CATEGORY_ICONS[`${domainId}/${categoryId}`] ?? "🧩";
}

export function iconForScenario(scenarioId: string): string {
  if (SCENARIO_ICONS[scenarioId]) return SCENARIO_ICONS[scenarioId];
  const loc = locate(scenarioId);
  if (loc) return iconForCategory(loc.domain.id, loc.category.id);
  return "🧩";
}
