// THE TRANSIT LAYER — lines, the people waiting for them, and the exchange when
// a vehicle calls.
//
// All of this used to be private to `createSimulation`, which was fine for as
// long as a "vehicle that carries passengers" meant a train. It does not any
// more: a bus is planned the same way (issue #90), and a journey that starts on
// a bus and finishes on a train is one journey, not two. Two copies of this,
// one per sim, would be the shadow-queue mistake again — the citizen layer's,
// which phase 9 spent a slice removing.
//
// So there is ONE of these, owned by `game.ts` and handed to both sims. What
// lives here is everything that does not care what kind of vehicle turns up:
//
//   · the LINE registry — a plan with an identity, outliving its vehicles (D11)
//   · the LINE GRAPH memo — "can a passenger get there on the services that
//     exist", which `lineGraph.ts` computes and this caches behind a version
//   · the QUEUES — who is waiting where, and where each of them asked to go
//   · the DEMAND schedule — who turns up, gated on being able to get somewhere
//   · the EXCHANGE — who gets off, who changes, who gets on
//
// What does NOT live here is movement: how a vehicle reaches the next stop is
// its own sim's business, and the two are completely different (metals and
// interlocking vs lanes and junctions).

import { LineGraph, LineStops, buildLineGraph } from "./lineGraph";

// A LINE: the plan, with an identity of its own. Vehicles are assigned to it —
// many, or none. `pinned` marks one the player drew deliberately rather than one
// inferred from assigning stops to a vehicle; an unpinned line is swept up when
// its last vehicle leaves, a pinned one stands empty for as long as the player
// wants it to.
export interface SimLine {
  id: string;
  name: string;
  stops: string[];
  pinned?: boolean;
}

// Someone standing at a stop: where they asked to go, and who they are to
// whoever put them there.
export interface Waiting {
  dest: string;
  tag?: string;
}

// Someone in a seat. `final` is where they asked to go; `off` is where THIS
// vehicle sets them down — the same stop when the line goes there, an
// interchange when it does not. `off` is decided at BOARDING time and never
// stored on a waiting passenger, so a player who redraws a line mid-journey
// cannot strand anyone holding a stale plan: the next boarding re-decides.
export interface Rider {
  final: string;
  off: string;
  // An opaque id the caller who queued this person gave them. The citizen layer
  // puts its citizen id here, so the town and the vehicles keep ONE ledger
  // instead of a shadow copy each guessing at the other's.
  tag?: string;
}

// How many people turn up at a stop, and how many it will hold.
export interface StopDemand {
  intervalSec: number;
  max: number;
  initial?: number;
}

// The name the station work used, kept so the tiles/ helpers that derive a
// schedule from the map read the same either way.
export type StationDemand = StopDemand;

// The result of a vehicle calling somewhere: what changed hands, in the shape a
// dwell event reports.
export interface Exchange {
  boarded: number;
  alighted: number;
  changing: number;
  boardedTags: string[];
  alightedTags: string[];
}

export interface ExchangeRequest {
  // Where the vehicle is standing.
  stopId: string;
  // The line it runs, or undefined for an unassigned vehicle.
  lineId?: string;
  // Its seats, and who is in them. MUTATED: the caller owns the array and this
  // writes the new manifest back into it.
  capacity: number;
  manifest: Rider[];
  // Set everyone down here whatever they asked for, and take nobody new. A
  // withdrawn vehicle's riders are better off at a stop than in a shed.
  dumpAll?: boolean;
  // Refuse to board anyone (a vehicle that carries no passengers at all, like a
  // goods train). Alighting still happens.
  noBoarding?: boolean;
}

// A vehicle with no line, as the GRAPH should see it: a stopper calls at every
// stop it passes, which makes it a service over everything it can reach. The
// owning sim knows what "can reach" means for its own vehicles; this layer only
// needs the answer.
export interface StopperService {
  id: string;
  stops: string[];
}

export interface TransitLayer {
  // --- lines ---------------------------------------------------------------
  lines(): SimLine[];
  line(lineId: string): SimLine | undefined;
  stopsOfLine(lineId: string | undefined): string[] | undefined;
  // Draw a line. An existing line with exactly these stops is reused (and
  // pinned when `pinned`).
  createLine(stops: string[], name?: string, pinned?: boolean): SimLine;
  setLineStops(lineId: string, stops: string[]): boolean;
  renameLine(lineId: string, name: string): boolean;
  deleteLine(lineId: string): boolean;
  // Drop a line nobody drew on purpose once its last vehicle has left it.
  pruneLine(lineId: string | undefined): void;
  // Every line's stops have changed shape, or a vehicle joined/left one: the
  // graph must be rebuilt. Cheap — it only clears the memo.
  touch(): void;

  // --- the network ---------------------------------------------------------
  network(): LineGraph;
  // Where a vehicle on `lineId` standing at `at` should set down someone bound
  // for `final`: their destination when the line goes there, the interchange
  // that gets them closest when it does not, and undefined when this vehicle is
  // no use to them at all.
  offFor(lineId: string | undefined, at: string, final: string): string | undefined;
  serves(from: string, to: string): boolean;
  servedFrom(stopId: string): string[];

  // --- who is waiting ------------------------------------------------------
  queue(stopId: string): Waiting[];
  queueLength(stopId: string): number;
  waiting(stopId: string): string[];
  // Queue ONE person who has already decided where they are going.
  enqueue(stopId: string, dest: string, tag?: string): boolean;
  // Anonymous demand: `count` people who will each be given a destination the
  // network can actually serve. Returns how many were queued.
  addPassengers(stopId: string, count: number): number;
  // Advance the spawn schedule.
  advanceDemand(dt: number): void;
  // Seed the opening crowd. Called once the vehicles exist, because with none
  // of them nothing is served and nobody would appear (D10).
  seed(): void;
  demandStops(): string[];
  // Register a stop that has a schedule, after construction (a bus stop the
  // player has only just connected).
  setDemand(stopId: string, demand: StopDemand): void;

  // --- the exchange --------------------------------------------------------
  exchange(req: ExchangeRequest): Exchange;
  delivered(): number;
  // Count arrivals that did not happen at a stop. The one caller is a matched
  // DEPOT arrival: "everyone home" ends every ride aboard and has always
  // counted them all, and a depot is not a place anyone can be re-queued at.
  deliver(count: number): void;

  // --- what the owning sims contribute -------------------------------------
  // The unassigned vehicles, as services over what they can reach. Set by each
  // sim; the graph asks for them whenever it rebuilds.
  setStoppers(source: string, stoppers: () => StopperService[]): void;
}

export interface TransitConfig {
  // Stops that have a schedule of their own, keyed by tile id.
  demand?: Record<string, StopDemand>;
  // The cap on a queue with no schedule of its own.
  hardCap?: number;
  // Is this tile a place a passenger can wait? Both sims contribute (a rail
  // platform, a bus stop), so the layer itself stays ignorant of tiles.
  isStop?: (tileId: string) => boolean;
  // Pairs of stops a passenger can WALK between — a bus stop and the platform
  // beside it. The intermodal edge (D5): without it a kerb and a platform are
  // separate islands however close they are drawn, and a bus→train journey
  // would be two unrelated journeys that nobody ever sets out on.
  walkLinks?: [string, string][];
}

export const DEFAULT_QUEUE_HARD_CAP = 16;

export function createTransit(config: TransitConfig = {}): TransitLayer {
  const demand: Record<string, StopDemand> = { ...(config.demand ?? {}) };
  const hardCap = config.hardCap ?? DEFAULT_QUEUE_HARD_CAP;
  const isStop = config.isStop ?? (() => true);

  const lines: Record<string, SimLine> = {};
  const lineOrder: string[] = [];
  let lineSeq = 0;

  const queues = new Map<string, Waiting[]>();
  const spawnClocks = new Map<string, number>();
  // Where the next person at each stop will ask to go. A cursor walked in order
  // rather than an RNG draw: destinations must be deterministic like everything
  // else in a sim, and a round robin also spreads demand evenly instead of
  // clumping the way random would.
  const destCursors = new Map<string, number>();
  let deliveredTotal = 0;

  const stopperSources = new Map<string, () => StopperService[]>();
  let graph: LineGraph | null = null;

  // stop -> the stops you can walk to from it, both ways.
  const walkTo = new Map<string, string[]>();
  for (const [a, b] of config.walkLinks ?? []) {
    walkTo.set(a, [...(walkTo.get(a) ?? []), b]);
    walkTo.set(b, [...(walkTo.get(b) ?? []), a]);
  }

  for (const id of Object.keys(demand)) {
    queues.set(id, []);
    spawnClocks.set(id, 0);
  }

  function touch(): void {
    graph = null;
  }

  function network(): LineGraph {
    if (graph) return graph;
    const spec: LineStops[] = lineOrder
      .map(id => lines[id])
      .filter(Boolean)
      .map(l => ({ id: l.id, stops: l.stops }));
    // The unassigned vehicles, as services over everything they can reach. This
    // is what keeps every board written before lines existed working under the
    // D10 spawn gate: where nobody has drawn anything, the stoppers ARE the
    // network. It affects the GRAPH only — a lineless vehicle still boards and
    // alights by its own sim's rule.
    for (const source of stopperSources.values()) {
      for (const s of source()) spec.push({ id: s.id, stops: s.stops });
    }
    // A walk is a connection like any other, so the graph gets it as a service
    // calling at both ends. Nothing ever RUNS it — no vehicle carries this id —
    // so it only ever affects what is reachable and where to change.
    for (const [a, list] of walkTo) {
      for (const b of list) {
        if (a < b) spec.push({ id: `walk:${a}|${b}`, stops: [a, b] });
      }
    }
    graph = buildLineGraph(spec);
    return graph;
  }

  function addLine(stops: string[], name?: string): SimLine {
    lineSeq += 1;
    const id = `line-${lineSeq}`;
    const line: SimLine = { id, name: name ?? `L${lineSeq}`, stops: [...stops] };
    lines[id] = line;
    lineOrder.push(id);
    touch();
    return line;
  }

  return {
    lines() {
      return lineOrder
        .map(id => lines[id])
        .filter(Boolean)
        .map(l => ({ ...l, stops: [...l.stops] }));
    },
    line(lineId: string) {
      return lines[lineId];
    },
    stopsOfLine(lineId: string | undefined) {
      return lineId ? lines[lineId]?.stops : undefined;
    },
    createLine(stops: string[], name?: string, pinned = false) {
      // Find-or-create by stop list. Two vehicles authored with the same stops,
      // or a player who draws the same route twice, mean the same SERVICE — not
      // two lines that happen to look alike.
      const key = stops.join(">");
      for (const id of lineOrder) {
        const line = lines[id];
        if (line && line.stops.join(">") === key) {
          if (pinned) line.pinned = true;
          if (name !== undefined) line.name = name;
          return line;
        }
      }
      const made = addLine(stops, name);
      if (pinned) made.pinned = true;
      return made;
    },
    setLineStops(lineId: string, stops: string[]) {
      const line = lines[lineId];
      if (!line) return false;
      line.stops = [...stops];
      touch();
      return true;
    },
    renameLine(lineId: string, name: string) {
      const line = lines[lineId];
      if (!line) return false;
      line.name = name;
      return true;
    },
    deleteLine(lineId: string) {
      if (!lines[lineId]) return false;
      delete lines[lineId];
      const at = lineOrder.indexOf(lineId);
      if (at >= 0) lineOrder.splice(at, 1);
      touch();
      return true;
    },
    // Sweep up a line nobody drew on purpose. The VEHICLES live in the sims,
    // not here, so only the caller knows whether anything is still running it —
    // it calls this having already checked. What this layer owns is the pinned
    // rule: a line the player drew deliberately is never swept.
    pruneLine(lineId: string | undefined) {
      if (!lineId) return;
      const line = lines[lineId];
      if (!line || line.pinned) return;
      delete lines[lineId];
      const at = lineOrder.indexOf(lineId);
      if (at >= 0) lineOrder.splice(at, 1);
      touch();
    },
    touch,
    network,
    offFor(lineId: string | undefined, at: string, final: string) {
      // An unassigned vehicle promises nothing beyond where it is going next,
      // so it takes anyone: its own sim decides where they come off.
      if (!lineId) return final;
      return network().alightFor(lineId, at, final);
    },
    serves(from: string, to: string) {
      return network().serves(from, to);
    },
    servedFrom(stopId: string) {
      return network().reachableFrom(stopId);
    },
    queue(stopId: string) {
      return queues.get(stopId) ?? [];
    },
    queueLength(stopId: string) {
      return queues.get(stopId)?.length ?? 0;
    },
    waiting(stopId: string) {
      return (queues.get(stopId) ?? []).map(w => w.dest);
    },
    enqueue(stopId: string, dest: string, tag?: string) {
      if (!isStop(stopId) || !isStop(dest) || dest === stopId) return false;
      const cap = demand[stopId]?.max ?? hardCap;
      const q = queues.get(stopId) ?? [];
      if (q.length >= cap) return false;
      q.push({ dest, ...(tag !== undefined ? { tag } : {}) });
      queues.set(stopId, q);
      return true;
    },
    addPassengers(stopId: string, count: number) {
      if (!isStop(stopId) || count <= 0) return 0;
      const cap = demand[stopId]?.max ?? hardCap;
      const q = queues.get(stopId) ?? [];
      const room = Math.max(0, Math.min(count, cap - q.length));
      let accepted = 0;
      for (let i = 0; i < room; i++) {
        // Like everyone else, they only set out if a service can take them
        // somewhere (D10). No service, no passenger, and the count says so.
        const dest = nextDestination(stopId);
        if (!dest) break;
        q.push({ dest });
        accepted += 1;
      }
      queues.set(stopId, q);
      return accepted;
    },
    advanceDemand(dt: number) {
      for (const [id, d] of Object.entries(demand)) {
        let clock = (spawnClocks.get(id) ?? 0) + dt;
        const q = queues.get(id) ?? [];
        while (clock >= d.intervalSec) {
          clock -= d.intervalSec;
          if (q.length < d.max) {
            const dest = nextDestination(id);
            if (dest) q.push({ dest });
          }
        }
        spawnClocks.set(id, clock);
        queues.set(id, q);
      }
    },
    seed() {
      for (const [id, d] of Object.entries(demand)) {
        const n = Math.min(d.initial ?? 0, d.max);
        const start: Waiting[] = [];
        for (let i = 0; i < n; i++) {
          const dest = nextDestination(id);
          if (dest) start.push({ dest });
        }
        queues.set(id, start);
      }
    },
    demandStops() {
      return Object.keys(demand);
    },
    setDemand(stopId: string, d: StopDemand) {
      demand[stopId] = d;
      if (!queues.has(stopId)) queues.set(stopId, []);
      if (!spawnClocks.has(stopId)) spawnClocks.set(stopId, 0);
    },
    exchange(req: ExchangeRequest): Exchange {
      const { stopId, lineId, capacity, manifest } = req;
      const staying: Rider[] = [];
      // Each with WHERE they will wait: here, or the far end of a walk.
      const changing: (Waiting & { at: string })[] = [];
      const alightedTags: string[] = [];
      const boardedTags: string[] = [];
      let alighted = 0;

      for (const rider of manifest) {
        if (!req.dumpAll && rider.off !== stopId) {
          staying.push(rider);
          continue;
        }
        alighted += 1;
        if (rider.tag !== undefined) alightedTags.push(rider.tag);
        // A DELIVERY is arriving where you asked for, and nowhere else (D9):
        // counting a change as an arrival would score one person two or three
        // times and quietly inflate every objective built on the number.
        if (rider.final === stopId) deliveredTotal += 1;
        else {
          changing.push({
            dest: rider.final,
            ...(rider.tag !== undefined ? { tag: rider.tag } : {}),
            // WHERE they wait for the onward service. Normally right here — but
            // if the next step of their journey is a WALK (off the bus, across
            // to the platform), they take it now and wait at the far end. Left
            // standing at the kerb they would wait for ever for a train that
            // does not call there, which is the whole reason the walk exists.
            at: walkOnward(stopId, rider.final),
          });
        }
      }
      manifest.length = 0;
      manifest.push(...staying);

      const q = queues.get(stopId) ?? [];
      // A CHANGE goes back onto the platform, at the FRONT and past the cap
      // (D8). They have waited once already, and deleting someone mid-journey
      // because a queue is full would be a loss the player cannot see happen.
      // Whoever walked on waits at the far end instead.
      for (const c of changing) {
        const { at, ...w } = c;
        if (at === stopId) q.unshift(w);
        else queues.set(at, [w, ...(queues.get(at) ?? [])]);
      }

      let boarded = 0;
      if (req.noBoarding || req.dumpAll) {
        queues.set(stopId, q);
      } else {
        const left: Waiting[] = [];
        for (const w of q) {
          if (manifest.length >= capacity) {
            left.push(w);
            continue;
          }
          // Ask the NETWORK, not just this line's stop list: a rider bound for
          // somewhere this line does not reach still boards if it can hand them
          // on at an interchange. Without that, two lines that meet carry
          // nobody between them.
          const off = lineId ? network().alightFor(lineId, stopId, w.dest) : w.dest;
          if (off === undefined) left.push(w);
          else {
            manifest.push({
              final: w.dest,
              off,
              ...(w.tag !== undefined ? { tag: w.tag } : {}),
            });
            if (w.tag !== undefined) boardedTags.push(w.tag);
            boarded += 1;
          }
        }
        queues.set(stopId, left);
      }

      return { boarded, alighted, changing: changing.length, boardedTags, alightedTags };
    },
    delivered() {
      return deliveredTotal;
    },
    deliver(count: number) {
      deliveredTotal += Math.max(0, count);
    },
    setStoppers(source: string, stoppers: () => StopperService[]) {
      stopperSources.set(source, stoppers);
      touch();
    },
  };

  // The next destination for someone starting at `id`, or null when no service
  // connects this stop to anywhere. The list the cursor indexes into changes as
  // lines are drawn, which moves who gets picked next — still deterministic for
  // a given sequence of player actions, which is what replayability needs.
  // If the next step from `at` toward `final` is a WALK, the far end of it;
  // otherwise `at` itself. Strictly closer, like every other hop — a walk that
  // does not get you closer is not a step, it is a stroll.
  function walkOnward(at: string, final: string): string {
    const g = network();
    const here = g.hops(at, final);
    if (here === undefined) return at;
    let best = at;
    let bestDist = here;
    for (const n of walkTo.get(at) ?? []) {
      const d = n === final ? 0 : g.hops(n, final);
      if (d === undefined || d >= bestDist) continue;
      bestDist = d;
      best = n;
    }
    return best;
  }

  function nextDestination(id: string): string | null {
    // Only a real STOP is somewhere to ask for. A line's stop list is the
    // player's, and nothing stops it naming a tile that is not a stop at all —
    // the graph will happily carry that as a node, and then people queue for a
    // patch of road nobody can wait at.
    const choices = network().reachableFrom(id).filter(isStop);
    if (choices.length === 0) return null;
    const at = destCursors.get(id) ?? 0;
    destCursors.set(id, at + 1);
    return choices[at % choices.length];
  }
}
