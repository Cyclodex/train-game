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
// WHEN they travel is the other half, and it is a LIFE STAGE. Everybody used to
// be the same commuter with the same three hours, which gave a board two spikes
// and eleven dead hours; a person now gets a `routine` — a list of activities
// with windows — chosen by which stage of life they are at. The tradesperson's
// round of call-outs and the child's half-past-twelve trip home are the two that
// own the middle of the day.
//
// Design: docs/superpowers/specs/2026-08-01-citizens-and-cities-design.md
//         docs/superpowers/specs/2026-08-04-life-stages-and-daily-routines-design.md

export type TravelMode = "walk" | "car" | "transit" | "parkAndRide";
export const TRAVEL_MODES: TravelMode[] = ["walk", "car", "transit", "parkAndRide"];

// What a trip is FOR — and, because an activity is named by where it sends you,
// this doubles as the set of PLACES a routine can point at (see `Activity`).
//
// `callout` is the odd one and the interesting one: a tradesperson's job moves,
// so their destination is a different address every day rather than a fixed
// workplace. See `resolveTarget`.
export type TripPurpose = "work" | "home" | "shop" | "school" | "leisure" | "callout";
export type Topic = "commute" | "errands" | "access";

// Which happiness topic a purpose scores against.
//
// Six purposes, still THREE topics, and deliberately so: getting to school or to
// a call-out is a commute — a journey you have no choice about — and the café is
// an errand. A fourth topic would drag `CityHappiness`, `recompute()`'s weights
// and the whole panel behind it to say nothing new.
function topicOf(purpose: TripPurpose): "commute" | "errands" {
  return purpose === "shop" || purpose === "leisure" ? "errands" : "commute";
}

/**
 * What stage of life somebody is at — which decides their DAY, and nothing else.
 *
 * Not a class system and not a speed modifier: every stage walks, drives and
 * rides at the same rate. What differs is WHEN they leave the house and where
 * they go, and that is the whole point. A town where everybody is a `worker`
 * has exactly two busy hours; a town with all five is awake from seven to ten.
 */
export type LifeStage = "child" | "worker" | "shiftWorker" | "tradesperson" | "retired";

/** Stable order, so shares, stats and panels line up everywhere. */
export const LIFE_STAGES: LifeStage[] = [
  "child",
  "worker",
  "shiftWorker",
  "tradesperson",
  "retired",
];

/**
 * One thing somebody does on a normal day.
 *
 * `target` is a ROLE, never an address, and it is resolved when the activity
 * FIRES — because the nearest shop can fill up, a call-out is somewhere
 * different every day, and a school may not exist on this board at all.
 * Freezing an address at move-in would freeze all three.
 */
export interface Activity {
  /** Where this sends them, which is also what the trip is FOR. */
  target: TripPurpose;
  /**
   * Only fire when they are currently AT this place. A worker's errand belongs
   * to the evening at home, not to a coffee break at the office — without this
   * an activity whose window opens during the working day drags people off the
   * job. Absent = from anywhere, which is what a trip HOME always is.
   */
  from?: TripPurpose;
  /** Earliest start, on the in-game clock. */
  hour: number;
  /** How long the window stays open, in hours. Past it, the day is missed. */
  windowH: number;
  /** 1 = every day, 2 = every other day. */
  everyNDays: number;
  /** The day this last fired — the once-a-day gate `lastOutDay` used to be. */
  lastDay: number;
}

// The legs a trip passes through. Timed legs (`walking`, `driving`) run down a
// clock; `waiting` and `riding` are driven by what the RAIL simulation actually
// does, which is what makes a bad timetable cost real time.
// "parking" is the walk from the space to the door. It is its own leg and not
// part of "walking" because of what ENDS it: an ordinary walking leg either
// finishes the journey or delivers somebody to a platform, and this one always
// finishes a car journey — but only after the car has stopped being traffic and
// started being a parked vehicle holding a real bay.
type Leg = "walking" | "driving" | "parking" | "waiting" | "riding" | "egress";

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
  // The platform they are RIDING TO — their own destination as the railway
  // understands it. Handed to the rail sim when they join the queue, so it
  // carries them where they actually want to go (changing trains if it has to)
  // rather than inventing a destination for them.
  toStation: string | null;
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
  // The train they are sitting on, while they are sitting on one. Bookkeeping
  // for the INSPECTOR rather than the model — `riders` already knows who is on
  // which train, but only the other way round, and a pin following one named
  // person needs the arrow pointing this way.
  trainId: string | null;
}

/** Why a mode is not on offer for a particular journey. */
export type ModeRefusal =
  | "too-far"
  | "no-car"
  | "no-road-link"
  | "no-railway"
  | "no-station-in-reach"
  | "no-park-and-ride"
  | "same-station"
  // Two platforms with track between them are not a SERVICE. Nobody sets out
  // for a station nothing can take them from (D10) — they drive, they walk, or
  // they stay at home. Distinct from "no-station-in-reach": the stations are
  // right there, it is the line that is missing, and that is the player's to
  // fix rather than the map's.
  | "no-service";

/**
 * One mode, priced for one person on one journey — the row the inspector panel
 * draws, and the row `chooseMode` actually compares.
 *
 * TWO numbers, and the gap between them is the interesting part:
 *  · `estimateSec` is the honest door-to-door estimate. What a stopwatch says.
 *  · `cost` is the same journey after this person's habits are applied — the
 *    walk inflated past their patience, the car scaled by how much they like
 *    driving, the train by how much they trust it. This is what decides.
 * A mode that wins on `cost` while losing on `estimateSec` is somebody choosing
 * against their own interest, which is exactly the thing a planner wants to see.
 */
export interface ModeQuote {
  mode: TravelMode;
  estimateSec: number;
  cost: number;
  /** The station a transit-ish trip starts from. */
  station: string | null;
  /**
   * …and the one it ends at. Handed to the rail sim when this person joins the
   * queue, so it carries them where THEY are going — changing trains if it has
   * to — rather than inventing a destination for them.
   */
  toStation: string | null;
  /** Seconds of timed leg before the platform (walk to it, or drive to it). */
  approachSec: number;
  /** True on the one the model picked. */
  chosen: boolean;
  /** Set when this mode is not on offer at all; `estimateSec` is then Infinity. */
  unavailable?: ModeRefusal;
}

/**
 * One scored journey, kept so the inspector can say WHY somebody is unhappy.
 *
 * "Thinking of leaving" with no reason beside it is the least useful thing a
 * panel can say: the player cannot act on a mood, only on the journey that
 * caused it. This is the evidence.
 */
export interface TripOutcome {
  purpose: TripPurpose;
  mode: TravelMode | null;
  /** How long it took, and how long they thought it should. Board seconds. */
  actualSec: number;
  expectedSec: number;
  /** What it did to their mood. Negative is a grievance. */
  delta: number;
  /** Set when the journey never happened at all. */
  failed: "refused" | "abandoned" | null;
}

/** How many scored journeys a person remembers. Enough to see a pattern. */
export const RECENT_TRIPS = 5;

export interface Citizen {
  id: string;
  home: string;
  work: string | null;
  profile: TravelProfile;
  mood: number;
  at: string; // the plot they are currently at (their home while travelling home)
  trip: Trip | null;
  /** What stage of life they are at — which routine they were given. */
  stage: LifeStage;
  /**
   * Their day, in order of hour. Rolled once when they move in and never
   * re-rolled: a schedule is a clock, not a planner.
   */
  routine: Activity[];
  // THEIR CAR, standing in a bay somewhere while they are not in it. This is
  // what makes a commuter's car a thing that occupies the world for a whole
  // working day rather than a sprite that is deleted on arrival: the space is
  // held against every other driver looking for one, and the same vehicle is
  // the one that drives home at going-home time.
  parkedCar: {
    tripId: string; // the road sim's trip (which is also the car's id)
    at: string; // the plot they parked FOR — where they will come back from
    tileId: string; // the road tile the car is standing on
  } | null;
  // Consecutive days spent miserable — the emigration trigger.
  unhappyDays: number;
  // Sim-time until which this person is not going anywhere: a journey they
  // could not make costs them the rest of that stretch of the day, rather than
  // freeing them up for cheerful errands (see the refusal in `startTrip`).
  stuckUntil: number;
  // The last few scored journeys, newest first: the evidence behind the mood.
  recent: TripOutcome[];
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
  // What time it is when the board opens.
  //
  // 07:00 by default, and not midnight: a board that starts at 00:00 shows you
  // an empty town for seven in-game hours before anybody leaves the house, and
  // whoever opened it has to sit through that every single time. Opening at the
  // morning peak means the first thing you see is the thing the mode is about.
  startHour: number;
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
  // What parking costs a driver, in seconds of perceived time, when they are
  // COMPARING modes. Still an estimate and still flat, because that is what a
  // driver knows before they set off — what it actually costs them is measured
  // afterwards from where the car really stopped (`walkFromBaySec`). The gap
  // between the two is what makes somebody unhappy about their commute.
  parkPenaltySec: number;
  // What it costs to arrive somewhere with nowhere to park: the circling, and
  // then leaving it further away than anybody would choose. Charged only when
  // the driver actually went looking on a board that HAS parking — a board with
  // none has no parking problem, it has no parking.
  parkSearchSec: number;
  // How far from HOME a resident will take a space, in tiles.
  //
  // Much shorter than the commuter's radius, and the reason is not politeness —
  // it is what somebody will actually do. A bay six tiles from the office is a
  // walk you make once and grumble about; six tiles from your own front door,
  // every night, with the shopping, is not parking at home at all. Your street
  // and the next one is the whole of it.
  //
  // It is also the fence that keeps residents out of the workplace forecourts
  // across town — see the dispatch rule in `startTrip`, which is where the
  // measured 12-of-12-bays-at-03:00 failure came from.
  homeParkTiles: number;
  // DOOR TO KERB, in tiles, paid once at each end of a JOURNEY.
  //
  // A plot-to-plot straight line is not a journey. The real one goes down the
  // driveway, along the pavement and up the other driveway, and
  // `sim/pedestrians` walks exactly that — measured at a near-constant 2.5
  // tiles of extra walking whatever the separation (2.39 at four tiles apart,
  // 2.64 at one), because it is two fixed end legs and not a detour that scales.
  //
  // Leaving it out was not a rounding error, it was a trap: the panel quoted a
  // next-door commute at 4s, the walker took 15-20s, and the citizen was scored
  // against the same optimistic distance — so somebody whose job was ONE TILE
  // from their door took the maximum unhappiness penalty twice a day and left
  // town on the third. A yardstick nobody can reach is not an expectation.
  //
  // It belongs to the JOURNEY, not to walking. Charging it to the walk alone
  // made people drive next door — measured: the walk share on `/test/citizenwalk`
  // fell from 89% to 46% — which is absurd, and the reason is obvious once
  // stated: a driver walks to their car and from their parking space too.
  // Transit does not get it, because its access and egress legs are already
  // modelled explicitly.
  walkAccessTiles: number;
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
  /**
   * How the town is made up, by life stage. Shares; normalised, so they need not
   * add to one.
   *
   * This REPLACES the old `joblessShare`, which was documented as "children,
   * retired" and treated both as the same person: somebody with nothing to do
   * but one errand every second day. That single number is most of why the board
   * was empty between the peaks — a quarter of the population had almost no
   * reason to leave the house, and the rest all left at once.
   */
  stageMix: Record<LifeStage, number>;
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
  startHour: 7,
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
  // Three times the quoted penalty. Deliberately a lot: this is the number that
  // makes a full street read as a failure rather than as a rounding error, and
  // it is the one a player fixes with a car park.
  parkSearchSec: 24,
  // Your own drive is one tile away (it is on the road tile your house fronts
  // onto), so 2 is "my drive, or the kerb at the end of the road".
  homeParkTiles: 2,
  walkAccessTiles: 2.5,
  walkMaxTiles: 6,
  walkImpatience: 0.5,
  maxWaitSec: 45,
  maxTransfers: 6,
  carOwnership: 0.55,
  // Roughly a Swiss village: half of it holds an ordinary day job, an eighth
  // works a shift, an eighth has a trade that takes them out on the road, and
  // the remaining quarter is the school run and the retired — the two groups
  // that own the middle of the day.
  stageMix: {
    child: 0.1,
    worker: 0.5,
    shiftWorker: 0.12,
    tradesperson: 0.13,
    retired: 0.15,
  },
};

// The rail world, as the citizen sim is allowed to touch it. Omitted → transit
// and park & ride are simply not available, which is exactly right for a
// headless test with no railway in it.
export interface TransitPort {
  // Put ONE named person on this platform, bound for `dest`. False when the
  // platform is at its cap; the citizen only counts as waiting once accepted,
  // and keeps trying while the clock runs. The `tag` comes back on the rail
  // sim's dwell events, which is how this layer learns when its person boarded
  // and where they got off — instead of shadowing the sim's queue and guessing.
  enqueue(stationId: string, dest: string, tag: string): boolean;
  // Does any chain of SERVICES connect these two platforms? Nobody sets out for
  // a station nothing can take them to: they drive, they walk, or they stay at
  // home and think less of you for it (D10).
  connects(fromStation: string, toStation: string): boolean;
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
  // The walk from a parked CAR to the door, named by the car's own trip.
  //
  // NOT `request` with the road tile as a plot: a plot resolves to the street it
  // fronts onto and to a pavement side taken from where its building stands, and
  // a parked car has neither — it is already on the road tile, and which
  // pavement it is beside is decided by the kerb its bay hugs. Passing the TRIP
  // rather than a tile keeps that entirely on the far side of this port: the
  // citizen layer stays out of banks, sides and bay geometry, exactly as it
  // stays out of terrain.
  //
  // Null when there is no footway route (or no pavement at all), and the caller
  // then charges the leg as time — which is what it did before anybody was drawn
  // walking it.
  requestFromKerb(carTripId: string, toPlotId: string): string | null;
  status(tripId: string): "walking" | "arrived";
  release(tripId: string): void;
}

export interface DrivingPort {
  // Send a real car from one road tile to another. Returns a trip id, or null
  // when no car could be dispatched — no route, the street outside blocked, the
  // road full. A null is not a failed journey: the citizen simply drives
  // "off-screen" on a timer instead, so a saturated road never strands anyone.
  //
  // `park` asks for the car to TAKE A SPACE at the far end and hold it, instead
  // of evaporating at the address. The status then goes "parked" rather than
  // "arrived", and the car is still there — outside the works, in the way of
  // everybody else looking for a space — until `resume` sends it home.
  //
  // `park.permit` is the driver's own ADDRESS, and it is the key to that
  // household's drive (`tiles/homeParking.ts`). Somebody driving home carries
  // it and nobody else does, which is the whole difference between a drive and
  // a car park: a stranger cannot take it however empty it is.
  //
  // `park.searchTiles` bounds how far from the destination a space is still
  // worth having. It is deliberately much shorter going home than going to work
  // — see `HOME_PARK_TILES`.
  request(
    fromTileId: string,
    toTileId: string,
    park?: { permit?: string; searchTiles?: number },
  ): string | null;
  // Is that car still going? "parked" means the driving leg is over and the
  // vehicle is standing in a bay waiting for its owner.
  status(tripId: string): "driving" | "parked" | "arrived";
  // The tile a parked car is standing on — how far its owner has to walk.
  parkedAt(tripId: string): string | null;
  // Did this trip set off looking for a space on a board that has spaces? True
  // and finished WITHOUT one means the driver circled and found nothing, which
  // is the thing a player can fix by building a car park.
  wantedSpace(tripId: string): boolean;
  // The owner is back: give up the bay and drive to `toTileId`. False when
  // there is no such parked car any more, and the caller falls back to
  // dispatching a fresh one.
  //
  // `park` makes the return leg a parking trip in its own right, on the same
  // terms as `request` — which is what the evening commute is. Omitted, the car
  // is retired at the address, which is right for the cases where nobody is
  // coming back for it (an emigrant's car, a journey abandoned).
  resume(
    tripId: string,
    toTileId: string,
    park?: { permit?: string; searchTiles?: number },
  ): boolean;
  // Nobody is coming back for this car: take it off the board and hand its bay
  // back. Releasing the TRIP alone would leave the vehicle standing there.
  abandon(tripId: string): void;
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
  // Citizens whose car is standing in a real bay right now, holding it against
  // every other driver. The observable that says commuter parking is happening
  // at all — from outside a headless run there is no other way to see it.
  carsParked: number;
  // ...and how many of those are standing AT HOME rather than out at a
  // workplace. The two numbers trade places over a day — the town's cars are on
  // its drives at 03:00 and at its workplaces at 11:00 — and separating them is
  // the only way to see that cycle from a headless run. One number could not:
  // it reads the same at both ends of the day.
  carsAtHome: number;
  tripsCompleted: number;
  tripsRefused: number;
  tripsAbandoned: number;
  modeShare: Record<TravelMode, number>;
  /** How the town is made up — the mix that decides what its day looks like. */
  byStage: Record<LifeStage, number>;
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
  /** One person by id, for the inspector. Null once they have left town. */
  citizen(id: string): Citizen | null;
  /** Everyone whose home OR workplace is this plot — the plot's roll call. */
  citizensOf(plotId: string): Citizen[];
  /**
   * Price every mode for one person on one journey: what the model compares
   * when it decides, exposed so the panel can show it rather than guess it.
   * Defaults to the commute (home → work). Null for an unknown person, or when
   * they have no journey to price.
   */
  quoteFor(citizenId: string, fromId?: string, toId?: string): ModeQuote[] | null;
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

// A small stable number from an id. Used wherever something must vary between
// PEOPLE (or between days) without drawing from an RNG stream — a draw at read
// time would make the same question give a different answer on the next frame.
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 997;
}

/**
 * The day each life stage lives, in order of hour.
 *
 * Read the `hour` column down the page and you can see the feature: `worker`
 * alone gives a board two spikes and eleven dead hours, and every other stage
 * exists to put somebody in one of those hours.
 *
 * One rule holds it together: a trip HOME never carries `from`, so wherever the
 * day left somebody they can always get back. Everything else is anchored — an
 * errand starts at home, a call-out starts at the yard.
 */
function makeRoutine(stage: LifeStage, rng: () => number): Activity[] {
  const a = (
    target: TripPurpose,
    hour: number,
    windowH: number,
    everyNDays = 1,
    from?: TripPurpose
  ): Activity => ({ target, from, hour, windowH, everyNDays, lastDay: -1 });

  switch (stage) {
    // The school run, and the only counter-peak on the board: out BEFORE the
    // commuters and home again at half past twelve, straight into the hole the
    // working day leaves.
    case "child":
      return [
        a("school", 7.25 + rng() * 0.5, 1.5, 1, "home"),
        a("home", 12 + rng() * 1.5, 3),
        a("leisure", 15 + rng() * 1.5, 2, 2, "home"),
        a("home", 17 + rng() * 1.5, 5),
      ];
    // The status quo, with one fix: the errand has moved to the EVENING. It used
    // to be rolled anywhere from 10:00 to 19:00 and then gated on being at home
    // — so for most workers the window opened while they were at their desk and
    // the trip simply never happened.
    case "worker":
      return [
        a("work", 7 + rng() * 2, 3, 1, "home"),
        a("home", 16 + rng() * 2, 6),
        a("shop", 17.5 + rng() * 2, 2, 2, "home"),
      ];
    // The afternoon and the late evening, which nobody else touches.
    case "shiftWorker":
      return [
        a("shop", 9.5 + rng(), 2, 2, "home"),
        a("work", 13 + rng(), 3, 1, "home"),
        a("home", 21 + rng(), 4),
      ];
    // The same person who goes to work — their job simply moves. Out to the yard
    // early, then a round of call-outs in the van, back to the yard between them,
    // home at the end. Six activities, and they own the whole middle of the day.
    case "tradesperson":
      return [
        a("work", 6.5 + rng() * 0.5, 2, 1, "home"),
        a("callout", 8.5 + rng() * 0.5, 2, 1, "work"),
        a("work", 11 + rng() * 0.5, 2),
        a("callout", 13 + rng() * 0.5, 2, 1, "work"),
        a("work", 15.5 + rng() * 0.5, 2),
        a("home", 17 + rng() * 0.5, 5),
      ];
    // The reliable mid-morning traffic: the café EVERY day, not every second one,
    // because that is the difference between a town with a life and a town with
    // an errand.
    case "retired":
      return [
        a("leisure", 9 + rng() * 1.5, 2.5, 1, "home"),
        a("home", 11 + rng() * 1.5, 3),
        a("shop", 14 + rng() * 2, 2.5, 2, "home"),
        a("home", 16.5 + rng() * 2, 5),
      ];
  }
}

/** The stages that hold down a job. Children and the retired do not. */
const EMPLOYED: ReadonlySet<LifeStage> = new Set<LifeStage>([
  "worker",
  "shiftWorker",
  "tradesperson",
]);

/** Where a stage's job is, when it is fussy about it. A trade needs a yard. */
const PREFERRED_JOB: Partial<Record<LifeStage, PlotKind>> = { tradesperson: "work" };

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

  // Who is aboard which train. Built from the rail sim's own boarded/alighted
  // TAGS, so this is a view of the sim's ledger rather than a second one —
  // there used to be a shadow queue here, and a rider kept a seat the sim had
  // already freed.
  const riders = new Map<string, string[]>(); // train id → citizen ids aboard

  let clock = 0;
  // How far into the first day t=0 sits. See `startHour`.
  const dayOffsetSec = (tuning.startHour / 24) * tuning.secPerDay;
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

  // How somebody travels, given who they are. Only three stages bend it, and
  // each for a concrete reason rather than for flavour.
  function makeProfile(stage: LifeStage): TravelProfile {
    const roll = profileRng();
    const patience = 1.5 + profileRng() * 2.5;
    const transit = 0.7 + profileRng() * 0.7;
    const car = 0.7 + profileRng() * 0.7;
    // A tradesperson has the VAN — it is the job, not a preference, so they
    // always have it and it always wins (a low `carAffinity` is "driving feels
    // cheap to me"). A child never drives. The retired own fewer cars and walk
    // shorter distances.
    const carOwner =
      stage === "tradesperson"
        ? true
        : stage === "child"
          ? false
          : roll < tuning.carOwnership * (stage === "retired" ? 0.6 : 1);
    return {
      carOwner,
      walkPatience: stage === "retired" ? patience * 0.7 : patience,
      transitAffinity: transit,
      carAffinity: stage === "tradesperson" ? car * 0.6 : car,
    };
  }

  // Which life this resident gets. A weighted pick over `stageMix`, drawn from
  // the habit stream so adding a person never shifts anybody's travel profile.
  function pickStage(): LifeStage {
    let total = 0;
    for (const s of LIFE_STAGES) total += Math.max(0, tuning.stageMix[s] ?? 0);
    if (total <= 0) return "worker";
    let roll = habitRng() * total;
    for (const s of LIFE_STAGES) {
      roll -= Math.max(0, tuning.stageMix[s] ?? 0);
      if (roll <= 0) return s;
    }
    return "worker";
  }

  // Nearest workplace with a free job, chosen from the nearest few rather than
  // strictly the closest — which is what puts some people on a long commute,
  // and long commutes are what make a railway worth building.
  function assignJob(homeId: string, stage: LifeStage): string | null {
    if (!EMPLOYED.has(stage)) return null;
    const home = plotById.get(homeId);
    if (!home) return null;
    const prefer = PREFERRED_JOB[stage];
    const hiring = (pool: PlotState[]) =>
      pool
        .filter(p => p.people < p.capacity)
        .map(p => ({ p, d: manhattan(home, plotById.get(p.id) as WorldPlot) }))
        .sort((a, b) => a.d - b.d);
    // A preference, not a requirement: a board with no industrial yard still
    // employs its tradespeople rather than leaving them idle at home.
    const open = prefer
      ? (() => {
          const pick = hiring(allJobPlots.filter(p => p.kind === prefer));
          return pick.length ? pick : hiring(allJobPlots);
        })()
      : hiring(allJobPlots);
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
    const stage = pickStage();
    const c: Citizen = {
      id: `c${nextId++}`,
      home: homeId,
      work: assignJob(homeId, stage),
      profile: makeProfile(stage),
      mood: 0.6,
      at: homeId,
      trip: null,
      stage,
      routine: makeRoutine(stage, habitRng),
      parkedCar: null,
      unhappyDays: 0,
      stuckUntil: 0,
      recent: [],
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
    // Leave no ghost aboard a train. (A ghost left in the sim's platform queue
    // is harmless: it is anonymous demand from that moment on, and the platform
    // cap still bounds it.)
    for (const list of riders.values()) {
      const i = list.indexOf(c.id);
      if (i >= 0) list.splice(i, 1);
    }
    // Somebody who leaves town mid-journey does not leave a ghost behind.
    if (c.trip?.carTrip) driving?.release(c.trip.carTrip);
    if (c.trip?.walkTrip) walking?.release(c.trip.walkTrip);
    // ...nor a car parked outside the works for ever. A held bay whose owner has
    // emigrated is a space that can never be used again, and on a board people
    // are leaving that is one lost space per lost commuter.
    sendCarAway(c, plotOf(c.home)?.roadTile ?? null);
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

  // The best pair of platforms for this journey: the shortest walk at each end
  // among the pairs a SERVICE actually connects.
  //
  // Not simply "nearest to home, nearest to work". A town can sit between two
  // railways, and then the nearest platform at one end and the nearest at the
  // other are on lines that never meet — a journey that cannot be made, from a
  // pair that was never asked whether it could be. Choosing by connectivity is
  // what stops a perfectly good railway looking useless to the people beside it.
  function railPairFor(
    from: WorldPlot,
    to: WorldPlot
  ): { board: string; alight: string; access: number; egress: number } | null {
    if (!transit) return null;
    let best: { board: string; alight: string; access: number; egress: number } | null =
      null;
    for (const board of from.stationsInReach) {
      const access = walkToStation(from, board) / tuning.walkSpeed;
      for (const alight of to.stationsInReach) {
        if (board === alight) continue;
        if (!transit.connects(board, alight)) continue;
        const egress = walkToStation(to, alight) / tuning.walkSpeed;
        if (!best || access + egress < best.access + best.egress) {
          best = { board, alight, access, egress };
        }
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

  // Quote EVERY mode, including the ones that are not on offer and why.
  //
  // One function, two callers: `chooseMode` (which drops the unavailable ones
  // and takes the cheapest `cost`) and `quote()` (which hands the whole list to
  // the inspector panel). Deliberately not two — a panel that re-derives "what
  // this person would have done" drifts from the decision the moment either
  // side is touched, and then it is worse than no panel, because it is
  // confidently wrong. What the player reads IS what the model compared.
  //
  // The four modes are always considered in the same order, so a panel can
  // render them in a stable layout whatever the map does.
  function quoteModes(c: Citizen, fromId: string, toId: string): ModeQuote[] {
    const from = plotOf(fromId);
    const to = plotOf(toId);
    if (!from || !to) return [];
    const d = manhattan(from, to);
    const out: ModeQuote[] = [];

    // The two numbers every quote carries:
    //  · `sec` — the honest door-to-door estimate. What a stopwatch would say.
    //  · `cost` — what this person's habits make it FEEL like. What decides.
    // They differ by exactly the preferences, which is the whole point of
    // showing both: a car winning on `cost` while losing on `sec` is a person
    // choosing badly, and that is a fact about the town worth seeing.
    const offer = (mode: TravelMode, sec: number, cost: number, station: string | null) =>
      out.push({
        mode,
        estimateSec: sec,
        cost,
        station,
        toStation: null,
        approachSec: sec,
        chosen: false,
      });
    const refuse = (mode: TravelMode, why: ModeRefusal) =>
      out.push({
        mode,
        estimateSec: Infinity,
        cost: Infinity,
        station: null,
        toStation: null,
        approachSec: 0,
        chosen: false,
        unavailable: why,
      });

    // WALK. Available to anyone for any distance up to the hard maximum. Past
    // their own patience it is priced as the slog it is, so a car or a train
    // wins as soon as one is on offer — but it stays possible, because in a
    // real town a short walk is never impossible.
    // Door to door, not centre to centre. The two end legs are most of a short
    // journey and the panel used to pretend they did not exist. Walked at
    // walking pace whichever mode is taken — you walk to your car as well.
    const accessSec = tuning.walkAccessTiles / tuning.walkSpeed;
    const walkSec = d / tuning.walkSpeed + accessSec;
    if (d <= tuning.walkMaxTiles) {
      const slog = 1 + Math.max(0, d - c.profile.walkPatience) * tuning.walkImpatience;
      offer("walk", walkSec, walkSec * slog, null);
    } else refuse("walk", "too-far");

    // CAR. Needs ONE road network reaching both ends. Two towns with their own
    // streets and nothing between them cannot be driven between, and that is
    // what makes the railway the answer rather than a nicety.
    const driveSec =
      (d * tuning.roadDetour) / tuning.carSpeed + tuning.parkPenaltySec + accessSec;
    if (!c.profile.carOwner) refuse("car", "no-car");
    else if (from.roadComponent === null || from.roadComponent !== to.roadComponent)
      refuse("car", "no-road-link");
    else offer("car", driveSec, driveSec * c.profile.carAffinity, null);

    const board = transit ? nearestStation(from) : null;
    const alight = transit ? nearestStation(to) : null;

    // TRANSIT. The assumed headway is in here because a rider comparing modes
    // does not know the timetable — they know roughly how often trains come.
    // The PAIR is chosen by connectivity, not "nearest at each end": a town can
    // sit between two railways, and then the nearest platform at one end and the
    // nearest at the other are on lines that never meet — a journey that cannot
    // be made, offered by a pair nobody asked whether it could be.
    const pair = transit ? railPairFor(from, to) : null;
    if (!transit) refuse("transit", "no-railway");
    else if (!board || !alight) refuse("transit", "no-station-in-reach");
    else if (board === alight) refuse("transit", "same-station");
    else if (!pair) refuse("transit", "no-service");
    else {
      const ride =
        manhattan(
          stationCoord.get(pair.board) as { x: number; y: number },
          stationCoord.get(pair.alight) as { x: number; y: number }
        ) / tuning.trainSpeed;
      const sec = pair.access + tuning.assumedHeadwaySec + ride + pair.egress;
      out.push({
        mode: "transit",
        estimateSec: sec,
        cost: sec * c.profile.transitAffinity,
        station: pair.board,
        toStation: pair.alight,
        approachSec: pair.access,
        chosen: false,
      });
    }

    // PARK & RIDE. Drive to a station that has parking, ride in, walk out.
    // Only worth offering when the destination end is served by rail.
    const pr = transit && c.profile.carOwner ? nearestParkAndRide(from) : null;
    if (!transit || !alight) refuse("parkAndRide", "no-railway");
    else if (!c.profile.carOwner) refuse("parkAndRide", "no-car");
    else if (from.roadComponent === null || !pr) refuse("parkAndRide", "no-park-and-ride");
    else if (pr.station === alight) refuse("parkAndRide", "same-station");
    else if (!transit.connects(pr.station, alight)) refuse("parkAndRide", "no-service");
    else {
      const prCoord = stationCoord.get(pr.station) as { x: number; y: number };
      const drive =
        (manhattan(from, prCoord) * tuning.roadDetour) / tuning.carSpeed +
        tuning.parkPenaltySec +
        accessSec;
      const egress = walkToStation(to, alight) / tuning.walkSpeed;
      const ride =
        manhattan(prCoord, stationCoord.get(alight) as { x: number; y: number }) /
        tuning.trainSpeed;
      const sec = drive + tuning.assumedHeadwaySec + ride + egress;
      out.push({
        mode: "parkAndRide",
        estimateSec: sec,
        cost: sec * ((c.profile.transitAffinity + c.profile.carAffinity) / 2),
        station: pr.station,
        toStation: alight,
        approachSec: drive,
        chosen: false,
      });
    }

    return out;
  }

  // The quotes with the winner flagged — the panel's whole model, and the
  // decision itself, from one call.
  function quote(c: Citizen, fromId: string, toId: string): ModeQuote[] {
    const quotes = quoteModes(c, fromId, toId);
    const best = quotes.reduce<ModeQuote | null>(
      (a, b) => (b.unavailable || (a && a.cost <= b.cost) ? a : b),
      null
    );
    if (best) best.chosen = true;
    return quotes;
  }

  function chooseMode(c: Citizen, fromId: string, toId: string): ModeQuote | null {
    return quote(c, fromId, toId).find(q => q.chosen) ?? null;
  }

  // --- trips -------------------------------------------------------------------

  function startTrip(c: Citizen, toId: string, purpose: TripPurpose): void {
    const topic = topicOf(purpose);
    const fromId = c.at;
    if (fromId === toId) return;
    const option = chooseMode(c, fromId, toId);
    const cityId = plotOf(c.home)?.city;
    if (!option) {
      // Refused: no way to make this journey at all. The single strongest
      // signal in the model, and it lands on `access`.
      tripsRefused += 1;
      // A refused journey still moves the car. Somebody who cannot get home
      // from work is standing next to the vehicle they drove there in, and
      // leaving it in the bay is how a board slowly turns every space into a
      // permanent obstacle — one per refused commute, and refusals are exactly
      // what happens on a network the player has not finished.
      //
      // Refused AT HOME is the case that needs no rescuing: the car is on its
      // own drive, where it is supposed to be, and shifting it would evict a
      // household from its own hardstanding for the crime of not being able to
      // get to work.
      if (c.parkedCar && c.parkedCar.at === fromId && c.parkedCar.at !== c.home) {
        sendCarAway(c, plotOf(toId)?.roadTile ?? plotOf(c.home)?.roadTile ?? null);
      }
      remember(c, {
        purpose,
        mode: null,
        actualSec: 0,
        expectedSec: 0,
        delta: -0.3,
        failed: "refused",
      });
      c.mood = clamp01(c.mood - 0.3);
      // It lands on `access` AND on the journey's own topic, because a commute
      // you cannot make is a bad commute, not merely a badly connected town.
      // Exactly what an abandoned trip costs: the two are the same failure at
      // different stages, and under D10 the failure moved from one to the other
      // (a person no longer trudges to a platform to wait for a train that was
      // never coming — they stay at home and think less of you). Charging less
      // for it quietly turned off the mode's whole loop: no railway, no
      // consequence, because the freed-up day went on cheerful errands instead.
      if (cityId) {
        feedTopic(cityId, topic, 0, FAILURE_WEIGHT);
        feedTopic(cityId, "access", 0, FAILURE_WEIGHT);
      }
      // A day lost to a journey they could not make is not a day of errands.
      c.stuckUntil = clock + tuning.secPerDay / 3;
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
      // The same door-to-kerb allowance as the quote. `refSpeed` is deliberately
      // slower than any single mode BECAUSE it is a door-to-door expectation,
      // but it was being applied to a centre-to-centre distance — so on a short
      // trip the yardstick was shorter than the walk anybody could physically
      // make. Still a straight line, still nothing to do with the network: a bad
      // network cannot grade itself.
      expectedSec: Math.max(4, (dist + tuning.walkAccessTiles) / tuning.refSpeed),
      leg: option.mode === "walk" ? "walking" : option.mode === "car" ? "driving" : option.mode === "parkAndRide" ? "driving" : "walking",
      legRemaining: option.approachSec,
      station: option.station,
      toStation: option.toStation,
      onPlatform: false,
      waitedSec: 0,
      transfers: 0,
      carTrip: null,
      carSec: 0,
      walkTrip: null,
      trainId: null,
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
      // THEIR OWN CAR IS ALREADY HERE. Somebody leaving work does not have a
      // second car materialise on the driveway — they walk to the one they left
      // outside this morning and drive it away. Same vehicle, same id, and the
      // bay it was holding is handed back to the next driver looking for one.
      const mine = c.parkedCar;
      const parkAtEnd =
        trip.mode === "car" && purpose === "home"
          ? { permit: c.home, searchTiles: tuning.homeParkTiles }
          : trip.mode === "car"
            ? {}
            : undefined;
      if (mine && mine.at === fromId && target && driving.resume(mine.tripId, target, parkAtEnd)) {
        trip.carTrip = mine.tripId;
        c.parkedCar = null;
      } else if (origin && target && origin !== target) {
        // WHO COMPETES FOR A SPACE, and it is not everybody.
        //  · Going to WORK or to the SHOPS: yes. That is the whole feature —
        //    a handful of bays at the gate against everyone who drove there.
        //  · Going HOME: yes, but to THEIR OWN DRIVE first. A house has off-street
        //    parking and now the board actually has it (`tiles/homeParking.ts`),
        //    so a resident arriving home takes their own hardstanding, which no
        //    passing driver could have taken from them. Only the overspill — the
        //    third car at a two-space drive, and every car at a block of flats —
        //    competes for public kerb, and it does so within a couple of tiles of
        //    home rather than across the whole town.
        //
        //    THIS IS THE FENCE THAT KEEPS THE OLD BUG OUT. Letting residents park
        //    anywhere at night, on a board where the only bays were the works'
        //    own forecourt, silently converted every space on the map into
        //    permanent resident parking: 12 of 12 held at 03:00 on
        //    `/test/workparking`, rising to the cap over four days, after which
        //    no commuter could park again. Two things stop that now and both are
        //    needed — most cars go somewhere PRIVATE, and the ones that cannot
        //    are looking `HOME_PARK_TILES` from their own front door rather than
        //    `PARK_SEARCH_TILES` from anywhere.
        //  · PARK & RIDE: no, it still pays the flat penalty. Its car is left at
        //    a station, and a HELD bay there needs the return half too — you come
        //    back to a different platform and have to reach the car you left at
        //    the first one.
        trip.carTrip = driving.request(origin, target, parkAtEnd);
      }
    }
    // Departing from where the car is by any OTHER means still moves the car:
    // left behind at a WORKPLACE it would hold a public bay somebody else needs
    // until the backstop dwell expired, and then drive to a stale address. Send
    // it after them.
    //
    // EXCEPT AT HOME, which is the whole point of a drive. A car parked at its
    // owner's own address is not squatting a space, it is standing where it
    // lives, and it stays there while they walk to the shops or take the train —
    // exactly as the real one on your own drive does. Without this exemption the
    // feature inverts itself: every resident who walked anywhere would send their
    // car driving off after them, so a town of pedestrians would empty its own
    // drives and fill its streets with cars going nowhere.
    if (
      c.parkedCar &&
      c.parkedCar.at === fromId &&
      c.parkedCar.at !== c.home &&
      trip.carTrip !== c.parkedCar.tripId
    ) {
      sendCarAway(c, plotOf(toId)?.roadTile ?? plotOf(c.home)?.roadTile ?? null);
    }
    // A walking leg becomes an ACTUAL PERSON on the pavement whenever a footway
    // route joins the two ends. The whole trip for a walk; the approach to the
    // platform for a rail journey.
    if (walking && trip.leg === "walking") {
      const target = trip.mode === "walk" ? toId : (trip.station ?? "");
      if (target) trip.walkTrip = walking.request(fromId, target);
    }
  }

  // Let a car go without its owner in it. Not a cosmetic tidy-up: a bay held by
  // a citizen who is never coming back is a space nobody can ever use again, and
  // one per lost commuter drains a car park over a run.
  function sendCarAway(c: Citizen, toTile: string | null): void {
    const mine = c.parkedCar;
    if (!mine) return;
    c.parkedCar = null;
    if (!driving) return;
    if (toTile && driving.resume(mine.tripId, toTile)) return;
    // Nowhere to send it, so it does not just get forgotten about — forgetting
    // the TRIP would leave the CAR parked, holding a space for ever.
    driving.abandon(mine.tripId);
  }

  function remember(c: Citizen, o: TripOutcome): void {
    c.recent.unshift(o);
    if (c.recent.length > RECENT_TRIPS) c.recent.length = RECENT_TRIPS;
  }

  function finishTrip(c: Citizen, ok: boolean): void {
    const t = c.trip;
    if (!t) return;
    c.trip = null;
    const cityId = plotOf(c.home)?.city;
    if (!ok) {
      tripsAbandoned += 1;
      remember(c, {
        purpose: t.purpose,
        mode: t.mode,
        actualSec: clock - t.startedAt,
        expectedSec: t.expectedSec,
        delta: -0.3,
        failed: "abandoned",
      });
      c.mood = clamp01(c.mood - 0.3);
      if (cityId) {
        feedTopic(cityId, t.topic, 0, FAILURE_WEIGHT);
        feedTopic(cityId, "access", 0, FAILURE_WEIGHT);
      }
      // They go home rather than vanish — an abandoned trip still ends somewhere.
      c.at = c.home;
      // And the car they left at the other end comes home too. Without this, an
      // abandoned journey strands a bay AND the person would ask for a second
      // car the next morning.
      if (c.parkedCar && c.parkedCar.at !== c.home) {
        sendCarAway(c, plotOf(c.home)?.roadTile ?? null);
      }
      return;
    }
    c.at = t.to;
    const actual = clock - t.startedAt;
    const ratio = actual / t.expectedSec;
    // Better than expected nudges up a little; much worse pulls down hard. A
    // good commute is normal, a bad one is an event.
    const delta = Math.max(-0.35, Math.min(0.12, 1.4 - ratio));
    remember(c, {
      purpose: t.purpose,
      mode: t.mode,
      actualSec: actual,
      expectedSec: t.expectedSec,
      delta,
      failed: null,
    });
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
    if (!t || !t.station || !t.toStation || !transit) return;
    if (t.onPlatform) return;
    // The platform may be full: they keep trying, and the time counts. They join
    // it under their OWN id, which is how the dwell events later say that THIS
    // person boarded and THIS person got off here.
    if (transit.enqueue(t.station, t.toStation, c.id)) t.onPlatform = true;
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
          const carTrip = t.carTrip;
          t.carSec += dt;
          const status = driving?.status(carTrip);
          // THE CAR FOUND A SPACE. The driving leg is over, but the journey is
          // not: they are in a bay, not at their desk. Where the bay is decides
          // what happens next, and that is the whole point of modelling it —
          // the space at the gate costs a few seconds, the one two streets away
          // costs a walk the driver never budgeted for.
          if (status === "parked") {
            const tileId = driving?.parkedAt(carTrip) ?? null;

            c.parkedCar = tileId ? { tripId: carTrip, at: t.to, tileId } : null;
            t.carTrip = null;
            t.leg = "parking";
            t.legRemaining = walkFromBaySec(tileId, t.to);
            // ...AND THEY GET OUT AND WALK IT. The bay-to-door leg was a pure
            // countdown: the cost was modelled and the person was not, so a car
            // park fed nobody into the building it served. On a board with
            // pavements they are now a figure on one, and the clock above stays
            // as the backstop for a board without.
            if (tileId) t.walkTrip = walking?.requestFromKerb(carTrip, t.to) ?? null;
            return;
          }
          if (status === "arrived") {
            driving?.release(carTrip);
            t.carTrip = null;
            // No bay was to be had anywhere near, so the car was retired at the
            // address — the driver "found something down the road". They still
            // pay for the hunt, because that is what circling a full street IS,
            // and it is the number a player can act on by building a car park.
            if (t.mode === "car" && driving?.wantedSpace(carTrip)) {
              t.leg = "parking";
              t.legRemaining = tuning.parkSearchSec;
              return;
            }
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
      case "parking": {
        // The last stretch on foot, from the space to the door — or the time
        // spent hunting for one that was never there. Either way it is the
        // journey, so it lands on the same stopwatch the citizen is judged by,
        // and a player who builds a car park at the gate can watch it shrink.
        //
        // When there IS a walker, the leg ends when they arrive, and the clock
        // runs alongside as the backstop — the same rule the `walking` leg
        // lives under, and for the same reason: a pavement deleted under
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
        arriveFromDrive(c, t);
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

  // From the bay to the door, in seconds. Measured from where the car ACTUALLY
  // stopped, which is the number the whole feature turns on: the space at the
  // gate is a few seconds and the one two streets away is most of a minute, and
  // nothing else in the model can tell the player those apart.
  //
  // The half-tile floor is the walk across the forecourt. A bay on the
  // workplace's own street is zero tiles away by coordinate and is still not
  // inside the building.
  function walkFromBaySec(tileId: string | null, toPlotId: string): number {
    if (!tileId) return tuning.parkPenaltySec;
    const bay = parseCoordId(tileId);
    const dest = parseCoordId(toPlotId);
    const tiles = Math.max(0.5, manhattan(bay, dest));
    return tiles / tuning.walkSpeed;
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

  // Giving up on a wait. The person stops counting themselves as waiting; the
  // entry they left in the rail sim's queue becomes anonymous demand from here
  // on, which the platform cap still bounds. (There is no shadow queue to prune
  // any more — that WAS the second ledger.)
  function leavePlatform(c: Citizen): void {
    const t = c.trip;
    if (!t?.station) return;
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
      // WHO the rail sim just moved — its own ledger, by name. This used to be
      // a shadow queue here plus a guess about who was carried where, and the
      // guess kept a rider in a seat the sim had already freed.
      const aboard = riders.get(e.trainId) ?? [];
      const off = new Set(e.alightedTags ?? []);
      const staying = aboard.filter(id => !off.has(id));
      for (const id of off) alightedAt(id, e.tileId);
      for (const id of e.boardedTags ?? []) {
        const c = people.get(id);
        if (!c?.trip) continue;
        c.trip.leg = "riding";
        c.trip.onPlatform = false;
        c.trip.trainId = e.trainId;
        staying.push(id);
      }
      riders.set(e.trainId, staying);
    }
  }

  // The rail sim set this person down here. Either it is where they were going —
  // and the walk from the platform is the last leg — or it is an INTERCHANGE and
  // the sim has already put them back on the platform to wait for the service
  // that finishes the job. Both are told apart by one question: is this the
  // station they asked for?
  //
  // Nothing is DECIDED here any more. The sim carries a passenger to the station
  // they named, changing trains where it has to (`sim/lineGraph.ts`), so this
  // layer only has to record what happened. It used to guess from station
  // geography — and its own comment admitted the cost, a through-rider holding a
  // seat the sim had already freed.
  function alightedAt(citizenId: string, stationId: string): void {
    const c = people.get(citizenId);
    const t = c?.trip;
    if (!c || !t) return; // vanished mid-ride
    if (stationId === t.toStation) {
      const dest = plotOf(t.to);
      t.leg = "egress";
      t.station = stationId;
      t.trainId = null;
      t.legRemaining = dest ? walkToStation(dest, stationId) / tuning.walkSpeed : 0;
      return;
    }
    // A CHANGE. They are back on a platform — the sim re-queued them itself, so
    // they are already waiting under their own id and this layer must not queue
    // them a second time.
    t.transfers += 1;
    t.station = stationId;
    t.trainId = null;
    t.onPlatform = true;
    t.leg = "waiting";
    if (t.transfers > tuning.maxTransfers) finishTrip(c, false);
  }

  // --- the day -----------------------------------------------------------------

  // The clock runs from `startHour`, so t=0 is the morning rather than midnight.
  // Everything downstream (`considerTrips`, the day roll-over, the HUD) reads
  // this one function, so the offset lands everywhere at once.
  function hourNow(): number {
    return (((clock + dayOffsetSec) % tuning.secPerDay) / tuning.secPerDay) * 24;
  }

  function considerTrips(c: Citizen): void {
    if (c.trip) return;
    if (clock < c.stuckUntil) return;
    const hour = hourNow();
    // Home for the night, whatever else the day did. The one activity nobody's
    // routine has to declare, and the backstop that makes every `windowH` above
    // safe to bound: miss your last trip home and this one still runs.
    if (hour >= 22 && c.at !== c.home) {
      startTrip(c, c.home, "home");
      return;
    }
    // The day, in order. The FIRST activity whose window is open, that has not
    // already run today and that starts from where this person actually is.
    for (let i = 0; i < c.routine.length; i++) {
      const a = c.routine[i];
      if (a.lastDay === dayIndex) continue;
      if (hour < a.hour || hour >= a.hour + a.windowH) continue;
      // Which days it runs. The ACTIVITY INDEX is in the hash on purpose: leave
      // it out and every one of a person's every-other-day activities lands on
      // the same days, so their other day is as empty as the board used to be.
      if (a.everyNDays > 1 && (dayIndex + hashId(c.id) + i) % a.everyNDays !== 0) continue;
      // Anchored activities wait for their starting point rather than being
      // skipped: a tradesperson late back to the yard still gets their
      // afternoon call-out when they arrive.
      if (a.from && resolveTarget(c, a.from, i) !== c.at) continue;
      // Marked done BEFORE the trip is attempted, exactly as `lastOutDay` was:
      // a journey that cannot be made is scored once, not re-refused every tick.
      a.lastDay = dayIndex;
      const to = resolveTarget(c, a.target, i);
      if (!to || to === c.at) continue; // nowhere to go, or already there
      startTrip(c, to, a.target);
      return;
    }
  }

  // --- where an activity actually sends somebody -------------------------------

  const plotsOfKind = (kind: PlotKind) => [...plots.values()].filter(p => p.kind === kind);
  const shopPlots = plotsOfKind("shop");
  const leisurePlots = plotsOfKind("leisure");
  const schoolPlots = plotsOfKind("school");
  // Somewhere a tradesperson might be called out TO: a workplace, a shop or a
  // house. Not a school or a café — those are destinations for the people who
  // use them, and a plumber at the primary school every other day reads as noise.
  const calloutPlots = [...plots.values()].filter(
    p => p.kind === "work" || p.kind === "shop" || p.kind === "home"
  );

  function nearestOf(c: Citizen, pool: PlotState[]): string | null {
    const home = plotOf(c.home);
    if (!home || pool.length === 0) return null;
    let best: string | null = null;
    let bestD = Infinity;
    for (const s of pool) {
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

  // Could this person plausibly get there at all? Not the mode choice — that is
  // `quoteModes`' job and it runs next — just enough to keep a call-out from
  // being drawn on the far side of an unbridged map twice a day, every day.
  function reachable(from: WorldPlot, to: WorldPlot): boolean {
    if (from.roadComponent !== null && from.roadComponent === to.roadComponent) return true;
    if (manhattan(from, to) <= tuning.walkMaxTiles) return true;
    return (
      from.stationsInReach.length > 0 &&
      to.stationsInReach.length > 0 &&
      !from.stationsInReach.every(s => to.stationsInReach.includes(s))
    );
  }

  /**
   * The job a tradesperson is sent to TODAY.
   *
   * Deterministic from (day, person, activity) rather than drawn: the same day
   * replayed sends the same van to the same address, and two call-outs on one
   * day are two different addresses. Another town is preferred where one is
   * reachable — the whole point of a trade is that it travels, and a van that
   * only ever crosses its own street is just a walk with extra steps.
   */
  function resolveCallout(c: Citizen, index: number): string | null {
    const home = plotOf(c.home);
    if (!home) return null;
    const open = calloutPlots.filter(p => p.id !== c.work && p.id !== c.home);
    if (open.length === 0) return null;
    const reach = open.filter(p => {
      const wp = plotOf(p.id);
      return wp ? reachable(home, wp) : false;
    });
    const pool = reach.length ? reach : open;
    const away = pool.filter(p => p.city !== home.city);
    const from = away.length ? away : pool;
    const pick = (dayIndex * 31 + hashId(c.id) * 7 + index) % from.length;
    return from[pick].id;
  }

  function resolveTarget(c: Citizen, target: TripPurpose, index: number): string | null {
    switch (target) {
      case "home":
        return c.home;
      case "work":
        return c.work;
      case "shop":
        return nearestOf(c, shopPlots);
      // A café falls back to the corner shop, so a board with no leisure plot
      // still gives its retired residents somewhere to be at ten in the morning.
      case "leisure":
        return nearestOf(c, leisurePlots.length ? leisurePlots : shopPlots);
      // No fallback, deliberately. A board with no school has no school run, and
      // sending children to the shops instead would hide that from the player.
      case "school":
        return nearestOf(c, schoolPlots);
      case "callout":
        return resolveCallout(c, index);
    }
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

    const day = Math.floor((clock + dayOffsetSec) / tuning.secPerDay);
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
    const byStage: Record<LifeStage, number> = {
      child: 0,
      worker: 0,
      shiftWorker: 0,
      tradesperson: 0,
      retired: 0,
    };
    let parkedNow = 0;
    let atHomeNow = 0;
    for (const c of people.values()) {
      population += 1;
      byStage[c.stage] += 1;
      if (c.trip) travelling += 1;
      if (c.trip?.carTrip) drivingNow += 1;
      if (c.trip?.walkTrip) walkingNow += 1;
      if (c.parkedCar) {
        parkedNow += 1;
        if (c.parkedCar.at === c.home) atHomeNow += 1;
      }
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
      carsParked: parkedNow,
      carsAtHome: atHomeNow,
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
      byStage,
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
    citizen: (id: string) => people.get(id) ?? null,
    citizensOf(plotId: string) {
      const out: Citizen[] = [];
      for (const c of people.values()) if (c.home === plotId || c.work === plotId) out.push(c);
      return out;
    },
    quoteFor(citizenId: string, fromId?: string, toId?: string) {
      const c = people.get(citizenId);
      if (!c) return null;
      // Default to the journey that defines them: home to work. Somebody with
      // no job has no commute to price, so the caller must name the ends.
      const a = fromId ?? c.home;
      const b = toId ?? c.work;
      if (!b || a === b) return null;
      return quote(c, a, b);
    },
    stats,
    now: () => clock,
    day: () => dayIndex,
    hour: hourNow,
    // How many CITIZENS are waiting here. Counted from the people themselves —
    // the rail sim's queue also holds anonymous demand, which is not a person
    // this layer knows anything about.
    waitingAt: (stationId: string) =>
      [...people.values()].filter(
        c => c.trip?.onPlatform && c.trip.station === stationId
      ).length,
  };
}
