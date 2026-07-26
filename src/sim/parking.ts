// The parking REGISTRY: who owns which stall, which car parks are full, and
// where a car must drive to reach a free space.
//
// The tile data (`tiles/parking.ts`) says where stalls ARE; this says which are
// TAKEN. Keeping the two apart is what lets the level stay a plain, serialisable
// description while occupancy is live, per-run state the sim owns — the same
// split as `TileCell.connections` (data) vs the simulation's reservations.
//
// Everything here is deterministic: stalls are visited in a stable order and any
// choice takes an explicit seeded RNG, so a replayed seed parks the same cars in
// the same bays.

import type { Level } from "@/tiles/model";
import {
  type ParkingFacility,
  type ParkingRow,
  type StallRef,
  facilitiesOf,
  manoeuvrePath,
  manoeuvreStartT,
  type ManoeuvrePath,
  kerbOffsetAt,
  rowFor,
  rowSide,
  stallId,
  stallPose,
  stallIsHidden,
  stallOnLane,
  stallLengthPx,
  garageExitPath,
  garageExitEndT,
  garageExitFrom,
} from "@/tiles/parking";
import { parseCoordId } from "@/tiles/model";
import { specLength, vehicleSpec, type VehicleKind } from "./road";

// --- Who fits where ----------------------------------------------------------

// Vehicles that may park at all. A SEMI never does: it is two articulated body
// segments, and a bay is one box — an articulated lorry belongs in a lay-by, not
// a shopper's car park. Excluding it here rather than in the geometry keeps the
// rule where a reader looks for it.
export function vehicleCanPark(kind: VehicleKind): boolean {
  return kind !== "semi";
}

// WHO a bay is for. Deliberately not "how big is it": a lorry lay-by and a
// delivery bay are the same size and serve different traffic, and a bus stop is
// for coaches only however much room a lorry would have had. Size is a
// CONSEQUENCE of the class (see `needsBigBay`); admission is the rule.
export type BayClass = "car" | "lorry" | "bus" | "delivery" | "permit";

export function bayClassOf(row: ParkingRow): BayClass {
  // A GARAGE is a car park whatever its capacity: an underground one has a height
  // barrier, and a lorry or a coach does not go down the ramp. Its slots are not
  // on the map, so nothing about its geometry would ever have said so.
  if (row.kind === "garage") return "car";
  // A halt on the carriageway is a bus stop by its own shape — it needs no
  // `reserved` flag to say so, and authoring one would just be a second spelling.
  if (row.kind === "busstop") return "bus";
  switch (row.reserved) {
    case "long":
      return "lorry";
    case "bus":
      return "bus";
    case "delivery":
      return "delivery";
    case "disabled":
      return "permit";
    default:
      return "car";
  }
}

// May a vehicle of `kind` use a bay of class `cls`?
//
// One table, exhaustive on purpose: adding a bay class without deciding who may
// use it should not compile, because the failure mode is silent — a bay nobody
// can use looks exactly like a bay nobody happens to have taken yet.
export function bayAdmits(kind: VehicleKind, cls: BayClass): boolean {
  switch (cls) {
    case "car":
      return kind === "car";
    // A lay-by serves both the lorries and the coaches; that is what a lay-by IS.
    case "lorry":
      return kind === "truck" || kind === "bus";
    case "bus":
      return kind === "bus";
    // A loading bay is for the delivery lorry, not for the coach that would also
    // fit in it.
    case "delivery":
      return kind === "truck";
    // Nothing issues a disabled permit yet, so these stay empty — which is what
    // makes a car park look like a real one rather than 100% usable.
    case "permit":
      return false;
  }
}

// Can a vehicle of `kind` use a stall in `row`?
//
// TWO gates, and both are needed.
//
// CLASS first: a bay serves exactly one class of vehicle. Geometry alone let a car
// take a lorry bay (it fits, with room to spare), a coach take an ordinary kerb
// space (a bus is 55px, a parallel bay 60px) and a lorry drive down a garage ramp
// — all measured, all wrong, and all invisible to every other check in the sim.
//
// SIZE second, as the backstop that keeps the two honest: an admission flag that
// let a vehicle in without the bay actually being big enough is how a 92px semi
// ends up centred in a 60px bay, lying across the two spaces either side of it,
// which the registry then hands to two more cars. Nothing downstream would catch
// that either — the swept-overlap check only compares bodies within 0.7 lanes of
// each other, and a bay is by construction further out than that.
//
// A DISABLED bay stays empty: nothing issues a permit yet, so ordinary traffic
// keeps out and the bay reads as the real thing — a car park is never 100%
// usable. Deliberate, not an oversight.
export function stallFits(
  kind: VehicleKind,
  row: ParkingRow,
  carLength: number,
  tileSize = 200,
): boolean {
  if (!vehicleCanPark(kind)) return false;
  if (!bayAdmits(kind, bayClassOf(row))) return false;
  const bodyPx = specLength(vehicleSpec(kind, carLength)) * tileSize;
  // 2% margin so a body that exactly fills its bay still reads as parked rather
  // than as bursting out of it.
  return bodyPx <= stallLengthPx(row, tileSize) * 0.98;
}

// A small, stable string hash. Used to scatter a car's choice of parking space
// without spending a random draw — see `pickStallOn`. FNV-1a: cheap, and it
// avalanches well enough that consecutive car ids ("car31", "car32") do not land
// on neighbouring bays, which is the whole point.
function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0);
}

// One vehicle of every class that can park, for the "could ANYONE use this?"
// question `capacity`/`freeCount` ask when no kind is named. Listing them beats
// hard-coding a car: a lay-by of two lorry bays would otherwise report nought
// capacity and its sign would read VOLL beside two empty spaces.
const CAPACITY_PROBES: VehicleKind[] = ["car", "truck", "bus"];

// --- The registry ------------------------------------------------------------

export interface StallInfo {
  ref: StallRef;
  row: ParkingRow;
  facilityId: string;
  hidden: boolean; // a garage slot: the car is inside a building, not drawn
  // A halt ON the carriageway rather than a bay off it. The vehicle never leaves
  // its lane, so it keeps its road body and the traffic behind it queues.
  onLane: boolean;
  // Where on the approach a car draws level with this stall (0..1 along the tile).
  t: number;
}

export interface ParkingRegistry {
  facilities(): ParkingFacility[];
  facility(id: string): ParkingFacility | undefined;
  // Every facility that still has a stall this vehicle kind could take. The
  // router picks from these, so a full car park is avoided BEFORE a car sets off
  // rather than discovered on arrival.
  openFacilities(kind: VehicleKind): ParkingFacility[];
  capacity(facilityId: string, kind?: VehicleKind): number;
  freeCount(facilityId: string, kind?: VehicleKind): number;
  info(ref: StallRef): StallInfo | undefined;
  // Take a stall for `carId`. False when someone got there first — the caller
  // then keeps driving, which is exactly what a real driver does.
  claim(ref: StallRef, carId: string): boolean;
  release(ref: StallRef): void;
  // A free stall on `tileId` for a vehicle of `kind` entering through `from`, or
  // null if there is none it can use.
  //
  // NOT simply the nearest one. Drivers do not all take the first space they pass
  // — they take one that suits them — and always picking the lowest index packs a
  // car park solid from one end while the rest of it stands empty, which is the
  // one thing a real car park never looks like. The choice is scattered by a hash
  // of `carId`: deterministic (a seed replays exactly), spread out, and costing no
  // RNG draw — which matters, because a draw made here would couple the parking
  // random stream to traffic state, and every seeded run in the repo would then
  // shift the next time anyone touched the following model.
  //
  // `minT` filters out bays the car has already driven past on this tile; it can
  // never reach one behind it (`atStallEntry` only ever fires forwards).
  pickStallOn(
    tileId: string,
    from: number,
    kind: VehicleKind,
    carId: string,
    minT?: number,
  ): StallRef | null;
  // The manoeuvre curve for a stall, in TILE units (size 1). `laneOff` is the
  // car's lateral lane offset in tile units; `tStart` anchors the curve at the
  // car's real position so the sprite does not jump when the swing begins.
  pathFor(ref: StallRef, laneOff: number, tStart?: number): ManoeuvrePath | null;
  // Where along its approach a car peels off toward `ref` (0..1 of the tile).
  startTOf(ref: StallRef): number;
  // The FORWARD curve out of a garage, plus where on the road it ends and which
  // approach that is. Null for a rank of bays — those reverse out along the curve
  // they came in on, which is what a driver actually does.
  exitFor(
    ref: StallRef,
    laneOff: number,
  ): { path: ManoeuvrePath; endT: number; from: number } | null;
  // Everything the renderer needs to draw the parked fleet + a debug overlay:
  // stall id -> occupant car id.
  occupancy(): Record<string, string>;
  // Is any part of this level a car park at all? Lets every caller skip the whole
  // subsystem (and its RNG draws) on the maps that have none — which is all of
  // them until a level opts in, keeping every existing seeded run byte-identical.
  any(): boolean;

  // --- Aim tokens: reservation at PLAN time -----------------------------------
  // A car claims a specific stall only when it reaches the tile the stall is on —
  // that keeps stall choice deterministic and race-free. But between setting off
  // and arriving, nothing would stop ten cars all planning for the same two free
  // spaces: eight of them would drive the length of the car park, find it full,
  // and have to turn round, which is a traffic jam rather than a feature.
  //
  // So a car takes a facility-level TOKEN when it plans. `availableFor` counts
  // free stalls MINUS outstanding tokens, and that is what the router reads — so
  // a car park that is spoken for is avoided exactly as one that is physically
  // full. The token is released when the car claims a real stall, gives up, or
  // leaves the map.
  aim(facilityId: string, carId: string): void;
  unaim(carId: string): void;
  availableFor(facilityId: string, kind: VehicleKind): number;
  aimedAt(facilityId: string): number;

  // The dwell range this facility's cars draw from, in seconds. Authored per
  // facility so a kerbside bay can churn while a garage sits.
  dwellOf(facilityId: string): [number, number] | undefined;
}

export function createParkingRegistry(
  level: Level,
  // The sim's base car body length in TILES — the same number `createRoadSim`
  // sizes its vehicles from. Passed in rather than assumed so the fit gate
  // measures the bodies this sim actually builds.
  carLength: number,
  tileSize = 200,
): ParkingRegistry {
  const facilities = facilitiesOf(level);
  const byId = new Map(facilities.map(f => [f.id, f]));

  // Stall metadata, resolved once. The level is static for a run (live edits go
  // through game.applyEdits, which rebuilds the sims), so this never goes stale.
  const infos = new Map<string, StallInfo>();
  for (const f of facilities) {
    for (const ref of f.stalls) {
      const cell = level[ref.tileId];
      const row = rowFor(cell, ref);
      if (!row) continue;
      const pose = stallPose(row, ref.index, 1, 0); // t only — kerb irrelevant to it
      infos.set(stallId(ref), {
        ref,
        row,
        facilityId: f.id,
        hidden: stallIsHidden(row.kind),
        onLane: stallOnLane(row.kind),
        t: pose.t,
      });
    }
  }

  // stall id -> car id. The single source of "this bay is taken".
  const occupants = new Map<string, string>();
  // Memoised manoeuvre curves, keyed by stall + the lane offset it was built for
  // (a two-lane approach and a four-lane one peel off from different places).
  const paths = new Map<string, ManoeuvrePath>();
  // car id -> the facility it is currently heading for (its aim token).
  const aims = new Map<string, string>();
  // Authored dwell per facility, taken from the first tile (in sorted order) that
  // sets one — the same first-wins rule as the facility's label.
  const dwells = new Map<string, [number, number]>();
  for (const f of facilities) {
    for (const tileId of [...f.tileIds].sort()) {
      const d = level[tileId]?.parking?.dwellSec;
      if (d) {
        dwells.set(f.id, d);
        break;
      }
    }
  }

  function infoOf(ref: StallRef): StallInfo | undefined {
    return infos.get(stallId(ref));
  }

  function fitsKind(ref: StallRef, kind: VehicleKind | undefined): boolean {
    const info = infoOf(ref);
    if (!info) return false;
    // With no kind named the question is "could ANY vehicle use this?" — which a
    // permit-only bay answers no, and a LORRY bay answers yes. Asking only about a
    // car would report a lay-by of two lorry bays as a nought-capacity car park,
    // and its sign would read VOLL while both spaces stood empty. The router never
    // takes this branch: it always names the kind it is routing (`availableFor`),
    // so a car is still never sent to a car park that only has lorry space.
    if (kind === undefined) {
      return CAPACITY_PROBES.some(k => stallFits(k, info.row, carLength, tileSize));
    }
    return stallFits(kind, info.row, carLength, tileSize);
  }

  function count(facilityId: string, kind: VehicleKind | undefined, freeOnly: boolean): number {
    const f = byId.get(facilityId);
    if (!f) return 0;
    let n = 0;
    for (const ref of f.stalls) {
      if (!fitsKind(ref, kind)) continue;
      if (freeOnly && occupants.has(stallId(ref))) continue;
      n++;
    }
    return n;
  }

  return {
    facilities: () => facilities,
    facility: id => byId.get(id),
    any: () => facilities.length > 0,

    openFacilities(kind) {
      // "Open" means a space that is free AND not already spoken for — the whole
      // point of the aim token. A car park with two spaces and two cars on their
      // way to it is full as far as a third driver is concerned.
      return facilities.filter(f => this.availableFor(f.id, kind) > 0);
    },

    capacity: (facilityId, kind) => count(facilityId, kind, false),
    freeCount: (facilityId, kind) => count(facilityId, kind, true),

    info: infoOf,

    claim(ref, carId) {
      const key = stallId(ref);
      if (!infos.has(key) || occupants.has(key)) return false;
      occupants.set(key, carId);
      // The car has a real space now; its facility token has done its job.
      aims.delete(carId);
      return true;
    },

    aim(facilityId, carId) {
      aims.set(carId, facilityId);
    },
    unaim(carId) {
      aims.delete(carId);
    },
    aimedAt(facilityId) {
      let n = 0;
      for (const target of aims.values()) if (target === facilityId) n++;
      return n;
    },
    availableFor(facilityId, kind) {
      return Math.max(0, count(facilityId, kind, true) - this.aimedAt(facilityId));
    },
    dwellOf(facilityId) {
      return dwells.get(facilityId);
    },

    release(ref) {
      occupants.delete(stallId(ref));
    },


    pickStallOn(tileId, from, kind, carId, minT = 0) {
      const cell = level[tileId];
      if (!cell?.parking?.rows?.length) return null;
      const free: StallRef[] = [];
      for (const row of cell.parking.rows) {
        if (row.from !== from || row.count <= 0) continue;
        const side = rowSide(row);
        if (!stallFits(kind, row, carLength, tileSize)) continue;
        for (let i = 0; i < row.count; i++) {
          const ref: StallRef = { tileId, from: row.from, side, index: i };
          if (occupants.has(stallId(ref))) continue;
          const info = infoOf(ref);
          if (!info) continue;
          // Only bays still AHEAD: `t` grows along the direction of travel, and a
          // car cannot turn into a space it has already gone past.
          if (info.t < minT) continue;
          free.push(ref);
        }
      }
      if (free.length === 0) return null;
      // Deterministic scatter. `free` is built in a fixed order (rows as authored,
      // then index), so the same car on the same tick always lands on the same bay.
      return free[hashOf(carId) % free.length];
    },

    startTOf(ref) {
      const info = infoOf(ref);
      if (!info) return 0;
      // A halt has no pull-in to start early for: the bus stops exactly AT the
      // stop, on the lane it is already in.
      if (info.onLane) return info.t;
      return manoeuvreStartT(info.row, ref.index, 1);
    },

    exitFor(ref, laneOff) {
      const info = infoOf(ref);
      if (!info || info.row.kind !== "garage") return null;
      const key = `exit|${stallId(ref)}|${Math.round(laneOff * 1000)}`;
      let path = paths.get(key);
      if (!path) {
        const kerb = kerbOffsetAt(level, parseCoordId(ref.tileId), garageExitFrom(info.row), 1);
        path = garageExitPath(info.row, 1, kerb, laneOff);
        paths.set(key, path);
      }
      return {
        path,
        endT: garageExitEndT(info.row, 1),
        from: garageExitFrom(info.row),
      };
    },

    pathFor(ref, laneOff, tStart) {
      // The cache key carries the anchor too: two cars peeling off toward the
      // same bay from slightly different points get their own curves, and a
      // replayed seed hits the same entries.
      const key = `${stallId(ref)}|${Math.round(laneOff * 1000)}|${
        tStart === undefined ? "d" : Math.round(tStart * 1000)
      }`;
      const cached = paths.get(key);
      if (cached) return cached;
      const info = infoOf(ref);
      if (!info) return null;
      const coord = parseCoordId(ref.tileId);
      // Built in TILE units (size 1) so the sim can measure the manoeuvre in the
      // same units as `segLen`; the renderer scales by `tileSize` when it draws.
      const kerb = kerbOffsetAt(level, coord, info.row.from, 1);
      const path = manoeuvrePath(info.row, ref.index, 1, kerb, laneOff, tStart);
      paths.set(key, path);
      return path;
    },

    occupancy() {
      const out: Record<string, string> = {};
      for (const [key, carId] of occupants) out[key] = carId;
      return out;
    },
  };
}
