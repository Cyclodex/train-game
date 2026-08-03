import { makeRng } from "@/utils/globalHelpers";
import { parseCoordId } from "@/tiles/model";
import {
  CitizenWorld,
  Density,
  MAX_DENSITY,
  ParkAndRideStation,
  PlotKind,
  WorldPlot,
  plotCapacity,
} from "@/tiles/cities";
import type { SimEvent } from "@/sim/simulation";

// The citizen simulation: people who live somewhere, work somewhere else, and
// judge you on the journey between the two.
//
// Headless, deterministic and TERRAIN-BLIND like every other module in
// `src/sim/` — it never sees a TileCell. Everything it knows about the ground
// arrives as a `CitizenWorld` built by `tiles/cities.ts`, and the only thing it
// pushes back into the rail world is passengers onto a platform.
//
// The loop, in one sentence: a citizen picks the least bad way to travel from
// what the map actually offers, times the trip, and lets the result move their
// mood — and moods decide who moves in and who moves out.
//
// Design: docs/superpowers/specs/2026-08-01-citizens-and-cities-design.md

export type TravelMode = "walk" | "car" | "transit" | "parkAndRide";
export const TRAVEL_MODES: TravelMode[] = ["walk", "car", "transit", "parkAndRide"];

// What a trip is FOR, and therefore which happiness topic it scores against.
export type TripPurpose = "work" | "home" | "shop";
export type Topic = "commute" | "errands" | "access";

// The legs a trip passes through. Timed legs (`walking`, `driving`) run down a
// clock; `waiting` and `riding` are driven by what the RAIL simulation actually
// does, which is what makes a bad timetable cost real time.
type Leg = "walking" | "driving" | "waiting" | "riding" | "egress";

export interface TravelProfile {
  carOwner: boolean;
  // How far this person walks HAPPILY, in tiles. Past it they still can walk —
  // it just starts to hurt (see `optionsFor`). Patience is a preference, not a
  // gate: gating availability on it made a three-tile errand IMPOSSIBLE for an
  // impatient person with no car, which is not a thing that happens to anyone.
  walkPatience: number;
  transitAffinity: number; // multiplier on PERCEIVED transit time (<1 = likes trains)
  carAffinity: number;
}

export interface Trip {
  purpose: TripPurpose;
  topic: Exclude<Topic, "access">;
  from: string;
  to: string;
  mode: TravelMode;
  startedAt: number;
  expectedSec: number;
  leg: Leg;
  legRemaining: number; // seconds left on a timed leg
  // Transit bookkeeping.
  station: string | null; // the platform they are on / rode from
  onPlatform: boolean; // actually accepted onto the sim's platform
  waitedSec: number;
  transfers: number;
  // The REAL CAR carrying this person, when the road sim dispatched one. While
  // this is set the driving leg is not on a clock at all: it ends when the car
  // arrives, so congestion, a queue at a junction and a closed level crossing
  // are all paid for in the citizen's own journey time.
  carTrip: string | null;
  // How long the car has been going. A car that never arrives (gridlock, a
  // route that stopped existing under a live edit) must not hold its passenger
  // for ever — see `advanceTrip`.
  carSec: number;
  // The person walking this leg on an actual pavement, when one connects the
  // two ends. Same contract as `carTrip`: while it is set the leg ends when the
  // WALKER arrives, not when a clock runs out.
  walkTrip: string | null;
}

export interface Citizen {
  id: string;
  home: string;
  work: string | null;
  profile: TravelProfile;
  mood: number;
  at: string; // the plot they are currently at (their home while travelling home)
  trip: Trip | null;
  // Day bookkeeping so each trip fires once a day, deterministically.
  outHour: number;
  backHour: number;
  shopHour: number;
  lastOutDay: number;
  lastBackDay: number;
  lastShopDay: number;
  // Consecutive days spent miserable — the emigration trigger.
  unhappyDays: number;
}

export interface PlotState {
  id: string;
  city: string;
  kind: PlotKind;
  density: Density;
  people: number; // residents (home) or filled jobs (work/shop)
  capacity: number;
}

export interface CityHappiness {
  commute: number;
  errands: number;
  access: number;
  overall: number;
}

export interface CityState {
  id: string;
  name: string;
  population: number;
  capacity: number;
  jobs: { filled: number; total: number };
  happiness: CityHappiness;
  modeShare: Record<TravelMode, number>;
  // Population at the last day review — the arrow the HUD draws.
  populationYesterday: number;
  // Full, at max density, and still happy: paint me more ground.
  wantsRoom: boolean;
}

export interface CitizenTuning {
  // How long an in-game day lasts, in sim seconds. THE genre dial: short makes a
  // twitchy throughput game, long a planning one.
  secPerDay: number;
  // Door-to-door speeds in tiles/sec, used to SCORE a mode before it is taken.
  walkSpeed: number;
  carSpeed: number;
  trainSpeed: number;
  // Roads do not run in straight lines. A car's distance is the crow-fly
  // distance times this — which is most of why driving loses to rail over
  // distance even though a car's top speed is higher.
  roadDetour: number;
  // The yardstick `expectedSec` is measured at. Not any mode's speed: it is what
  // a person thinks the trip "should" take, and it must not come from the
  // network or a bad network would grade itself.
  refSpeed: number;
  // The wait a rider assumes when comparing modes (they do not know the
  // timetable; they know roughly how often trains come).
  assumedHeadwaySec: number;
  // What parking costs a driver, in seconds of perceived time.
  parkPenaltySec: number;
  // Nobody walks further than this, whatever their patience. Past it, a trip
  // with no other mode available is REFUSED — which is the signal that the
  // network has failed someone completely, and the only thing `access` counts.
  walkMaxTiles: number;
  // How much each tile past `walkPatience` inflates the perceived walk.
  walkImpatience: number;
  // Give up after this long on a platform, or after being carried past this
  // many stations that are not the one you want.
  maxWaitSec: number;
  maxTransfers: number;
  // Share of adults who own a car.
  carOwnership: number;
  // Share of residents with no job (children, retired) — they only run errands.
  joblessShare: number;
}

// Calibrated against what the engine actually does, not against nothing:
// `DEFAULT_SPEED` (trains) is 0.5 tiles/sec and a car cruises at 0.6, so a
// train is NOT intrinsically faster here. Rail wins the way it wins in a real
// city — the car's route bends (roadDetour), it has to be parked
// (parkPenaltySec), and above all a road network that does not reach the other
// town cannot be driven down at all (`roadComponent`, tiles/cities.ts).
//
// The shape these numbers produce, which is the thing to preserve when tuning:
//   ≤3 tiles      walk
//   3-8 tiles     car, where a road actually connects the two ends
//   >8 tiles      rail, and rail is the ONLY option between unconnected towns
export const DEFAULT_TUNING: CitizenTuning = {
  secPerDay: 120,
  walkSpeed: 0.25,
  carSpeed: 0.6,
  trainSpeed: 0.45, // the sim's 0.5, minus what dwells cost on the way
  roadDetour: 1.35,
  // What a person thinks the trip "should" take. Deliberately slower than any
  // single mode: it is a door-to-door expectation including the getting-there,
  // so a working network comfortably beats it and a broken one does not.
  refSpeed: 0.22,
  assumedHeadwaySec: 12,
  parkPenaltySec: 8,
  walkMaxTiles: 6,
  walkImpatience: 0.5,
  maxWaitSec: 45,
  maxTransfers: 6,
  carOwnership: 0.55,
  joblessShare: 0.25,
};

// The rail world, as the citizen sim is allowed to touch it. Omitted → transit
// and park & ride are simply not available, which is exactly right for a
// headless test with no railway in it.
export interface TransitPort {
  // Put `n` people on this platform; returns how many were actually accepted
  // (the sim caps a platform). The citizen only counts as waiting once accepted.
  enqueue(stationId: string, n: number): number;
}

// The road world, same shape and same reason. Omitted → a driving citizen is an
// abstract timer (which is all they ever were before this existed, and still
// all they are on a board whose road sim is off).
// The pavement, same shape and same reason as the two above. Omitted, or with
// no footway route between the two ends, a walking citizen stays an abstract
// timer — which is all they ever were, so a board with no pavements is
// unaffected.
export interface WalkingPort {
  request(fromPlotId: string, toPlotId: string): string | null;
  status(tripId: string): "walking" | "arrived";
  release(tripId: string): void;
}

export interface DrivingPort {
  // Send a real car from one road tile to another. Returns a trip id, or null
  // when no car could be dispatched — no route, the street outside blocked, the
  // road full. A null is not a failed journey: the citizen simply drives
  // "off-screen" on a timer instead, so a saturated road never strands anyone.
  request(fromTileId: string, toTileId: string): string | null;
  // Is that car still going?
  status(tripId: string): "driving" | "arrived";
  // The caller has read the result and will not ask again.
  release(tripId: string): void;
}

export interface CitizenStats {
  population: number;
  citizens: number;
  travelling: number;
  // Citizens who are, right now, an actual car on the actual road. Distinct from
  // `travelling`, which includes walkers and rail passengers — and the only way
  // to see from OUTSIDE that a driving citizen became a vehicle rather than a
  // timer, since the renderer's car list does not exist in a headless run.
  driving: number;
  // ...and the same for people on an actual pavement.
  onFoot: number;
  tripsCompleted: number;
  tripsRefused: number;
  tripsAbandoned: number;
  modeShare: Record<TravelMode, number>;
  day: number;
  hour: number;
  clock: string; // "07:35"
}

export interface CitizenSimConfig {
  world: CitizenWorld;
  seed?: number;
  tuning?: Partial<CitizenTuning>;
  transit?: TransitPort;
  driving?: DrivingPort;
  walking?: WalkingPort;
}

export interface CitizenSim {
  step(dt: number, events?: SimEvent[]): void;
  cities(): CityState[];
  plots(): PlotState[];
  citizens(): Citizen[];
  stats(): CitizenStats;
  // Sim seconds elapsed, and the day/hour derived from it.
  now(): number;
  day(): number;
  hour(): number;
  // Passengers this sim believes are on the platform at `stationId` — its
  // shadow of the rail sim's queue (see the boarding mirror in `step`).
  waitingAt(stationId: string): number;
}

// An exponential moving average over trip outcomes: what "happiness about a
// topic" actually is. Starts neutral so an empty city is neither happy nor sad,
// and moves fast enough that a player sees a line opening pay off within a day.
const EMA_ALPHA = 0.06;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function createCitizenSim(config: CitizenSimConfig): CitizenSim {
  const tuning: CitizenTuning = { ...DEFAULT_TUNING, ...(config.tuning ?? {}) };
  const seed = config.seed ?? 1;
  const world = config.world;
  const transit = config.transit;
  const driving = config.driving;
  const walking = config.walking;

  // Separate RNG streams, as road.ts does: adding a citizen must not shift the
  // numbers another part of the model was going to draw.
  const placeRng = makeRng(seed);
  const profileRng = makeRng((seed ^ 0x9e3779b9) >>> 0);
  const habitRng = makeRng((seed ^ 0x517cc1b7) >>> 0);

  const plotById = new Map<string, WorldPlot>();
  for (const p of world.plots) plotById.set(p.id, p);

  const stationCoord = new Map<string, { x: number; y: number }>();
  for (const p of world.plots) {
    for (const s of p.stationsInReach) {
      if (!stationCoord.has(s)) stationCoord.set(s, parseCoordId(s));
    }
  }
  const parkAndRideByStation = new Map<string, ParkAndRideStation>();
  for (const s of world.parkAndRideStations) {
    if (!stationCoord.has(s.station)) stationCoord.set(s.station, parseCoordId(s.station));
    parkAndRideByStation.set(s.station, s);
  }

  // --- state -------------------------------------------------------------------

  const plots = new Map<string, PlotState>();
  for (const p of world.plots) {
    plots.set(p.id, {
      id: p.id,
      city: p.city,
      kind: p.kind,
      density: p.density,
      people: 0,
      capacity: plotCapacity(p.kind, p.density),
    });
  }

  interface CityRuntime extends CityState {
    ema: { commute: number; errands: number; access: number };
    modeCounts: Record<TravelMode, number>;
  }

  const cities = new Map<string, CityRuntime>();
  for (const c of world.cities) {
    cities.set(c.id, {
      id: c.id,
      name: c.name,
      population: 0,
      capacity: 0,
      jobs: { filled: 0, total: 0 },
      happiness: { commute: 0.5, errands: 0.5, access: 0.5, overall: 0.5 },
      modeShare: { walk: 0, car: 0, transit: 0, parkAndRide: 0 },
      populationYesterday: 0,
      wantsRoom: false,
      ema: { commute: 0.5, errands: 0.5, access: 0.5 },
      modeCounts: { walk: 0, car: 0, transit: 0, parkAndRide: 0 },
    });
  }

  const people = new Map<string, Citizen>();
  let nextId = 1;

  // Shadow queues: who is standing on each platform, in the order they arrived.
  // Popped by the rail sim's OWN boarding count — never by reading the queue
  // size, which the scheduled demand also moves (see the design doc's traps).
  const shadowQueue = new Map<string, string[]>();
  const riders = new Map<string, string[]>(); // train id → citizen ids aboard

  let clock = 0;
  let dayIndex = 0;
  let tripsCompleted = 0;
  let tripsRefused = 0;
  let tripsAbandoned = 0;
  const modeTotals: Record<TravelMode, number> = {
    walk: 0,
    car: 0,
    transit: 0,
    parkAndRide: 0,
  };

  // --- population --------------------------------------------------------------

  function jobPlotsFor(cityId: string): PlotState[] {
    const out: PlotState[] = [];
    for (const p of plots.values()) {
      if (p.kind !== "home" && (cityId === "*" || p.city === cityId)) out.push(p);
    }
    return out;
  }

  const allJobPlots = jobPlotsFor("*");

  function makeProfile(): TravelProfile {
    return {
      carOwner: profileRng() < tuning.carOwnership,
      walkPatience: 1.5 + profileRng() * 2.5,
      transitAffinity: 0.7 + profileRng() * 0.7,
      carAffinity: 0.7 + profileRng() * 0.7,
    };
  }

  // Nearest workplace with a free job, chosen from the nearest few rather than
  // strictly the closest — which is what puts some people on a long commute,
  // and long commutes are what make a railway worth building.
  function assignJob(homeId: string): string | null {
    if (habitRng() < tuning.joblessShare) return null;
    const home = plotById.get(homeId);
    if (!home) return null;
    const open = allJobPlots
      .filter(p => p.people < p.capacity)
      .map(p => ({ p, d: manhattan(home, plotById.get(p.id) as WorldPlot) }))
      .sort((a, b) => a.d - b.d);
    if (open.length === 0) return null;
    const pool = open.slice(0, Math.min(6, open.length));
    const pick = pool[Math.floor(habitRng() * pool.length)] ?? pool[0];
    pick.p.people += 1;
    return pick.p.id;
  }

  function addCitizen(homeId: string): Citizen | null {
    const home = plots.get(homeId);
    if (!home || home.kind !== "home" || home.people >= home.capacity) return null;
    home.people += 1;
    const c: Citizen = {
      id: `c${nextId++}`,
      home: homeId,
      work: assignJob(homeId),
      profile: makeProfile(),
      mood: 0.6,
      at: homeId,
      trip: null,
      outHour: 7 + habitRng() * 2,
      backHour: 16 + habitRng() * 2,
      shopHour: 10 + habitRng() * 9,
      lastOutDay: -1,
      lastBackDay: -1,
      lastShopDay: -1,
      unhappyDays: 0,
    };
    people.set(c.id, c);
    return c;
  }

  function removeCitizen(c: Citizen): void {
    const home = plots.get(c.home);
    if (home) home.people = Math.max(0, home.people - 1);
    if (c.work) {
      const w = plots.get(c.work);
      if (w) w.people = Math.max(0, w.people - 1);
    }
    // Leave no ghost in a queue or aboard a train.
    if (c.trip?.station) {
      const q = shadowQueue.get(c.trip.station);
      if (q) {
        const i = q.indexOf(c.id);
        if (i >= 0) q.splice(i, 1);
      }
    }
    for (const list of riders.values()) {
      const i = list.indexOf(c.id);
      if (i >= 0) list.splice(i, 1);
    }
    // Somebody who leaves town mid-journey does not leave a ghost behind.
    if (c.trip?.carTrip) driving?.release(c.trip.carTrip);
    if (c.trip?.walkTrip) walking?.release(c.trip.walkTrip);
    people.delete(c.id);
  }

  // Seed the board: every home plot opens with a random number of residents up
  // to its capacity — a town is never uniformly full, and never empty.
  for (const p of world.plots) {
    if (p.kind !== "home") continue;
    const state = plots.get(p.id) as PlotState;
    const target = Math.round(state.capacity * (0.45 + placeRng() * 0.5));
    for (let i = 0; i < target; i++) addCitizen(p.id);
  }

  // --- geography ---------------------------------------------------------------

  function plotOf(id: string): WorldPlot | undefined {
    return plotById.get(id);
  }

  function distBetween(aId: string, bId: string): number {
    const a = plotOf(aId);
    const b = plotOf(bId);
    if (!a || !b) return 0;
    return manhattan(a, b);
  }

  function walkToStation(p: WorldPlot, station: string): number {
    const s = stationCoord.get(station);
    return s ? manhattan(p, s) : Infinity;
  }

  function nearestStation(p: WorldPlot): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const s of p.stationsInReach) {
      const d = walkToStation(p, s);
      if (d < bestD || (d === bestD && best !== null && s < best)) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  // The nearest station you can drive to and leave the car at — "drive to"
  // meaning on the same road network as the plot, not merely near it.
  function nearestParkAndRide(p: WorldPlot): ParkAndRideStation | null {
    let best: ParkAndRideStation | null = null;
    let bestD = Infinity;
    for (const s of world.parkAndRideStations) {
      if (s.roadComponent === null || s.roadComponent !== p.roadComponent) continue;
      const c = stationCoord.get(s.station);
      if (!c) continue;
      const d = manhattan(p, c);
      if (d < bestD || (d === bestD && best !== null && s.station < best.station)) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  // --- mode choice -------------------------------------------------------------

  interface ModeOption {
    mode: TravelMode;
    cost: number;
    // The station a transit-ish trip starts from.
    station: string | null;
    // Seconds of timed leg before the platform (walk to it, or drive to it).
    approachSec: number;
  }

  function optionsFor(c: Citizen, fromId: string, toId: string): ModeOption[] {
    const from = plotOf(fromId);
    const to = plotOf(toId);
    const out: ModeOption[] = [];
    if (!from || !to) return out;
    const d = manhattan(from, to);

    // Walking is available to anyone for any distance up to the hard maximum.
    // Past their own patience it is priced as the slog it is, so a car or a
    // train wins as soon as one is on offer — but it stays possible, because in
    // a real town a short walk is never impossible.
    if (d <= tuning.walkMaxTiles) {
      const sec = d / tuning.walkSpeed;
      const slog = 1 + Math.max(0, d - c.profile.walkPatience) * tuning.walkImpatience;
      out.push({ mode: "walk", cost: sec * slog, station: null, approachSec: sec });
    }

    // Driving needs ONE road network reaching both ends. Two towns with their
    // own streets and nothing between them cannot be driven between, and that
    // is what makes the railway the answer rather than a nicety.
    if (
      c.profile.carOwner &&
      from.roadComponent !== null &&
      from.roadComponent === to.roadComponent
    ) {
      const drive = (d * tuning.roadDetour) / tuning.carSpeed + tuning.parkPenaltySec;
      out.push({
        mode: "car",
        cost: drive * c.profile.carAffinity,
        station: null,
        approachSec: drive,
      });
    }

    if (transit) {
      const board = nearestStation(from);
      const alight = nearestStation(to);
      if (board && alight && board !== alight) {
        const access = walkToStation(from, board) / tuning.walkSpeed;
        const egress = walkToStation(to, alight) / tuning.walkSpeed;
        const ride =
          manhattan(
            stationCoord.get(board) as { x: number; y: number },
            stationCoord.get(alight) as { x: number; y: number }
          ) / tuning.trainSpeed;
        out.push({
          mode: "transit",
          cost:
            (access + tuning.assumedHeadwaySec + ride + egress) * c.profile.transitAffinity,
          station: board,
          approachSec: access,
        });
      }

      // Park & ride: drive to a station that has parking, ride in, walk out.
      // Only worth offering when the destination end is served by rail and the
      // driving leg is not the whole trip anyway.
      if (c.profile.carOwner && from.roadComponent !== null && alight) {
        const pr = nearestParkAndRide(from);
        if (pr && pr.station !== alight) {
          const prCoord = stationCoord.get(pr.station) as { x: number; y: number };
          const drive =
            (manhattan(from, prCoord) * tuning.roadDetour) / tuning.carSpeed +
            tuning.parkPenaltySec;
          const egress = walkToStation(to, alight) / tuning.walkSpeed;
          const ride =
            manhattan(prCoord, stationCoord.get(alight) as { x: number; y: number }) /
            tuning.trainSpeed;
          out.push({
            mode: "parkAndRide",
            cost:
              (drive + tuning.assumedHeadwaySec + ride + egress) *
              ((c.profile.transitAffinity + c.profile.carAffinity) / 2),
            station: pr.station,
            approachSec: drive,
          });
        }
      }
    }

    return out;
  }

  function chooseMode(c: Citizen, fromId: string, toId: string): ModeOption | null {
    const opts = optionsFor(c, fromId, toId);
    if (opts.length === 0) return null;
    return opts.reduce((a, b) => (b.cost < a.cost ? b : a));
  }

  // --- trips -------------------------------------------------------------------

  function startTrip(
    c: Citizen,
    toId: string,
    purpose: TripPurpose,
    topic: "commute" | "errands"
  ): void {
    const fromId = c.at;
    if (fromId === toId) return;
    const option = chooseMode(c, fromId, toId);
    const cityId = plotOf(c.home)?.city;
    if (!option) {
      // Refused: no way to make this journey at all. The single strongest
      // signal in the model, and it lands on `access`.
      tripsRefused += 1;
      c.mood = clamp01(c.mood - 0.3);
      if (cityId) feedTopic(cityId, "access", 0, FAILURE_WEIGHT);
      return;
    }
    if (cityId) feedTopic(cityId, "access", 1);
    const dist = distBetween(fromId, toId);
    c.trip = {
      purpose,
      topic,
      from: fromId,
      to: toId,
      mode: option.mode,
      startedAt: clock,
      expectedSec: Math.max(4, dist / tuning.refSpeed),
      leg: option.mode === "walk" ? "walking" : option.mode === "car" ? "driving" : option.mode === "parkAndRide" ? "driving" : "walking",
      legRemaining: option.approachSec,
      station: option.station,
      onPlatform: false,
      waitedSec: 0,
      transfers: 0,
      carTrip: null,
      carSec: 0,
      walkTrip: null,
    };
    // A driving leg becomes an ACTUAL CAR on the board whenever the road sim can
    // dispatch one: this person is now a vehicle in traffic, and their journey
    // time is whatever the traffic gives them. When it cannot (no route, the
    // street blocked, the road at its cap) the leg stays on its clock, which is
    // exactly what it always was.
    const trip = c.trip;
    if (driving && (trip.mode === "car" || trip.mode === "parkAndRide")) {
      const origin = plotOf(fromId)?.roadTile ?? null;
      const target =
        trip.mode === "car"
          ? (plotOf(toId)?.roadTile ?? null)
          : (parkAndRideByStation.get(option.station ?? "")?.roadTile ?? null);
      if (origin && target && origin !== target) {
        trip.carTrip = driving.request(origin, target);
      }
    }
    // A walking leg becomes an ACTUAL PERSON on the pavement whenever a footway
    // route joins the two ends. The whole trip for a walk; the approach to the
    // platform for a rail journey.
    if (walking && trip.leg === "walking") {
      const target = trip.mode === "walk" ? toId : (trip.station ?? "");
      if (target) trip.walkTrip = walking.request(fromId, target);
    }
  }

  function finishTrip(c: Citizen, ok: boolean): void {
    const t = c.trip;
    if (!t) return;
    c.trip = null;
    const cityId = plotOf(c.home)?.city;
    if (!ok) {
      tripsAbandoned += 1;
      c.mood = clamp01(c.mood - 0.3);
      if (cityId) {
        feedTopic(cityId, t.topic, 0, FAILURE_WEIGHT);
        feedTopic(cityId, "access", 0, FAILURE_WEIGHT);
      }
      // They go home rather than vanish — an abandoned trip still ends somewhere.
      c.at = c.home;
      return;
    }
    c.at = t.to;
    const actual = clock - t.startedAt;
    const ratio = actual / t.expectedSec;
    // Better than expected nudges up a little; much worse pulls down hard. A
    // good commute is normal, a bad one is an event.
    const delta = Math.max(-0.35, Math.min(0.12, 1.4 - ratio));
    c.mood = clamp01(c.mood + delta);
    tripsCompleted += 1;
    modeTotals[t.mode] += 1;
    if (cityId) {
      feedTopic(cityId, t.topic, clamp01(1.6 - ratio));
      const city = cities.get(cityId);
      if (city) city.modeCounts[t.mode] += 1;
    }
  }

  // `weight` multiplies how far this outcome moves the average. A failure counts
  // for several ordinary journeys, because it is not an ordinary journey: a
  // commute that could not be made is the thing the player has to see, and one
  // failure among three easy walks should not average out to "fine".
  function feedTopic(cityId: string, topic: Topic, value: number, weight = 1): void {
    const city = cities.get(cityId);
    if (!city) return;
    const a = Math.min(1, EMA_ALPHA * weight);
    city.ema[topic] = city.ema[topic] * (1 - a) + value * a;
  }

  // How much louder a failed journey is than a completed one.
  const FAILURE_WEIGHT = 4;

  function boardOrWait(c: Citizen): void {
    const t = c.trip;
    if (!t || !t.station || !transit) return;
    if (t.onPlatform) return;
    // The platform may be full: they keep trying, and the time counts.
    if (transit.enqueue(t.station, 1) > 0) {
      t.onPlatform = true;
      const q = shadowQueue.get(t.station) ?? [];
      q.push(c.id);
      shadowQueue.set(t.station, q);
    }
  }

  function advanceTrip(c: Citizen, dt: number): void {
    const t = c.trip;
    if (!t) return;
    switch (t.leg) {
      case "driving": {
        // Riding in a real car: the leg ends when the CAR arrives, not when a
        // clock runs out. That is the whole point — a jam, a queue at a junction
        // and a closed level crossing are now paid for in this person's journey
        // time, and therefore in their mood.
        if (t.carTrip) {
          t.carSec += dt;
          if (driving?.status(t.carTrip) === "arrived") {
            driving.release(t.carTrip);
            t.carTrip = null;
            arriveFromDrive(c, t);
            return;
          }
          // A car that never arrives must not hold its passenger for ever: a
          // live edit can delete the road under it, and gridlock is a thing the
          // player is allowed to cause. Past the give-up point they abandon the
          // car and the journey, which is the correct signal.
          if (t.carSec > tuning.maxWaitSec * 2) {
            driving?.release(t.carTrip);
            t.carTrip = null;
            finishTrip(c, false);
          }
          return;
        }
        t.legRemaining -= dt;
        if (t.legRemaining <= 0) arriveFromDrive(c, t);
        return;
      }
      case "walking": {
        // On a real pavement: the leg ends when the WALKER gets there. The
        // clock still runs alongside as the backstop — a pavement deleted under
        // somebody's feet must not strand them.
        t.legRemaining -= dt;
        if (t.walkTrip) {
          const done = walking?.status(t.walkTrip) === "arrived";
          if (!done && t.legRemaining > -tuning.maxWaitSec) return;
          walking?.release(t.walkTrip);
          t.walkTrip = null;
        } else if (t.legRemaining > 0) {
          return;
        }
        if (t.mode === "walk") {
          finishTrip(c, true);
          return;
        }
        // Reached the platform on foot.
        t.leg = "waiting";
        t.waitedSec = 0;
        boardOrWait(c);
        return;
      }
      case "waiting": {
        t.waitedSec += dt;
        boardOrWait(c);
        if (t.waitedSec > tuning.maxWaitSec) {
          leavePlatform(c);
          finishTrip(c, false);
        }
        return;
      }
      case "egress": {
        t.legRemaining -= dt;
        if (t.legRemaining <= 0) finishTrip(c, true);
        return;
      }
      case "riding":
        return; // driven by the rail sim's events, not by a clock
    }
  }

  // The driving leg is over. For a car trip that IS the journey; for park & ride
  // the car has been left at the station and the platform is next.
  function arriveFromDrive(c: Citizen, t: Trip): void {
    if (t.mode === "car") {
      finishTrip(c, true);
      return;
    }
    t.leg = "waiting";
    t.waitedSec = 0;
    boardOrWait(c);
  }

  function leavePlatform(c: Citizen): void {
    const t = c.trip;
    if (!t?.station) return;
    const q = shadowQueue.get(t.station);
    if (q) {
      const i = q.indexOf(c.id);
      if (i >= 0) q.splice(i, 1);
    }
    t.onPlatform = false;
  }

  // --- the rail mirror ---------------------------------------------------------
  //
  // A DwellEvent says exactly how many people got off and on. Mirroring THOSE
  // numbers (never the platform count, which the scheduled demand also moves)
  // is what keeps this sim's shadow of the queue honest.
  function mirrorRail(events: SimEvent[]): void {
    for (const e of events) {
      // A train that PARKED has reached the end of the line. Anyone still in a
      // seat has been carried to a depot, which is not a destination: their
      // journey has failed and they make their own way home.
      //
      // ONLY on a matched arrival. A colour MISMATCH is a bounce — the train
      // reverses out and carries on, riders and all (the rail sim says so
      // itself: "a bounced train keeps its riders aboard"). Treating a bounce as
      // a termination failed every passenger on a shuttle twice a lap, which is
      // most of them, on a railway that was working perfectly.
      if (e.type === "arrived" && e.matched) {
        const aboard = riders.get(e.trainId);
        if (aboard?.length) {
          for (const id of aboard) {
            const c = people.get(id);
            if (c) finishTrip(c, false);
          }
          riders.set(e.trainId, []);
        }
        continue;
      }
      if (e.type !== "dwell") continue;
      const aboard = riders.get(e.trainId) ?? [];
      // Who gets off here, and who stays in their seat.
      const staying: string[] = [];
      for (const id of aboard) {
        if (!alightAt(id, e.tileId)) staying.push(id);
      }
      // Then board from this platform, in the order people arrived on it.
      const q = shadowQueue.get(e.tileId) ?? [];
      const on = q.splice(0, Math.min(e.boarded, q.length));
      shadowQueue.set(e.tileId, q);
      for (const id of on) {
        const c = people.get(id);
        if (!c?.trip) continue;
        c.trip.leg = "riding";
        c.trip.onPlatform = false;
        staying.push(id);
      }
      riders.set(e.trainId, staying);
    }
  }

  // Off the train, or not. One question: is where I am going within walking
  // reach of THIS station? Returns true if they got off.
  //
  // A CITIZEN STAYS IN THEIR SEAT UNTIL THEIR STATION COMES UP. The rail sim's
  // passengers are typeless counts that ride exactly one hop and are set down at
  // the next call (Bahnhof phase 2, D6) — that is fine for an anonymous crowd
  // and wrong for a person who knows where they are going. Mirroring it
  // literally was catastrophic on a shuttle: a train would take sixteen people
  // aboard at a platform, run to the depot at the end of the line, bounce, and
  // put all sixteen back down at the SAME platform as a "transfer" — so a
  // perfectly good railway looked to its passengers like one that never went
  // anywhere, and most of them gave up.
  //
  // The cost of this approximation is that a through-rider keeps a seat the rail
  // sim has already freed, so the sim's own passenger count under-reads on a
  // multi-hop journey. Boarding is still gated by the real train's real
  // capacity, which is the part that has to be true. Destination-typed
  // passengers in the sim itself are the proper fix — design doc §9 phase B.
  function alightAt(citizenId: string, stationId: string): boolean {
    const c = people.get(citizenId);
    const t = c?.trip;
    if (!c || !t) return true; // vanished mid-ride: let go of the seat
    const dest = plotOf(t.to);
    if (dest && dest.stationsInReach.includes(stationId)) {
      t.leg = "egress";
      t.station = stationId;
      t.legRemaining = walkToStation(dest, stationId) / tuning.walkSpeed;
      return true;
    }
    // Not my stop. `transfers` counts stations ridden past: a rider carried past
    // too many of them is on a train that is not going where they need.
    t.transfers += 1;
    if (t.transfers > tuning.maxTransfers) {
      finishTrip(c, false);
      return true;
    }
    return false;
  }

  // --- the day -----------------------------------------------------------------

  function hourNow(): number {
    return ((clock % tuning.secPerDay) / tuning.secPerDay) * 24;
  }

  function considerTrips(c: Citizen): void {
    if (c.trip) return;
    const hour = hourNow();
    // Home for the night, whatever else happened today.
    if (hour >= 22 && c.at !== c.home) {
      startTrip(c, c.home, "home", "commute");
      return;
    }
    if (c.work && c.at === c.home && c.lastOutDay !== dayIndex && hour >= c.outHour && hour < c.outHour + 3) {
      c.lastOutDay = dayIndex;
      startTrip(c, c.work, "work", "commute");
      return;
    }
    if (c.work && c.at === c.work && c.lastBackDay !== dayIndex && hour >= c.backHour) {
      c.lastBackDay = dayIndex;
      startTrip(c, c.home, "home", "commute");
      return;
    }
    // Errands, every other day, from home.
    if (
      c.at === c.home &&
      c.lastShopDay !== dayIndex &&
      hour >= c.shopHour &&
      hour < c.shopHour + 2 &&
      (dayIndex + c.home.length + c.id.length) % 2 === 0
    ) {
      c.lastShopDay = dayIndex;
      const shop = nearestShopFor(c);
      if (shop) startTrip(c, shop, "shop", "errands");
    }
  }

  const shopPlots = [...plots.values()].filter(p => p.kind === "shop");

  function nearestShopFor(c: Citizen): string | null {
    const home = plotOf(c.home);
    if (!home || shopPlots.length === 0) return null;
    let best: string | null = null;
    let bestD = Infinity;
    for (const s of shopPlots) {
      const sp = plotOf(s.id);
      if (!sp) continue;
      const d = manhattan(home, sp);
      if (d < bestD || (d === bestD && best !== null && s.id < best)) {
        best = s.id;
        bestD = d;
      }
    }
    return best;
  }

  // --- the day review: who moves in, who moves out, what grows -----------------

  function reviewDay(): void {
    for (const city of cities.values()) {
      city.populationYesterday = city.population;
    }
    recompute();

    // Leaving. A mood that has sat at the bottom for days is someone packing.
    for (const c of [...people.values()]) {
      if (c.mood < 0.25) c.unhappyDays += 1;
      else c.unhappyDays = 0;
      if (c.unhappyDays >= 2 && habitRng() < (0.25 - c.mood) * 3) {
        removeCitizen(c);
      }
    }

    recompute();

    for (const city of cities.values()) {
      const cityPlots = [...plots.values()].filter(p => p.city === city.id);
      const homes = cityPlots.filter(p => p.kind === "home");
      const freeHomes = homes.reduce((n, p) => n + (p.capacity - p.people), 0);
      const freeJobs = cityPlots
        .filter(p => p.kind !== "home")
        .reduce((n, p) => n + (p.capacity - p.people), 0);

      // Arriving. People move where there is BOTH a home and work — a dormitory
      // town with no jobs does not grow.
      if (city.happiness.overall > 0.55 && freeHomes > 0 && freeJobs > 0) {
        const pull = (city.happiness.overall - 0.55) / 0.45;
        const newcomers = Math.min(
          freeHomes,
          Math.max(1, Math.round(freeHomes * 0.25 * pull))
        );
        // Fill the FULLEST plot that still has room first. Spreading newcomers
        // evenly keeps every plot permanently half-empty, so nothing ever
        // reaches capacity and nothing ever upgrades — a town that grows in
        // population but never in buildings. Towns densify; they do not sprawl
        // uniformly.
        const open = homes
          .filter(p => p.people < p.capacity)
          .sort((a, b) => a.capacity - a.people - (b.capacity - b.people) || a.id.localeCompare(b.id));
        for (let i = 0; i < newcomers; i++) {
          const target = open.find(p => p.people < p.capacity);
          if (!target) break;
          addCitizen(target.id);
        }
      }

      // Upgrading. One plot per city per day, so growth is legible: a full plot
      // in a happy town gains a density step and its buildings get bigger.
      city.wantsRoom = false;
      if (city.happiness.overall > 0.6) {
        const full = homes
          .filter(p => p.people >= p.capacity && p.density < MAX_DENSITY)
          .sort((a, b) => a.id.localeCompare(b.id))[0];
        if (full) {
          full.density = (full.density + 1) as Density;
          full.capacity = plotCapacity(full.kind, full.density);
          // Its workplaces keep pace, or the town grows into unemployment.
          const works = cityPlots
            .filter(p => p.kind !== "home" && p.density < MAX_DENSITY)
            .sort((a, b) => a.id.localeCompare(b.id))[0];
          if (works && works.people >= works.capacity * 0.8) {
            works.density = (works.density + 1) as Density;
            works.capacity = plotCapacity(works.kind, works.density);
          }
        } else if (freeHomes === 0) {
          // Full, at max density, and still happy: it needs ground.
          city.wantsRoom = true;
        }
      }
    }
    recompute();
  }

  function recompute(): void {
    for (const city of cities.values()) {
      city.population = 0;
      city.capacity = 0;
      city.jobs = { filled: 0, total: 0 };
    }
    for (const p of plots.values()) {
      const city = cities.get(p.city);
      if (!city) continue;
      if (p.kind === "home") {
        city.population += p.people;
        city.capacity += p.capacity;
      } else {
        city.jobs.filled += p.people;
        city.jobs.total += p.capacity;
      }
    }
    // Mean mood per city — how the people themselves actually feel, as opposed
    // to how the last few journeys went.
    const moodSum = new Map<string, number>();
    const moodCount = new Map<string, number>();
    for (const c of people.values()) {
      const cityId = plotById.get(c.home)?.city;
      if (!cityId) continue;
      moodSum.set(cityId, (moodSum.get(cityId) ?? 0) + c.mood);
      moodCount.set(cityId, (moodCount.get(cityId) ?? 0) + 1);
    }

    for (const city of cities.values()) {
      const n = moodCount.get(city.id) ?? 0;
      const mood = n ? (moodSum.get(city.id) as number) / n : 0.5;
      // Half the topics, half the mood. The topics say what is going wrong;
      // the mood says how much it matters, and the mood is what actually
      // decides who leaves. Scoring `overall` on the topics alone read 0.77 for
      // a town that was losing two thirds of its people — because the walkers'
      // perfectly good local trips diluted the commuters' ruined ones — and a
      // headline number that disagrees with the population arrow beside it is
      // worse than no headline number.
      city.happiness = {
        commute: city.ema.commute,
        errands: city.ema.errands,
        access: city.ema.access,
        overall:
          0.5 * mood +
          0.5 * (city.ema.commute * 0.5 + city.ema.errands * 0.2 + city.ema.access * 0.3),
      };
      const total =
        city.modeCounts.walk +
        city.modeCounts.car +
        city.modeCounts.transit +
        city.modeCounts.parkAndRide;
      city.modeShare = total
        ? {
            walk: city.modeCounts.walk / total,
            car: city.modeCounts.car / total,
            transit: city.modeCounts.transit / total,
            parkAndRide: city.modeCounts.parkAndRide / total,
          }
        : { walk: 0, car: 0, transit: 0, parkAndRide: 0 };
    }
  }

  recompute();

  // --- the tick ----------------------------------------------------------------

  function step(dt: number, events: SimEvent[] = []): void {
    if (!(dt > 0)) return;
    clock += dt;
    if (events.length) mirrorRail(events);

    for (const c of people.values()) {
      if (c.trip) advanceTrip(c, dt);
      else considerTrips(c);
    }

    const day = Math.floor(clock / tuning.secPerDay);
    if (day !== dayIndex) {
      dayIndex = day;
      reviewDay();
    } else {
      recompute();
    }
  }

  function stats(): CitizenStats {
    let travelling = 0;
    let population = 0;
    let drivingNow = 0;
    let walkingNow = 0;
    for (const c of people.values()) {
      population += 1;
      if (c.trip) travelling += 1;
      if (c.trip?.carTrip) drivingNow += 1;
      if (c.trip?.walkTrip) walkingNow += 1;
    }
    const total =
      modeTotals.walk + modeTotals.car + modeTotals.transit + modeTotals.parkAndRide;
    const hour = hourNow();
    const hh = Math.floor(hour);
    const mm = Math.floor((hour - hh) * 60);
    return {
      population,
      citizens: population,
      travelling,
      driving: drivingNow,
      onFoot: walkingNow,
      tripsCompleted,
      tripsRefused,
      tripsAbandoned,
      modeShare: total
        ? {
            walk: modeTotals.walk / total,
            car: modeTotals.car / total,
            transit: modeTotals.transit / total,
            parkAndRide: modeTotals.parkAndRide / total,
          }
        : { walk: 0, car: 0, transit: 0, parkAndRide: 0 },
      day: dayIndex,
      hour,
      clock: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    };
  }

  return {
    step,
    cities: () =>
      [...cities.values()].map<CityState>(c => ({
        id: c.id,
        name: c.name,
        population: c.population,
        capacity: c.capacity,
        jobs: { ...c.jobs },
        happiness: { ...c.happiness },
        modeShare: { ...c.modeShare },
        populationYesterday: c.populationYesterday,
        wantsRoom: c.wantsRoom,
      })),
    plots: () => [...plots.values()].map(p => ({ ...p })),
    citizens: () => [...people.values()],
    stats,
    now: () => clock,
    day: () => dayIndex,
    hour: hourNow,
    waitingAt: (stationId: string) => shadowQueue.get(stationId)?.length ?? 0,
  };
}
