// The PARKING PHASE MACHINE: what a road vehicle does between arriving at a car
// park and rejoining the traffic.
//
// Lifted out of `road.ts` unchanged. It was ~430 lines of a 3200-line file and it
// reads as a subject of its own — claiming a space, swinging into it, dwelling,
// and getting back out again — so the only thing it shared with the traffic model
// was the `Car` it operates on.
//
// The point of the split is the DEPENDENCY LIST below. Inside `createRoadSim` all
// of this was closure state and there was no way to see what parking actually
// needed from the traffic sim; naming the dozen things it uses is most of the
// value of moving it. Everything else it needs — the registry, the tile geometry,
// the router — it imports directly, because those were never road.ts's to lend.
//
// Two of them are the interesting ones, and both are genuinely road.ts's: the
// body sampler (which walks a car's path by real driven arc length) and the road
// graph's exit resolver. The rest is configuration and the vehicle array.
//
// The three layers, so a reader knows which file to open:
//   tiles/parking.ts  — where bays ARE (data + geometry, no state)
//   sim/parking.ts    — which are TAKEN (the registry)
//   THIS FILE         — what a car DOES about them (the phases)

import { Coordinates } from "@/types";
import { Level } from "@/tiles/model";
import { nearestUsableLaneIndex, usableLaneIndices, type VehicleClass } from "@/tiles/lanes";
import { Port, neighborCoord } from "./topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { planRoute, planRouteToGoals, RouteTurn, RouteGoal } from "./roadRouter";
import type { LaneGeometry } from "./laneGeometry";
import type { ParkingRegistry } from "./parking";
import { manoeuvreLength } from "@/tiles/parking";
import type { Car, RoadEntry, VehicleKind } from "./road";

// A body point as `road.ts` samples it — only the fields the gates below read.
export interface ParkingBodyPoint {
  tileId: string;
  entry: Port;
  t: number;
}

// Everything the phase machine needs from the traffic simulation, named. Anything
// it could import for itself is NOT in here on purpose: this list is meant to be
// short enough to read as the answer to "how coupled is parking to the road sim?"
export interface ParkingDeps {
  level: Level;
  // The live vehicle array, by reference — several gates compare a car against
  // every other one on the same tile.
  cars: Car[];
  parking: ParkingRegistry;
  // The parking decision stream. Separate from the traffic ones so it is only ever
  // drawn from on a level that HAS a car park, which is what keeps every existing
  // seeded run byte-identical.
  parkRng: () => number;
  // The routing stream, for the fresh route a car needs once its stay is over.
  routeRng: () => number;
  laneGeo: LaneGeometry;
  allMapExits: RoadEntry[];
  dwellRange: { min: number; max: number };
  // road.ts's own body sampler. NOT re-derivable here: it walks the car's path by
  // real driven arc length through `segLen`, which is traffic-model business.
  bodyPoints: (car: Car) => ParkingBodyPoint[];
  // The road graph's exit resolver, likewise road.ts's.
  roadExitPort: (
    level: Level,
    coord: Coordinates,
    entryPort: Port,
    cls: VehicleClass,
  ) => Port | null;
  // Bumper gap, shared with the following model so the two agree about how close
  // is too close.
  carGap: number;
  // Tuning, so the numbers stay next to the traffic ones they were tuned against.
  tuning: ParkingTuning;
}

export interface ParkingTuning {
  fraction: number;
  dwellMin: number;
  dwellMax: number;
  speed: number;
  maxTries: number;
  pullOutGap: number;
  arriveEps: number;
  stoppedYielding: number;
}

// The lane-access class of a vehicle. Pure, so it lives here rather than being
// lent by road.ts.
function clsOf(car: Car): VehicleClass {
  return car.kind === "bus" ? "bus" : "car";
}

function laneOf(car: Car): number {
  return Math.round(car.laneIndex);
}

// The kerb-most lane a class-`cls` vehicle may ride on this approach — where a car
// rejoining the road from a bay aims.
function kerbMostLane(
  road: Level[string]["road"],
  entry: Port,
  cls: VehicleClass,
): number {
  const usable = usableLaneIndices(road, entry, cls);
  return usable.length > 0 ? Math.min(...usable) : 0;
}

// The phases, closed over one sim's state. Returned as an object rather than a
// class for the same reason the rest of `sim/` is: no `this`, nothing to bind, and
// the closure IS the instance.
export function createParkingPhases(deps: ParkingDeps) {
  const {
    level,
    cars,
    parking,
    parkRng,
    routeRng,
    laneGeo,
    allMapExits,
    dwellRange,
    bodyPoints,
    roadExitPort,
    carGap: CAR_GAP,
    tuning: PARKING,
  } = deps;
  const PARK_ARRIVE_EPS = PARKING.arriveEps;
  const STOPPED_YIELDING = PARKING.stoppedYielding;
  // Cars that drove a whole car park and found no space (the cruising tally).
  let parkingGiveUps = 0;

  // The car's lateral lane offset in TILE units — where it really sits across the
  // road. The manoeuvre curve starts there rather than on the centreline, so a car
  // in the kerb lane of a four-lane street peels off from the kerb lane and not
  // from the middle of the carriageway.
  function laneOffsetOf(car: Car): number {
    const head = car.path[car.headIndex];
    return laneGeo.couplerOffsets(
      {
        coord: head.coord,
        entryPort: head.entryPort,
        exitPort: head.exitPort,
        lanePos: car.laneIndex,
      },
      laneOf(car),
      clsOf(car),
    ).offEntry;
  }

  // Plan a trip that ENDS at a car park. Picks among the car parks that still
  // have a space this vehicle could use, weighted by how many — a big empty car
  // park pulls more traffic than a single kerbside bay, which is what makes a
  // city read right — then finds the way there. Null when nothing is open or
  // nothing is reachable, and the caller falls back to an ordinary through trip.
  function planParkingTrip(
    coord: Coordinates,
    entry: Port,
    kind: VehicleKind,
    cls: VehicleClass,
    avoid?: string | null,
  ): { turns: RouteTurn[]; facilityId: string } | null {
    const open = parking
      .openFacilities(kind)
      .filter(f => f.id !== avoid);
    if (open.length === 0) return null;
    // Weighted draw without replacement: try the picked car park, and if it turns
    // out to be unreachable from here try the next, up to a small bound. A level
    // where a car park exists but no road reaches it is an authoring error, not
    // something to spend a whole BFS budget on every spawn.
    const pool = open.map(f => ({
      f,
      w: Math.max(1, parking.availableFor(f.id, kind)),
    }));
    for (let attempt = 0; attempt < 3 && pool.length > 0; attempt++) {
      const total = pool.reduce((s, p) => s + p.w, 0);
      let r = parkRng() * total;
      let idx = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].w;
        if (r < 0) {
          idx = i;
          break;
        }
      }
      const chosen = pool.splice(idx, 1)[0].f;
      // Aim only at the approaches that currently have a free stall for this
      // vehicle — a row of disabled bays is not a destination for an ordinary car.
      const goals: RouteGoal[] = chosen.access.filter(a =>
        parking.pickStallOn(getCoordinatesId(a.coord), a.entryPort, kind, "probe") !== null,
      );
      if (goals.length === 0) continue;
      const plan = planRouteToGoals(level, coord, entry, goals, cls);
      if (plan.goal) return { turns: plan.turns, facilityId: chosen.id };
    }
    return null;
  }

  // Try to take a free bay on the tile the car has just reached. Claiming is the
  // reservation, so from here on the space is the car's and nobody else can aim
  // for it. Real-driver semantics: you take the first space you SEE, which is the
  // first one on the tile you are on — not one three tiles away.
  function claimStallHere(car: Car, tileId: string, entry: Port): void {
    if (car.stall || car.parkTarget === null) return;
    const cell = level[tileId];
    if (!cell?.parking?.rows?.length) return;
    if (parking.facilityOfTile(tileId) !== car.parkTarget) return;
    // Only bays still ahead of the nose: the car has just crossed onto this tile,
    // so that is normally all of them, but a car that SPAWNED mid-tile must not be
    // handed a space it has already driven past.
    const ref = parking.pickStallOn(tileId, entry, car.kind, car.id, car.headProgress);
    if (!ref) return;
    if (!parking.claim(ref, car.id)) return;
    car.stall = ref;
    car.parkOnLane = parking.info(ref)?.onLane ?? false;
  }

  // Give the stall back and forget it. Used when the car leaves, and when it is
  // removed mid-park — a leaked claim would strand a bay for the rest of the run.
  function releaseStall(car: Car): void {
    if (car.stall) parking.release(car.stall);
    parking.unaim(car.id);
    car.stall = null;
    car.parkPath = null;
    car.manoeuvre = 0;
    car.parkOnLane = false;
  }

  // Has the car reached the point on its approach where it should swing into its
  // claimed bay? Only true on the right tile, in the right direction.
  function atStallEntry(car: Car): boolean {
    if (!car.stall || car.phase !== "driving") return false;
    const head = car.path[car.headIndex];
    if (getCoordinatesId(head.coord) !== car.stall.tileId) return false;
    if (head.entryPort !== car.stall.from) return false;
    // Tolerance, not pedantry: `clearAhead` binds the car's clear distance to
    // exactly this point, and the brake ramp (vSafe = sqrt(2·brake·clear))
    // approaches it asymptotically — a strict `>=` would leave the car creeping
    // toward its own bay for ever. A fifth of a car length is invisible, and
    // `beginEntering` anchors the curve at the car's REAL position anyway, so
    // arriving early costs nothing.
    if (car.headProgress < parking.startTOf(car.stall) - PARK_ARRIVE_EPS) return false;
    // ONE CAR AT A TIME per car park. A barrier serves one vehicle; a ramp is one
    // lane wide. Without this, every car bound for a garage would swing into the
    // same ramp mouth at once (all its slots share one entry point) and they would
    // draw through each other. With it, the followers hold on the street and their
    // frozen bodies queue the ones behind THEM — which is the single most
    // recognisable parking image there is: a line of cars waiting to get in.
    const mine = parking.info(car.stall)?.facilityId;
    if (mine !== undefined) {
      for (const other of cars) {
        if (other === car || other.phase !== "entering" || !other.stall) continue;
        if (parking.info(other.stall)?.facilityId === mine) return false;
      }
    }
    return true;
  }

  // How long this vehicle stays. Authored PER FACILITY where the level says so: a
  // kerbside space that turns over every twenty seconds beside a garage whose cars
  // sit for two minutes is what makes a street read as a street — and a bus stop,
  // whose dwell is seconds, is what makes a halt read as a halt rather than as a
  // breakdown.
  function drawDwell(car: Car): number {
    const authored = car.stall
      ? parking.dwellOf(parking.info(car.stall)?.facilityId ?? "")
      : undefined;
    const lo = authored ? authored[0] : dwellRange.min;
    const hi = authored ? authored[1] : dwellRange.max;
    return lo + parkRng() * Math.max(0, hi - lo);
  }

  // NOSE ↔ CENTRE, the one conversion the parking layer needs and the one it is
  // easy to forget. `headProgress` names where the car's FRONT is along the tile;
  // every manoeuvre curve names where its MIDDLE is. Half a body length apart —
  // a fifth of a tile for a coach, which is a visible jump.
  //
  // Measured in tile PROGRESS rather than driven arc, which is exact here: a
  // parking row is only legal on a straight approach (`validateParking`), and a
  // straight lane segment is one tile long.
  // NEGATIVE IS ALLOWED and deliberate: a car peeling off toward the first bay of
  // a packed rank has its nose barely onto the tile and its middle still on the
  // one behind. `centrelineAt` is a plain lerp for a straight, so t < 0 is simply
  // the lane extended backwards — the honest answer. Clamping it to 0 instead
  // would put back a fifth of the very jump this exists to remove.
  const halfBody = (car: Car): number => car.length / 2;
  const centreT = (car: Car): number => car.headProgress - halfBody(car);

  function beginEntering(car: Car): void {
    // A HALT needs no manoeuvre at all: the bus is already where it is stopping.
    // Skipping straight to `parked` is not a shortcut — building a degenerate
    // zero-length curve for it would divide by its own length.
    if (car.parkOnLane) {
      car.phase = "parked";
      car.velocity = 0;
      car.manoeuvre = 1;
      car.dwellLeft = drawDwell(car);
      return;
    }
    // Anchor the curve at where the car ACTUALLY is, so the sprite never jumps
    // as the swing starts — and mind WHICH POINT OF THE CAR that is. The sim
    // tracks the NOSE (`headProgress`, arc 0 of `sampleAtArc`); a manoeuvre curve
    // carries the CENTRE (`sample()` lays the body ±half a length about it, and a
    // stall pose is where a car RESTS, which is its middle). Anchoring nose-on-
    // centre teleports the body half its own length — forward here, and backwards
    // again when it rejoins the road, which is what a bus leaving a lay-by showed.
    const path = parking.pathFor(car.stall!, laneOffsetOf(car), centreT(car));
    if (!path) {
      // The level changed under the claim — give the bay back and drive on.
      releaseStall(car);
      return;
    }
    car.parkPath = path;
    car.phase = "entering";
    car.manoeuvre = 0;
    car.velocity = 0;
    car.laneVel = 0;
    car.heldSec = 0;
    car.overtakePhase = "none";
    car.overtakeOf = null;
  }

  // Is the car's own lane slot EMPTY right now — i.e. can it show itself at all?
  // A car about to leave claims its slot so traffic brakes for it, but it must not
  // do that underneath a vehicle that is already there: a body appearing inside
  // another body is a clip, however briefly. This is the narrow check (my own
  // length, nothing more); `pullOutClear` is the wider one that decides when it is
  // safe to actually roll.
  function slotFree(car: Car, entryPort: Port, t: number): boolean {
    const head = car.path[car.headIndex];
    const tileId = getCoordinatesId(head.coord);
    const front = t + CAR_GAP;
    // The tile BEHIND me on this approach. A body long enough to straddle the
    // seam has its tail there, and a per-tile comparison cannot see it: the check
    // below skipped every point whose tileId was not mine, so a car standing
    // across the seam read as nothing but its nose. Measured on /test/parkinglot:
    // a car resumed from its bay four thousandths of a tile in, INSIDE a leaving
    // neighbour whose tail lay on the tile behind (`1,2|t0.948`), and the two sat
    // a tenth of a body through each other.
    const behind = neighborCoord(head.coord, entryPort);
    const behindId = behind ? getCoordinatesId(behind) : null;
    for (const other of cars) {
      if (other === car) continue;
      // Whether `other` is in the way of this slot RIGHT NOW.
      //
      // Not just moving traffic. Two cars in ADJACENT 90° bays share barely a
      // third of a car length between their peel-off points — the bays are 28px
      // apart because the cars stand across the aisle, but out on the lane they
      // are 38px long — so two neighbours emerging at the same moment simply
      // cannot both fit. In life one waits for the other; measured before this,
      // they drew through each other by a third of a body on /test/parkinglot.
      //
      // A car already committed to leaving or arriving wins outright. Two that
      // become ready on the SAME tick would otherwise each see the other still
      // parked and both commit, so ties go to the lower id — the same
      // deterministic tie-break the junction gates use.
      const committed = other.phase === "leaving" || other.phase === "entering";
      const readyToo =
        other.phase === "parked" && other.dwellLeft <= 0 && other.id < car.id;
      if (!committed && !readyToo && other.phase !== "driving") continue;
      // How much road the car behind needs to stop. Claiming a slot is putting a
      // stationary obstacle in a live lane, so it may only be done where the
      // traffic can actually brake for it — a bumper gap is not enough at cruise
      // (v^2/2b is ~0.10 tiles at 0.5 tiles/sec, nearly twice CAR_GAP), and
      // claiming inside that distance is a clip the follower cannot avoid.
      // Measured before this: 0.064 body overlap on the aisle of /test/parkinglot.
      const stopping = (other.velocity * other.velocity) / (2 * Math.max(other.brake, 1e-6));
      const rear = t - car.length - CAR_GAP - stopping;
      // A still-parked neighbour reports NO body points by design, so measure the
      // slot it is about to claim instead — its own frozen peel-off point.
      const pts = readyToo
        ? [
            {
              tileId: getCoordinatesId(other.path[other.headIndex].coord),
              entry: other.path[other.headIndex].entryPort,
              t: other.headProgress,
            },
            {
              tileId: getCoordinatesId(other.path[other.headIndex].coord),
              entry: other.path[other.headIndex].entryPort,
              t: other.headProgress - other.length,
            },
          ]
        : bodyPoints(other);
      // The other body's EXTENT along my approach, as one interval rather than a
      // handful of points — a straddling body is only whole when its far side is
      // carried across the seam. A point on the tile behind maps to `t - 1`, which
      // is exact here: a straight lane segment is one tile long, and a parking row
      // is only legal on a straight approach.
      //
      // Anchored on "does it have a point in MY lane on MY tile": that is what
      // says the body is in my stream at all. Without it an upstream point alone
      // would block on anything passing back there, oncoming traffic included.
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      let mine = false;
      for (const p of pts) {
        if (p.tileId !== tileId || p.entry !== entryPort) continue;
        mine = true;
        lo = Math.min(lo, p.t);
        hi = Math.max(hi, p.t);
      }
      if (!mine) continue;
      if (behindId !== null) {
        for (const p of pts) if (p.tileId === behindId) lo = Math.min(lo, p.t - 1);
      }
      if (hi > rear && lo < front) return false;
    }
    return true;
  }

  // Re-seat a car onto the lane slot it will REJOIN the road at. For a bay it is
  // reversed out of that is where it peeled off (nothing changes); for one driven
  // out FORWARDS it is further down the street — the far end of the exit curve —
  // and for a garage that may be on the other side of the road entirely.
  //
  // Done when the car starts leaving, NOT when it finishes: the body has to be at
  // the exit for the whole manoeuvre, or the car spends the manoeuvre claiming the
  // ENTRANCE and then materialises at the exit — inside whatever had queued there
  // in the meantime. Measured as a 0.064 body overlap on /test/parkinglot.
  function seatAtExitSlot(car: Car): void {
    const gExit = car.stall ? parking.exitFor(car.stall, 0, halfBody(car)) : null;
    if (!gExit) return;
    const head = car.path[car.headIndex];
    const entryPort = gExit.from as Port;
    const cls = clsOf(car);
    const road = level[getCoordinatesId(head.coord)]?.road;
    car.path = [
      { coord: head.coord, entryPort, exitPort: roadExitPort(level, head.coord, entryPort, cls) },
    ];
    car.headIndex = 0;
    // `endT` is where the curve leaves the car's CENTRE; the nose is half a body
    // further on. `exitFor` was asked to keep that much room, so this stays on the
    // tile — the clamp is a backstop for a bay authored right up against the seam.
    car.headProgress = Math.min(0.999, gExit.endT + halfBody(car));
    const lane = nearestUsableLaneIndex(road, entryPort, kerbMostLane(road, entryPort, cls), cls);
    car.laneIndex = lane;
    car.targetLane = lane;
    car.lanePivot = null;
  }

  // Is the lane behind the car's slot clear enough to pull out into? Checked
  // against real bodies on the same tile travelling the same way, so a car waits
  // for a gap in the traffic instead of materialising into it.
  function pullOutClear(car: Car): boolean {
    if (!car.stall) return true;
    const head = car.path[car.headIndex];
    const tileId = getCoordinatesId(head.coord);
    const slotFront = car.headProgress;
    const slotRear = car.headProgress - car.length - PARKING.pullOutGap;
    for (const other of cars) {
      // Another car waiting to leave its own bay must not veto this one — two
      // neighbours would hold each other in place for ever, each waiting for a road
      // the other is sitting on. Their bays are at least a pitch apart, so their
      // claimed slots do not overlap, and ordinary following takes over once both
      // are moving. A bus HALTED in the lane is a different matter: it is genuinely
      // parked across the road this car wants, so it counts.
      if (other === car) continue;
      if (other.phase !== "driving" && !other.parkOnLane) continue;
      // A car that has STOPPED behind us has stopped BECAUSE of us — the slot was
      // claimed the moment the dwell ended, so it braked for a body in its lane.
      // That is the gap, and treating it as an obstacle instead is a guaranteed
      // deadlock: it waits for us to go, we wait for it to clear, and neither ever
      // moves. Measured before this line existed: two cars stuck in `leaving` for
      // fifty of an eighty-second run. Only traffic still ROLLING can close a gap.
      if (other.velocity <= STOPPED_YIELDING) continue;
      for (const p of bodyPoints(other)) {
        if (p.tileId !== tileId) continue;
        if (p.entry !== head.entryPort) continue; // same travel direction only
        if (p.t > slotRear && p.t < slotFront + PARKING.pullOutGap) return false;
      }
    }
    return true;
  }

  // Send the car back into traffic from its bay: re-seat it on the lane at the
  // point the curve started from, and plan a fresh route to a map edge. The path
  // is REPLACED (not appended to) — the drive that brought it here is over, and a
  // stale history would keep `sampleAtArc` walking back into it.
  function resumeFromStall(car: Car): void {
    const head = car.path[car.headIndex];
    const cls = clsOf(car);
    // Where the car rejoins the road, and facing which way.
    //  • A BAY: `headProgress` was frozen at the peel-off point for the whole
    //    stay, so it still names exactly where the curve meets the lane, on the
    //    approach the car arrived by.
    //  • A GARAGE: it came out of the OUT ramp, which is further down the road —
    //    and, if the author gave the building a separate exit, on a different
    //    approach entirely. Re-seed it there, or it would teleport back to the
    //    entrance and drive the same stretch twice.
    // `seatAtExitSlot` already moved a garage car onto its out ramp when it
    // started leaving, so by here `head` IS the slot to resume from either way.
    const entryPort = head.entryPort;
    const startT = car.headProgress;
    const exit = roadExitPort(level, head.coord, entryPort, cls);
    const replan = planRoute(level, head.coord, entryPort, allMapExits, routeRng, cls);
    car.path = [{ coord: head.coord, entryPort, exitPort: exit }];
    car.headIndex = 0;
    car.headProgress = Math.max(0, Math.min(0.999, startT));
    car.routePlan = replan.turns;
    car.routeStep = 0;
    car.destination = replan.destination;
    car.parkTarget = null;
    car.enteredTarget = false;
    car.lanePivot = null;
    car.pendingExitLane = null;
    car.tilesSinceJunction = 0;
    car.laneVel = 0;
    car.launchTimer = 0;
    car.waitSeconds = 0;
    const lane = nearestUsableLaneIndex(
      level[getCoordinatesId(head.coord)]?.road,
      entryPort,
      kerbMostLane(level[getCoordinatesId(head.coord)]?.road, entryPort, cls),
      cls,
    );
    car.laneIndex = lane;
    car.targetLane = lane;
    car.overtakeHomeLane = lane;
    car.phase = "driving";
    car.parkExiting = false;
    releaseStall(car);
  }

  // The parking phase machine. Runs INSTEAD of the driving physics — a car in a
  // bay is not doing car-following, junction arbitration or lane changes, and
  // trying to make it do so is what would break every gate at once.
  function advanceParking(car: Car, dt: number): void {
    car.velocity = 0;
    // A parked car is not WAITING for anything — it is where it wants to be.
    // `waitSeconds` feeds the junction arbiter's starvation guard and `waitedSec`
    // feeds the crossing-patience objective (`frame()` → objectives.ts →
    // crossing-keeper's 30s fail threshold). Left to accrue, a long dwell in a bay
    // beside a crossing would LOSE the level while behaving perfectly.
    car.waitSeconds = 0;
    car.waitedSec = 0;
    car.launchTimer = 0;
    const len = car.parkPath ? manoeuvreLength(car.parkPath) : 0;
    // Fraction of the curve covered this tick, at the crawl speed — scaled by how
    // GENTLE the curve is (`pace`), because a long shallow swing into a lay-by is
    // not driven at the speed of a tight turn into a 90° bay.
    const pace = car.parkPath?.pace ?? 1;
    const step = len > 1e-6 ? (PARKING.speed * pace * dt) / len : 1;

    if (car.phase === "entering") {
      car.manoeuvre = Math.min(1, car.manoeuvre + step);
      if (car.manoeuvre >= 1) {
        car.phase = "parked";
        car.dwellLeft = drawDwell(car);
      }
      return;
    }

    if (car.phase === "parked") {
      car.dwellLeft -= dt;
      // A HALT just drives on when the time is up. There is no gap to wait for and
      // no slot to claim — the bus never gave up the lane it is standing in.
      if (car.parkOnLane) {
        if (car.dwellLeft <= 0) resumeFromStall(car);
        return;
      }
      // Dwell over: START LEAVING — indicator on. The car does not move yet (the
      // "leaving" branch below only rolls when the road is clear), but it claims
      // its lane slot from this moment, so traffic behind it brakes and the gap it
      // needs forms BECAUSE it is waiting. Making the claim conditional on already
      // having a gap is what made this a no-win dial: a car that is invisible
      // until it moves is one that either never gets out, or appears in front of
      // traffic that had no reason to slow down.
      //
      // `slotFree` is the one thing that must hold first — the slot cannot be
      // claimed out from under a car that is passing through it this very tick.
      // Where this car will actually rejoin the road — the far end of its exit
      // curve if it drives out forwards, its own peel-off point if it reverses.
      // That is the slot to test and to claim.
      const gExit = car.stall ? parking.exitFor(car.stall, 0, halfBody(car)) : null;
      const seatPort = gExit ? (gExit.from as Port) : car.path[car.headIndex].entryPort;
      const seatT = gExit ? gExit.endT + halfBody(car) : car.headProgress;
      if (car.dwellLeft <= 0 && slotFree(car, seatPort, seatT)) {
        car.phase = "leaving";
        // A kerbside bay and a garage are driven out of nose-first; an echelon or
        // 90° bay is backed out of along the curve it came in on.
        const exit = car.stall ? parking.exitFor(car.stall, laneOffsetOf(car), halfBody(car)) : null;
        if (exit) {
          car.parkPath = exit.path;
          car.parkExiting = true;
          car.manoeuvre = 0;
          // Claim the OUT ramp's slot now, for the whole manoeuvre.
          seatAtExitSlot(car);
        } else {
          car.parkExiting = false;
          car.manoeuvre = 1;
        }
      }
      return;
    }

    // "leaving". The slot is already claimed (see above); roll only when the road
    // is actually clear. Holding here rather than at the "parked" gate is what
    // lets the queue build up behind the waiting car.
    if (!pullOutClear(car)) return;
    // Nose-first: drive the exit curve FORWARD. Otherwise replay the entry curve
    // backwards, which is a car reversing out of its space.
    if (car.parkExiting) {
      car.manoeuvre = Math.min(1, car.manoeuvre + step);
      if (car.manoeuvre >= 1) resumeFromStall(car);
      return;
    }
    car.manoeuvre = Math.max(0, car.manoeuvre - step);
    if (car.manoeuvre <= 0) resumeFromStall(car);
  }
  // The car has driven out the far side of the car park it was aiming at without
  // finding a space — the "cruising for a space" moment. Try somewhere else, and
  // after a couple of failures give up and drive on, which is what a real driver
  // does. Lives here rather than in road.ts's tile-crossing loop because deciding
  // what a thwarted driver does next is a parking decision, not a traffic one.
  function giveUpAndReplan(
    car: Car,
    coord: Coordinates,
    entry: Port,
    cls: VehicleClass,
  ): void {
    car.enteredTarget = false;
    car.parkTries += 1;
    parkingGiveUps += 1;
    const retry =
      car.parkTries < PARKING.maxTries
        ? planParkingTrip(coord, entry, car.kind, cls, car.parkTarget)
        : null;
    if (retry) {
      car.routePlan = retry.turns;
      car.routeStep = 0;
      car.parkTarget = retry.facilityId;
      parking.aim(retry.facilityId, car.id); // move the token to the new target
    } else {
      const away = planRoute(level, coord, entry, allMapExits, routeRng, cls);
      car.routePlan = away.turns;
      car.routeStep = 0;
      car.destination = away.destination;
      car.parkTarget = null;
      parking.unaim(car.id); // gave up on parking — stop holding a space
    }
  }

  return {
    planParkingTrip,
    giveUpAndReplan,
    claimStallHere,
    releaseStall,
    atStallEntry,
    beginEntering,
    resumeFromStall,
    advanceParking,
    laneOffsetOf,
    giveUps: () => parkingGiveUps,
  };
}

export type ParkingPhases = ReturnType<typeof createParkingPhases>;
