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
  stallLengthPx,
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

// Can a vehicle of `kind` use a stall in `row`?
//
// The gate is the vehicle's REAL BODY LENGTH against the bay's real length —
// never a category. An admission flag that let a vehicle in without changing the
// bay's size is exactly how a 92px semi ends up centred in a 60px bay, lying
// across the two spaces either side of it, which the registry then hands to two
// more cars. Nothing downstream would catch it either: the swept-overlap check
// only compares bodies within 0.7 lanes of each other, and a bay is by
// construction further out than that. The only guard is this function.
//
// A reserved DISABLED or DELIVERY bay stays empty: nothing issues a permit yet,
// so ordinary traffic keeps out and the bay reads as the real thing — a car park
// is never 100% usable. Deliberate, not an oversight.
export function stallFits(
  kind: VehicleKind,
  row: ParkingRow,
  carLength: number,
  tileSize = 200,
): boolean {
  if (!vehicleCanPark(kind)) return false;
  if (row.reserved === "disabled" || row.reserved === "delivery") return false;
  const bodyPx = specLength(vehicleSpec(kind, carLength)) * tileSize;
  // 2% margin so a body that exactly fills its bay still reads as parked rather
  // than as bursting out of it.
  return bodyPx <= stallLengthPx(row, tileSize) * 0.98;
}

// --- The registry ------------------------------------------------------------

export interface StallInfo {
  ref: StallRef;
  row: ParkingRow;
  facilityId: string;
  hidden: boolean; // a garage slot: the car is inside a building, not drawn
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
  occupantOf(ref: StallRef): string | null;
  isFree(ref: StallRef): boolean;
  // Take a stall for `carId`. False when someone got there first — the caller
  // then keeps driving, which is exactly what a real driver does.
  claim(ref: StallRef, carId: string): boolean;
  release(ref: StallRef): void;
  // Release every stall held by a car (used when a car is removed mid-park, e.g.
  // on reset), so a stall can never leak and strand a bay forever.
  releaseAllOf(carId: string): void;
  // The first free stall on `tileId` a vehicle of `kind` entering through `from`
  // can take, scanned in DRIVING ORDER (nearest first) so a car takes the space
  // it reaches first rather than driving past three empty bays.
  pickStallOn(tileId: string, from: number, kind: VehicleKind): StallRef | null;
  // The manoeuvre curve for a stall, in TILE units (size 1). `laneOff` is the
  // car's lateral lane offset in tile units; `tStart` anchors the curve at the
  // car's real position so the sprite does not jump when the swing begins.
  pathFor(ref: StallRef, laneOff: number, tStart?: number): ManoeuvrePath | null;
  // Where along its approach a car peels off toward `ref` (0..1 of the tile).
  startTOf(ref: StallRef): number;
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
    // reserved bay answers no. Counting reserved bays as capacity would make a
    // facility advertise space it can never hand out, so cars would keep routing
    // to a car park that is full for them.
    if (kind === undefined) return stallFits("car", info.row, carLength, tileSize);
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
    occupantOf: ref => occupants.get(stallId(ref)) ?? null,
    isFree: ref => infos.has(stallId(ref)) && !occupants.has(stallId(ref)),

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

    releaseAllOf(carId) {
      for (const [key, owner] of occupants) {
        if (owner === carId) occupants.delete(key);
      }
      aims.delete(carId);
    },

    pickStallOn(tileId, from, kind) {
      const cell = level[tileId];
      if (!cell?.parking?.rows?.length) return null;
      let best: { ref: StallRef; t: number } | null = null;
      for (const row of cell.parking.rows) {
        if (row.from !== from || row.count <= 0) continue;
        const side = rowSide(row);
        if (!stallFits(kind, row, carLength, tileSize)) continue;
        for (let i = 0; i < row.count; i++) {
          const ref: StallRef = { tileId, from: row.from, side, index: i };
          if (occupants.has(stallId(ref))) continue;
          const info = infoOf(ref);
          if (!info) continue;
          // Nearest-first in DRIVING order: `t` grows along the direction of
          // travel, so the smallest free `t` is the first bay the car meets.
          if (!best || info.t < best.t) best = { ref, t: info.t };
        }
      }
      return best?.ref ?? null;
    },

    startTOf(ref) {
      const info = infoOf(ref);
      return info ? manoeuvreStartT(info.row, ref.index, 1) : 0;
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
