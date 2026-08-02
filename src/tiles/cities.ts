import type { Level, TileCell } from "@/tiles/model";
import { parseCoordId } from "@/tiles/model";
import { WALK_RADIUS_TILES } from "@/tiles/catchment";
import { rowsOf } from "@/tiles/parking";
import { makeRng } from "@/utils/globalHelpers";

// Cities and plots: what the MAP says about where people live and work.
//
// Pure map-reading, no state — the same side of the line as `catchment.ts`.
// The citizen simulation (`src/sim/citizens.ts`) is terrain-blind by canon, so
// everything it needs to know about the ground is derived HERE and handed over
// as a `CitizenWorld`. Nothing in this file remembers anything between calls.
//
// The split that makes growth possible without breaking "derived, never stored":
//
//   the MAP says WHERE a city may stand   (terrain urban/industry — level data)
//   the SIM says HOW MANY people it holds (density + residents — live state)
//
// So a city fills its plots, then grows taller buildings on them, and only when
// it has run out of both does it ask the player for more ground. There is no
// auto-sprawl onto grass: painting the next neighbourhood is a decision.
//
// Design: docs/superpowers/specs/2026-08-01-citizens-and-cities-design.md

// What a plot is FOR. Derived from terrain plus a seeded pick for the shops —
// deliberately no new tile field, so every existing board (townscape, demoworld,
// any generated level) has cities the moment this module is asked.
export type PlotKind = "home" | "work" | "shop";

// How built-up a plot is: 0 hamlet, 1 houses, 2 terraces, 3 blocks. The map
// seeds it; the citizen sim owns it from then on.
export type Density = 0 | 1 | 2 | 3;

export const MAX_DENSITY: Density = 3;

// Capacity by kind and density. Doubling per step so an upgrade is felt, and
// scaled so a three-city board opens at a few hundred citizens — enough for the
// aggregates to mean something, few enough to tick for free.
// A works employs a town; a parade of shops employs a handful. That gap is not
// flavour — it is what decides whether anybody has to travel. With shops as big
// as factories, every resident found work on their own street and 99% of all
// journeys on the reference board were made on foot, railway or no railway.
const CAPACITY: Record<PlotKind, [number, number, number, number]> = {
  home: [4, 8, 16, 32],
  work: [12, 24, 48, 96],
  shop: [2, 4, 8, 16],
};

export function plotCapacity(kind: PlotKind, density: Density): number {
  return CAPACITY[kind][density];
}

// How far a plot may be from a road and still count as reachable by car. One
// tile: your street is the one you can see from the door.
export const ROAD_ACCESS_TILES = 1;

// What share of a city's urban plots become shops. Shops cluster at the centre
// (see `plotsOf`), so this is the fraction taken from the middle outward. Kept
// low for the same reason their capacity is: a town whose own centre employs
// everyone has no reason to be connected to anywhere.
const SHOP_SHARE = 0.12;

export interface PlotSpec {
  id: string; // tile coord id, "x,y"
  x: number;
  y: number;
  city: string;
  kind: PlotKind;
  // The density the MAP opens at. The sim copies this once and then owns it.
  density: Density;
}

export interface CitySpec {
  id: string;
  name: string;
  plots: string[]; // plot ids, sorted
  centre: { x: number; y: number };
}

// Everything the citizen sim is allowed to know about the ground. Note what is
// NOT here: no TileCell, no terrain, no ports. Access is a fact, not a query.
export interface WorldPlot extends PlotSpec {
  // Reachable by car at all (a road within ROAD_ACCESS_TILES).
  hasRoad: boolean;
  // WHICH road network. Two plots are drivable between only when this matches:
  // a street in one town and a street in another are not a road link, and the
  // whole Transport-Fever fantasy depends on saying so. `null` = no road.
  roadComponent: number | null;
  // The road tile this plot's driveway joins — where a resident's car actually
  // appears when they set off, and where a visitor's pulls up. `null` = no road
  // in reach, which is the same thing as `hasRoad: false`.
  roadTile: string | null;
  // Station tiles within walking reach of this plot.
  stationsInReach: string[];
}

// A station a driver can leave the car at and continue by rail, with the road
// network that reaches it — a P+R you cannot drive to is not a P+R.
export interface ParkAndRideStation {
  station: string;
  roadComponent: number | null;
  // The road tile a driver actually drives TO in order to leave the car here.
  roadTile: string | null;
}

export interface CitizenWorld {
  plots: WorldPlot[];
  cities: CitySpec[];
  parkAndRideStations: ParkAndRideStation[];
}

// --- what counts as a plot -----------------------------------------------------

// Infrastructure is not an address. A tile carrying rail, road or parking is
// the street, not the houses on it — people live on the ground beside it. This
// is also what keeps a station's own tile out of its catchment as a home.
function isBuildableGround(cell: TileCell): boolean {
  if (cell.connections.length > 0) return false;
  if (cell.road && cell.road.length > 0) return false;
  if (rowsOf(cell).length > 0) return false;
  return true;
}

function isPlotGround(cell: TileCell): boolean {
  return (
    (cell.terrain === "urban" || cell.terrain === "industry") &&
    isBuildableGround(cell)
  );
}

// --- clustering ----------------------------------------------------------------

// A city is a connected cluster of plot ground (8-neighbour flood fill), unless
// the level tags cells with an explicit `city`. Clustering is what makes this
// work on boards written long before cities existed; the tag is the escape
// hatch for two towns that touch (see the design doc's traps).
function clusterKey(level: Level, id: string): string | null {
  const cell = level[id];
  if (!cell || !isPlotGround(cell)) return null;
  return cell.city ?? null;
}

const NAMES = [
  "Westfield",
  "Ostbach",
  "Lakeport",
  "Marburg",
  "Northgate",
  "Sunnyvale",
  "Steinbach",
  "Riverton",
  "Eichdorf",
  "Southport",
];

export function cityNameFor(index: number): string {
  return NAMES[index % NAMES.length] ?? `City ${index + 1}`;
}

/**
 * Every city on the board, as connected regions of plot ground. Sorted by
 * top-left tile so ids and names are stable for a given map — a board must
 * name its towns the same way on every reload and in every replay.
 */
export function citiesOf(level: Level): CitySpec[] {
  const ground = Object.keys(level)
    .filter(id => isPlotGround(level[id]))
    .sort(comparePlotId);

  const seen = new Set<string>();
  // Tagged cells go straight into their named group; untagged ones flood fill.
  const groups = new Map<string, string[]>();

  for (const id of ground) {
    if (seen.has(id)) continue;
    const tag = clusterKey(level, id);
    if (tag) {
      seen.add(id);
      const list = groups.get(`tag:${tag}`) ?? [];
      list.push(id);
      groups.set(`tag:${tag}`, list);
      continue;
    }
    // Flood fill from here over untagged plot ground.
    const members: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop() as string;
      members.push(cur);
      const { x, y } = parseCoordId(cur);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nid = `${x + dx},${y + dy}`;
          if (seen.has(nid)) continue;
          const cell = level[nid];
          if (!cell || !isPlotGround(cell)) continue;
          if (clusterKey(level, nid)) continue; // tagged cells are their own city
          seen.add(nid);
          stack.push(nid);
        }
      }
    }
    groups.set(`fill:${members.slice().sort(comparePlotId)[0]}`, members);
  }

  return [...groups.entries()]
    .map(([key, plots]) => ({ key, plots: plots.slice().sort(comparePlotId) }))
    .sort((a, b) => comparePlotId(a.plots[0], b.plots[0]))
    .map(({ key, plots }, i) => {
      const tag = key.startsWith("tag:") ? key.slice(4) : null;
      let sx = 0;
      let sy = 0;
      for (const id of plots) {
        const { x, y } = parseCoordId(id);
        sx += x;
        sy += y;
      }
      return {
        id: tag ?? `city${i + 1}`,
        name: tag ? titleCase(tag) : cityNameFor(i),
        plots,
        centre: { x: sx / plots.length, y: sy / plots.length },
      };
    });
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Sort by y then x — reading order, so "the first tile" means the top-left one.
function comparePlotId(a: string, b: string): number {
  const pa = parseCoordId(a);
  const pb = parseCoordId(b);
  return pa.y - pb.y || pa.x - pb.x;
}

// --- plots ---------------------------------------------------------------------

/**
 * Every plot on the board with its kind and opening density.
 *
 * `industry` ground is always work. `urban` ground is homes, except a
 * deterministic minority nearest the city centre which become shops — towns put
 * their shops in the middle, and it gives the centre a reason to be reached.
 * The pick is a seeded hash of the coordinate, so it is identical on every
 * reload and in every replay.
 */
export function plotsOf(level: Level, seed = 1): PlotSpec[] {
  const cities = citiesOf(level);
  const out: PlotSpec[] = [];

  for (const city of cities) {
    // Urban plots ranked by how central they are; the closest SHOP_SHARE of
    // them are the parade of shops. Ties broken by id, so it is stable.
    const urban = city.plots.filter(id => level[id].terrain === "urban");
    const ranked = urban
      .map(id => {
        const { x, y } = parseCoordId(id);
        return {
          id,
          d: Math.hypot(x - city.centre.x, y - city.centre.y),
        };
      })
      .sort((a, b) => a.d - b.d || comparePlotId(a.id, b.id));
    const shopCount = urban.length >= 4 ? Math.max(1, Math.round(urban.length * SHOP_SHARE)) : 0;
    const shops = new Set(ranked.slice(0, shopCount).map(r => r.id));

    for (const id of city.plots) {
      const { x, y } = parseCoordId(id);
      const industry = level[id].terrain === "industry";
      const kind: PlotKind = industry ? "work" : shops.has(id) ? "shop" : "home";
      // Opening density: a seeded spread so a town is not uniform, biased up
      // toward the centre (the middle of a town is always the built-up part).
      const rng = makeRng((seed ^ (x * 73856093) ^ (y * 19349663)) >>> 0);
      const central = 1 - Math.min(1, Math.hypot(x - city.centre.x, y - city.centre.y) / 4);
      const roll = rng() * 0.7 + central * 0.6;
      const density: Density = roll > 1.0 ? 2 : roll > 0.55 ? 1 : 0;
      out.push({ id, x, y, city: city.id, kind, density });
    }
  }
  return out.sort((a, b) => comparePlotId(a.id, b.id));
}

// --- access --------------------------------------------------------------------

function hasNeighbourWithin(
  level: Level,
  x: number,
  y: number,
  radius: number,
  pred: (cell: TileCell) => boolean
): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cell = level[`${x + dx},${y + dy}`];
      if (cell && pred(cell)) return true;
    }
  }
  return false;
}

/** Station tiles within walking reach of (x,y) — the same radius as catchment. */
export function stationsInReachOf(level: Level, x: number, y: number): string[] {
  const out: string[] = [];
  for (let dy = -WALK_RADIUS_TILES; dy <= WALK_RADIUS_TILES; dy++) {
    for (let dx = -WALK_RADIUS_TILES; dx <= WALK_RADIUS_TILES; dx++) {
      const id = `${x + dx},${y + dy}`;
      if (level[id]?.role === "station") out.push(id);
    }
  }
  return out.sort();
}

function hasRoadTile(cell: TileCell | undefined): boolean {
  return !!cell?.road && cell.road.length > 0;
}

/**
 * The connected road networks on this board: tile id → component number.
 *
 * This is the lever the whole mode turns on. "Both ends have a street" does not
 * make a car trip possible — two towns each with their own streets and no road
 * between them cannot be driven between, and on a board like that the railway
 * is the ONLY way to commute. Adjacency (4-neighbour over road-bearing tiles)
 * rather than port-exact traversal: it is the honest question at this scale and
 * it never disagrees with the eye.
 */
export function roadComponents(level: Level): Record<string, number> {
  const out: Record<string, number> = {};
  const ids = Object.keys(level).filter(id => hasRoadTile(level[id])).sort(comparePlotId);
  let next = 0;
  for (const start of ids) {
    if (start in out) continue;
    const component = next++;
    const stack = [start];
    out[start] = component;
    while (stack.length) {
      const cur = stack.pop() as string;
      const { x, y } = parseCoordId(cur);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nid = `${x + dx},${y + dy}`;
        if (nid in out) continue;
        if (!hasRoadTile(level[nid])) continue;
        out[nid] = component;
        stack.push(nid);
      }
    }
  }
  return out;
}

// The nearest road tile to (x,y) within `radius`, and the network it belongs
// to. Nearest by Chebyshev ring then by id, so a plot's driveway joins the same
// street on every run. `{ tile: null }` when there is no road in reach.
function roadNear(
  level: Level,
  components: Record<string, number>,
  x: number,
  y: number,
  radius: number
): { tile: string | null; component: number | null } {
  let bestTile: string | null = null;
  let bestComponent: number | null = null;
  let bestDist = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const id = `${x + dx},${y + dy}`;
      const c = components[id];
      if (c === undefined) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (dist < bestDist || (dist === bestDist && bestTile !== null && id < bestTile)) {
        bestTile = id;
        bestComponent = c;
        bestDist = dist;
      }
    }
  }
  return { tile: bestTile, component: bestComponent };
}

/**
 * Stations a driver can leave the car at and continue by rail: a station with
 * parking within its own walking reach. The same rule `game.ts` already uses to
 * decide that a parked car's occupant joins a platform queue — stated once here
 * so the citizen who *plans* a park-and-ride and the transfer that *happens*
 * agree about which stations qualify.
 */
export function parkAndRideStationsOf(level: Level): ParkAndRideStation[] {
  const components = roadComponents(level);
  const out: ParkAndRideStation[] = [];
  for (const [id, cell] of Object.entries(level)) {
    if (cell.role !== "station") continue;
    const { x, y } = parseCoordId(id);
    if (hasNeighbourWithin(level, x, y, WALK_RADIUS_TILES, c => rowsOf(c).length > 0)) {
      const near = roadNear(level, components, x, y, WALK_RADIUS_TILES);
      out.push({ station: id, roadComponent: near.component, roadTile: near.tile });
    }
  }
  return out.sort((a, b) => (a.station < b.station ? -1 : 1));
}

/**
 * The whole input to the citizen simulation, derived from the level in one
 * pass. This is the ONLY thing that crosses the terrain-blindness line.
 */
export function buildCitizenWorld(level: Level, seed = 1): CitizenWorld {
  const cities = citiesOf(level);
  const components = roadComponents(level);
  const plots = plotsOf(level, seed).map<WorldPlot>(p => {
    const near = roadNear(level, components, p.x, p.y, ROAD_ACCESS_TILES);
    return {
      ...p,
      hasRoad: near.component !== null,
      roadComponent: near.component,
      roadTile: near.tile,
      stationsInReach: stationsInReachOf(level, p.x, p.y),
    };
  });
  return { plots, cities, parkAndRideStations: parkAndRideStationsOf(level) };
}
