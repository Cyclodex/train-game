import { describe, it, expect } from "vitest";
import { itSlow } from "./support/tier";
import { createGame } from "@/game";
import { citizensMode } from "@/modes/citizens";
import { citizenbike } from "@/levels/test/scenarios/citizenbike";
import { bikeoverflow } from "@/levels/test/scenarios/bikeoverflow";
import { buildCitizenWorld } from "@/tiles/cities";
import {
  createCitizenSim,
  DEFAULT_TUNING,
  TRAVEL_MODES,
  type DrivingPort,
  type ModeQuote,
  type TransitPort,
} from "@/sim/citizens";
import { createRoadSim } from "@/sim/road";
import { createPedestrianSim } from "@/sim/pedestrians";
import { planWalk } from "@/tiles/footway";
import { bikeRangeOf } from "@/tiles/catchment";
import type { SimEvent } from "@/sim/simulation";

// PHASE C′ — citizens ride bikes. The bike is the missing middle of the mode
// choice, and bike-and-ride is the railway's door when the platform is out of
// walking reach. The board built to show it is /test/citizenbike: houses four
// tiles from the station, a rack beneath the platform, a workshop up the road
// and a works town only the railway reaches.

function newGame() {
  return createGame(
    citizenbike.level,
    Object.values(citizenbike.trains).map(t => ({
      id: t.id,
      x: t.x,
      y: t.y,
      type: t.type,
      wagonIds: (t.wagons ?? []).map(w => w.id),
    })),
    200,
    citizensMode,
    // Seed 7, both here and in the direct sims below: the citizen town it
    // deals shows every fact at once (bike commutes chosen, bikeless refused,
    // bike-and-ride offered AND out of range) — seed 1's rolls happen to hand
    // almost every worker a high ownership draw on this small board.
    7,
    citizenbike.colors,
    undefined,
    citizenbike.id
  );
}

function run(game: ReturnType<typeof createGame>, seconds: number, onTick?: () => void) {
  for (let t = 0; t < seconds; t += 0.2) {
    game.advance(0.2);
    onTick?.();
  }
}

describe("the six-mode quote", () => {
  // A quote-only sim: no ports needed, `quoteModes` prices from the world alone.
  function quoteSim() {
    const world = buildCitizenWorld(citizenbike.level, 7);
    return createCitizenSim({
      world,
      seed: 7,
      // A transit port that says "the line serves everything" — the quotes
      // under test are the bike ones; rail service itself has its own specs.
      transit: { enqueue: () => true, connects: (a, b) => a !== b },
    });
  }

  it("every mode-share record carries every mode — no silent under-reporting", () => {
    const sim = quoteSim();
    const share = sim.stats().modeShare;
    for (const m of TRAVEL_MODES) expect(share).toHaveProperty(m);
    for (const city of sim.cities()) {
      for (const m of TRAVEL_MODES) expect(city.modeShare).toHaveProperty(m);
    }
  });

  it("quotes bike and bikeAndRide rows for every journey, with honest refusals", () => {
    const sim = quoteSim();
    const citizens = sim.citizens().filter(c => c.work);
    expect(citizens.length).toBeGreaterThan(10);
    let bikeChosen = 0;
    let noBike = 0;
    let brOffered = 0;
    let transitRefusedOutOfReach = 0;
    for (const c of citizens) {
      const quotes = sim.quoteFor(c.id) as ModeQuote[];
      const byMode = new Map(quotes.map(q => [q.mode, q]));
      // The two new rows are always PRESENT — refused with a reason when not
      // on offer, never simply missing.
      expect(byMode.has("bike")).toBe(true);
      expect(byMode.has("bikeAndRide")).toBe(true);
      const bike = byMode.get("bike")!;
      if (!c.profile.bikeOwner) {
        expect(bike.unavailable).toBe("no-bike");
        noBike++;
      }
      if (bike.chosen) bikeChosen++;
      const br = byMode.get("bikeAndRide")!;
      if (!br.unavailable) {
        brOffered++;
        // Offered = the rack's station and a real destination platform.
        expect(br.station).toBe("5,0");
        expect(br.toStation).toBe("16,0");
      }
      // The houses sit four tiles from every platform: plain transit is out of
      // reach on this board BY DESIGN — the rack is the railway's door.
      const transit = byMode.get("transit")!;
      if (transit.unavailable === "no-station-in-reach") transitRefusedOutOfReach++;
    }
    // The board shows all three facts: bikes win commutes for some, the
    // bikeless are refused with the right reason, and bike-and-ride is on
    // offer where walking to the platform is not.
    expect(bikeChosen).toBeGreaterThan(0);
    expect(noBike).toBeGreaterThan(0);
    expect(brOffered).toBeGreaterThan(0);
    expect(transitRefusedOutOfReach).toBeGreaterThan(0);
  });

  it("the range gate is per-rider: keen cyclists reach the rack, reluctant ones do not", () => {
    const sim = quoteSim();
    const owners = sim
      .citizens()
      .filter(c => c.work === "15,2" || c.work === "16,2" || c.work === "17,2")
      .filter(c => c.profile.bikeOwner);
    const offered = owners.filter(c => {
      const q = (sim.quoteFor(c.id) as ModeQuote[]).find(x => x.mode === "bikeAndRide")!;
      return !q.unavailable;
    });
    const refusedTooFar = owners.filter(c => {
      const q = (sim.quoteFor(c.id) as ModeQuote[]).find(x => x.mode === "bikeAndRide")!;
      return q.unavailable === "too-far";
    });
    // Both exist on one street: the ride to the rack is 5–9 tiles, which is
    // inside range for keen riders and beyond it for reluctant ones — the
    // whole point of a per-rider range instead of one constant.
    expect(offered.length).toBeGreaterThan(0);
    expect(refusedTooFar.length).toBeGreaterThan(0);
    // And the gate is EXACTLY the rider's own range against their own ride —
    // Chebyshev, like every station-reach measure: offered if and only if
    // `bikeRangeOf(their keenness)` reaches the rack's station.
    for (const c of owners) {
      const home = c.home.split(",").map(Number);
      const ride = Math.max(Math.abs(home[0] - 5), Math.abs(home[1] - 0));
      const q = (sim.quoteFor(c.id) as ModeQuote[]).find(x => x.mode === "bikeAndRide")!;
      const inRange = ride <= bikeRangeOf(c.profile.bikeAffinity);
      expect(!q.unavailable).toBe(inRange);
    }
  });
});

describe("the walk from the rack to the platform", () => {
  it("planWalk takes the rack's street tile itself as an endpoint", () => {
    // The rider dismounts AT the kerb — the walk starts on the street tile's
    // own pavement, not from some plot's doorway. "5,1" is the rack tile,
    // "5,0" the platform directly above it.
    const route = planWalk(citizenbike.level, "5,1", "5,0");
    expect(route).not.toBeNull();
    expect(route!.tiles[0]).toBe("5,1");
  });

  it("a real walker can be dispatched from the rack to the platform", () => {
    const sim = createPedestrianSim({ level: citizenbike.level, seed: 1 });
    const id = sim.request("5,1", "5,0");
    expect(id).not.toBeNull();
    // ...and they actually get there.
    for (let i = 0; i < 4000 && sim.status(id!) !== "arrived"; i++) sim.step(0.1);
    expect(sim.status(id!)).toBe("arrived");
  });
});

describe("citizens ride real bikes", () => {
  itSlow("cyclists appear as vehicles, bike commutes complete, and bike-and-ride walks its last leg", async () => {
    const game = newGame();
    let peakCycling = 0;
    run(game, 1400, () => {
      peakCycling = Math.max(peakCycling, game.citizenStats.cycling);
    });
    // People were BIKES in traffic — the 🚴 count the header shows...
    expect(peakCycling).toBeGreaterThan(0);
    // ...and journeys completed on both new modes: plain bike commutes to the
    // workshop, and bike-and-ride onto the railway (which includes the walked
    // rack→platform leg — a bikeAndRide trip cannot finish without it).
    expect(game.citizenStats.modeShare.bike).toBeGreaterThan(0);
    expect(game.citizenStats.modeShare.bikeAndRide).toBeGreaterThan(0);
    // The bike ate the WALK-OR-DRIVE share, not the railway's: rail journeys
    // still complete on this board (the far town is reachable no other way).
    expect(game.citizenStats.modeShare.bikeAndRide + game.citizenStats.modeShare.transit)
      .toBeGreaterThan(0);
  });

  itSlow("the rack→platform leg is WALKED, visibly, by a real figure", async () => {
    // The direct-sim version, so the trip's own legs are observable: a
    // bikeAndRide journey must pass through leg "walking" WITH a live walker
    // (`walkTrip` set) after its riding leg — the no-teleport guarantee.
    const world = buildCitizenWorld(citizenbike.level, 7);
    const s = citizenbike.size!;
    const roadSim = createRoadSim({
      level: citizenbike.level,
      width: s.cols,
      height: s.rows,
      seed: 7,
      carSpeed: 0.5,
      carLength: 0.19,
      maxCars: 10,
    });
    const pedSim = createPedestrianSim({ level: citizenbike.level, seed: 7 });
    const sim = createCitizenSim({
      world,
      seed: 7,
      transit: { enqueue: () => true, connects: (a, b) => a !== b },
      driving: {
        request: (from, to, park, kind) =>
          roadSim.requestTrip(from, to, kind ?? "car", {
            park: !!park,
            permit: park?.permit,
            parkSearchTiles: park?.searchTiles,
          }),
        status: id => roadSim.tripStatus(id),
        parkedAt: id => roadSim.tripParkedAt(id),
        wantedSpace: id => roadSim.tripWantedSpace(id),
        resume: (id, to, park) =>
          roadSim.releaseTrip(id, to, { park: !!park, permit: park?.permit }),
        abandon: id => roadSim.abandonTrip(id),
        release: id => roadSim.clearFinishedTrip(id),
      },
      walking: {
        request: (from, to) => pedSim.request(from, to),
        // Kerb walks are the CAR overflow's leg (walk from an informally
        // parked car); bikes rack instead, so this port never fires here and a
        // plain fallback keeps the mock honest.
        requestFromKerb: (carTripId, toPlotId) => {
          const kerb = roadSim.tripParkedKerb(carTripId);
          return kerb ? pedSim.request(kerb.tileId, toPlotId) : null;
        },
        status: id => pedSim.status(id),
        release: id => pedSim.release(id),
      },
    });
    let sawRackWalk = false;
    let sawRealBike = false;
    for (let i = 0; i < 7000; i++) {
      roadSim.step(0.2, () => false);
      pedSim.step(0.2);
      sim.step(0.2);
      if (i % 10 === 0) {
        for (const c of sim.citizens()) {
          const t = c.trip;
          if (!t || t.mode !== "bikeAndRide") continue;
          if (t.carTrip) sawRealBike = true;
          if (t.leg === "walking" && t.walkTrip) sawRackWalk = true;
        }
        if (sawRackWalk && sawRealBike) break;
      }
    }
    // The ride happened on a real bike, and the last leg to the platform was
    // walked by a real figure on the pavement — never teleported.
    expect(sawRealBike).toBe(true);
    expect(sawRackWalk).toBe(true);
  });
});

// THE RETURN HALF (destination-parking task 1): the bike persists at the far
// end, holds a BayClass "bike" stand through the dwell, and is resumed for the
// ride home — the exact contract the commuter's car already has.
describe("the return half — the bike persists at the far end", () => {
  // A driving port that records every call and answers like a board where a
  // rack always has a free stand: a park-asking dispatch is standing in one at
  // once, a plain dispatch arrives at once. Precise, deterministic, and it
  // makes the CITIZEN layer's contract observable — which calls it makes, with
  // which vehicle, and what it does with the answers.
  function mockDriving(opts: { parkRefused?: boolean } = {}) {
    const state = new Map<string, "driving" | "parked" | "arrived">();
    const parkedTiles = new Map<string, string>();
    const calls = {
      requests: [] as {
        from: string;
        to: string;
        park: { permit?: string; searchTiles?: number } | null;
        kind: string;
      }[],
      resumes: [] as { id: string; to: string; park: unknown }[],
      released: [] as string[],
      abandoned: [] as string[],
    };
    let n = 0;
    const port: DrivingPort = {
      request(from, to, park, kind) {
        calls.requests.push({ from, to, park: park ?? null, kind: kind ?? "car" });
        if (park && opts.parkRefused) return null; // "no stand free anywhere"
        const id = `veh${++n}`;
        if (park) {
          state.set(id, "parked");
          parkedTiles.set(id, to);
        } else state.set(id, "arrived");
        return id;
      },
      status: id => state.get(id) ?? "arrived",
      parkedAt: id => (state.get(id) === "parked" ? (parkedTiles.get(id) ?? null) : null),
      wantedSpace: () => false,
      resume(id, to, park) {
        if (state.get(id) !== "parked") return false;
        calls.resumes.push({ id, to, park: park ?? null });
        state.set(id, "arrived");
        parkedTiles.delete(id);
        return true;
      },
      abandon: id => {
        calls.abandoned.push(id);
        state.delete(id);
      },
      release: id => {
        calls.released.push(id);
      },
    };
    return { port, calls, state };
  }

  // A railway of one ghost train that boards anyone the moment they queue and
  // sets them down at their own destination a fixed ride later — dwell events
  // with tags, exactly the ledger the real sim emits, so `mirrorRail` runs the
  // genuine article without a rail sim in the test.
  function fakeRailway(rideSec = 5) {
    const waiting: { station: string; dest: string; tag: string }[] = [];
    const riding: { dest: string; tag: string; due: number }[] = [];
    let now = 0;
    const port: TransitPort = {
      enqueue(station, dest, tag) {
        waiting.push({ station, dest, tag });
        return true;
      },
      connects: (a, b) => a !== b,
    };
    function events(dt: number): SimEvent[] {
      now += dt;
      const out: SimEvent[] = [];
      while (waiting.length) {
        const w = waiting.shift()!;
        out.push({
          type: "dwell",
          trainId: "ghost",
          tileId: w.station,
          boarded: 1,
          alighted: 0,
          boardedTags: [w.tag],
        });
        riding.push({ dest: w.dest, tag: w.tag, due: now + rideSec });
      }
      for (let i = riding.length - 1; i >= 0; i--) {
        if (riding[i].due <= now) {
          const r = riding.splice(i, 1)[0];
          out.push({
            type: "dwell",
            trainId: "ghost",
            tileId: r.dest,
            boarded: 0,
            alighted: 1,
            alightedTags: [r.tag],
          });
        }
      }
      return out;
    }
    return { port, events };
  }

  it("bikeParkTiles is its own constant — short, never the car's radius", () => {
    expect(DEFAULT_TUNING.bikeParkTiles).toBe(2);
  });

  it("a plain bike trip holds a stand through the working day and rides the SAME bike home", () => {
    const world = buildCitizenWorld(citizenbike.level, 7);
    const { port, calls } = mockDriving();
    const sim = createCitizenSim({ world, seed: 7, driving: port });

    // citizen id -> the bike trip standing in a rack for them.
    const held = new Map<string, string>();
    const heldSince = new Map<string, number>();
    let heldAcrossDwell = false;
    let rodeHomeSame = false;
    let homeAndGone = false;
    for (let t = 0; t < 130; t += 0.2) {
      sim.step(0.2);
      for (const c of sim.citizens()) {
        if (c.parkedBike) {
          if (!held.has(c.id)) {
            held.set(c.id, c.parkedBike.tripId);
            heldSince.set(c.id, t);
          }
          // The stand is owned by the CITIZEN's dwell, not a timer: still the
          // same bike in the same record long after any ambient stay.
          if (t - (heldSince.get(c.id) ?? t) > 20 && c.parkedBike.tripId === held.get(c.id)) {
            heldAcrossDwell = true;
          }
        }
        const trip = c.trip;
        if (
          trip?.mode === "bike" &&
          trip.carTrip &&
          trip.carTrip === held.get(c.id) &&
          trip.to === c.home
        ) {
          rodeHomeSame = true;
        }
        if (
          rodeHomeSame &&
          held.has(c.id) &&
          calls.resumes.some(r => r.id === held.get(c.id)) &&
          c.at === c.home &&
          !c.parkedBike &&
          !c.trip
        ) {
          homeAndGone = true;
        }
      }
    }
    // Dispatched as a bike, aiming at stands near the door with the bike's OWN
    // search radius — never the car's.
    const parkAsk = calls.requests.find(r => r.kind === "bike" && r.park);
    expect(parkAsk?.park?.searchTiles).toBe(DEFAULT_TUNING.bikeParkTiles);
    expect(parkAsk?.park?.permit).toBeUndefined();
    expect(heldAcrossDwell).toBe(true);
    expect(rodeHomeSame).toBe(true);
    expect(homeAndGone).toBe(true);
    // The ride home is to the SHED: no park ask on the bike's resume.
    for (const r of calls.resumes) {
      if (held.size && [...held.values()].includes(r.id)) expect(r.park).toBeNull();
    }
  });

  it("the wild park: park refused at dispatch, the bike still goes and is left leaning at the frontage", () => {
    const world = buildCitizenWorld(citizenbike.level, 7);
    const { port, calls } = mockDriving({ parkRefused: true });
    const sim = createCitizenSim({ world, seed: 7, driving: port });

    // plot id -> its frontage road tile, from the same world the sim reads.
    const frontage = new Map(world.plots.map(p => [p.id, p.roadTile]));
    let wildRecordRight = false;
    let peakWildStats = 0;
    let completedByBike = false;
    for (let t = 0; t < 130; t += 0.2) {
      sim.step(0.2);
      for (const c of sim.citizens()) {
        // The record is the bike now: wild-flagged, standing at the DESTINATION
        // plot's own frontage road tile, findable through the headless
        // observable and the stats count alike.
        if (c.parkedBike?.wild && c.parkedBike.at !== c.home) {
          if (c.parkedBike.tileId === frontage.get(c.parkedBike.at)) wildRecordRight = true;
          expect(
            sim.wildBikes().some(w => w.citizenId === c.id && w.tileId === c.parkedBike?.tileId)
          ).toBe(true);
        }
        if (c.recent.some(o => o.mode === "bike" && o.failed === null)) completedByBike = true;
      }
      peakWildStats = Math.max(peakWildStats, sim.stats().bikesWild);
    }
    // The fallback pair, findable in the call log: a park-asking bike dispatch
    // answered null, immediately retried WITHOUT the park ask — the ride still
    // happens; only the arrival changed.
    const i = calls.requests.findIndex(r => r.kind === "bike" && r.park);
    expect(i).toBeGreaterThanOrEqual(0);
    const retry = calls.requests[i + 1];
    expect(retry?.kind).toBe("bike");
    expect(retry?.park).toBeNull();
    expect(retry?.from).toBe(calls.requests[i].from);
    expect(retry?.to).toBe(calls.requests[i].to);
    // Bikes WERE left leaning — visibly, at the right tile — and the trips
    // still completed: slow, never strand.
    expect(wildRecordRight).toBe(true);
    expect(peakWildStats).toBeGreaterThan(0);
    expect(completedByBike).toBe(true);
  });

  it("the search seconds are charged to the journey, and rise with the clutter already there", () => {
    const world = buildCitizenWorld(citizenbike.level, 7);
    const { port } = mockDriving({ parkRefused: true });
    const sim = createCitizenSim({ world, seed: 7, driving: port });

    // Watch every bike trip's parking leg open: a wild park charges at least
    // the flat search, and later parks at an already-cluttered frontage charge
    // MORE — the crowd surcharge, derived from the standing count.
    const charges: { tileId: string; wildBefore: number; sec: number }[] = [];
    const seen = new Set<string>(); // citizen ids already counted this trip
    for (let t = 0; t < 130; t += 0.2) {
      const wildNow = new Map<string, number>();
      for (const w of sim.wildBikes()) {
        wildNow.set(w.tileId, (wildNow.get(w.tileId) ?? 0) + 1);
      }
      sim.step(0.2);
      for (const c of sim.citizens()) {
        const trip = c.trip;
        if (trip?.mode !== "bike" || trip.leg !== "parking") continue;
        const key = `${c.id}|${trip.startedAt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const tileId = c.parkedBike?.tileId;
        if (!tileId || !c.parkedBike?.wild) continue;
        charges.push({
          tileId,
          wildBefore: wildNow.get(tileId) ?? 0,
          sec: trip.legRemaining,
        });
      }
    }
    expect(charges.length).toBeGreaterThan(1);
    for (const ch of charges) {
      // Flat search at minimum, plus the crowd surcharge for AT LEAST the
      // bikes counted standing before the tick (another may have leant one in
      // the same tick, which only raises the true count), capped above.
      expect(ch.sec).toBeGreaterThanOrEqual(
        DEFAULT_TUNING.bikeSearchSec + Math.min(ch.wildBefore, 5) * 2 - 1e-9
      );
      expect(ch.sec).toBeLessThanOrEqual(DEFAULT_TUNING.bikeSearchSec + 10);
    }
    // The rise is real on this board: some charge strictly more than the flat
    // search because bikes were already leaning there.
    expect(charges.some(ch => ch.wildBefore > 0 && ch.sec > DEFAULT_TUNING.bikeSearchSec)).toBe(
      true
    );
  });

  it("the return leg mounts from the wild tile: a fresh bike from the frontage, the record cleared", () => {
    const world = buildCitizenWorld(citizenbike.level, 7);
    const { port, calls } = mockDriving({ parkRefused: true });
    const sim = createCitizenSim({ world, seed: 7, driving: port });

    // citizen -> the wild record they held (tile + stale trip id).
    const wild = new Map<string, { tripId: string; tileId: string }>();
    let rodeHomeFromWildTile = false;
    let homeRecordGone = false;
    for (let t = 0; t < 130; t += 0.2) {
      sim.step(0.2);
      for (const c of sim.citizens()) {
        if (c.parkedBike?.wild && !wild.has(c.id)) {
          wild.set(c.id, { tripId: c.parkedBike.tripId, tileId: c.parkedBike.tileId });
        }
        const mine = wild.get(c.id);
        if (!mine) continue;
        const trip = c.trip;
        // The ride home is a FRESH dispatch from the very tile the bike leans
        // on (the wild vehicle was retired on arrival, so there is nothing to
        // resume) — never a bike materialising anywhere else.
        if (
          trip?.mode === "bike" &&
          trip.to === c.home &&
          trip.carTrip &&
          trip.carTrip !== mine.tripId &&
          calls.requests.some(
            r => r.kind === "bike" && !r.park && r.from === mine.tileId && r.to !== mine.tileId
          )
        ) {
          rodeHomeFromWildTile = true;
        }
        if (rodeHomeFromWildTile && c.at === c.home && !c.trip && !c.parkedBike) {
          homeRecordGone = true;
        }
      }
    }
    expect(rodeHomeFromWildTile).toBe(true);
    // Home again with the record cleared — the leaning bike is off the board
    // the moment its owner takes it.
    expect(homeRecordGone).toBe(true);
    // ...and nothing ever resumed the retired wild vehicle: resume was tried
    // and refused (the mock only resumes parked trips), the fallback carried on.
    expect(calls.resumes.some(r => [...wild.values()].some(w => w.tripId === r.id))).toBe(false);
  });

  it("the quote prices the search only on the evidence of standing wild bikes — conservative by design", () => {
    const world = buildCitizenWorld(citizenbike.level, 7);
    const sim = createCitizenSim({
      world,
      seed: 7,
      driving: mockDriving({ parkRefused: true }).port,
    });
    // The SAME town, untouched: seeded identically, so every citizen and every
    // profile matches — the honest "before" for any quote, with zero wild
    // bikes standing anywhere.
    const fresh = createCitizenSim({ world, seed: 7 });

    // Let the town wild-park at its workplaces...
    for (let t = 0; t < 60; t += 0.2) sim.step(0.2);
    const wildByTile = new Map<string, number>();
    for (const w of sim.wildBikes()) {
      wildByTile.set(w.tileId, (wildByTile.get(w.tileId) ?? 0) + 1);
    }
    expect(wildByTile.size).toBeGreaterThan(0);

    // ...then price a ride TO a cluttered frontage for someone whose bike is
    // at hand, against the identical untouched town.
    let compared = 0;
    for (const plot of world.plots) {
      if (!plot.roadTile || !wildByTile.has(plot.roadTile)) continue;
      const count = wildByTile.get(plot.roadTile)!;
      for (const c of sim.citizens()) {
        if (!c.profile.bikeOwner || c.parkedBike || c.home === plot.id) continue;
        const after = (sim.quoteFor(c.id, c.home, plot.id) ?? []).find(q => q.mode === "bike");
        const before = (fresh.quoteFor(c.id, c.home, plot.id) ?? []).find(
          q => q.mode === "bike"
        );
        if (!after || !before || after.unavailable || before.unavailable) continue;
        // The surcharge is exactly the figure an arrival would be charged:
        // bikeSearchSec plus the capped crowd seconds for the standing count.
        expect(after.estimateSec - before.estimateSec).toBeCloseTo(
          DEFAULT_TUNING.bikeSearchSec + Math.min(count, 5) * 2,
          5
        );
        compared += 1;
        if (compared >= 3) break;
      }
      if (compared >= 3) break;
    }
    expect(compared).toBeGreaterThan(0);

    // Conservative: a frontage with NO wild bikes quotes exactly as the
    // untouched town does — the bike keeps its no-parking-cost edge until the
    // clutter is standing evidence.
    let cleanCompared = 0;
    for (const plot of world.plots) {
      if (!plot.roadTile || wildByTile.has(plot.roadTile)) continue;
      for (const c of sim.citizens()) {
        if (!c.profile.bikeOwner || c.parkedBike || c.home === plot.id) continue;
        const after = (sim.quoteFor(c.id, c.home, plot.id) ?? []).find(q => q.mode === "bike");
        const before = (fresh.quoteFor(c.id, c.home, plot.id) ?? []).find(
          q => q.mode === "bike"
        );
        if (!after || !before || after.unavailable || before.unavailable) continue;
        expect(after.estimateSec).toBeCloseTo(before.estimateSec, 5);
        cleanCompared += 1;
        break;
      }
      if (cleanCompared > 0) break;
    }
    expect(cleanCompared).toBeGreaterThan(0);
  });

  it("bikeSearchSec is its own dial — the bike's search, well under the car's", () => {
    expect(DEFAULT_TUNING.bikeSearchSec).toBe(15);
    expect(DEFAULT_TUNING.bikeSearchSec).toBeLessThan(DEFAULT_TUNING.parkSearchSec);
  });

  it("bike & ride: the racked bike is held all day and the return trip rides it home", () => {
    const world = buildCitizenWorld(citizenbike.level, 7);
    const { port, calls } = mockDriving();
    const rail = fakeRailway();
    const sim = createCitizenSim({ world, seed: 7, driving: port, transit: rail.port });

    // Watch the WEST trio of houses (0..2,2): out of the platform's walking
    // reach AND with no road east, so bike-and-ride is their only way to the
    // far town — out in the morning and, now, back on the same bike at night.
    const westHomes = new Set(["0,2", "1,2", "2,2"]);
    const held = new Map<string, string>(); // citizen -> racked bike trip
    let rackedAtStation = false;
    let heldThroughWork = false;
    let returnRodeSame = false;
    let roundTripDone = false;
    for (let t = 0; t < 130; t += 0.2) {
      sim.step(0.2, rail.events(0.2));
      for (const c of sim.citizens()) {
        if (!westHomes.has(c.home)) continue;
        if (c.parkedBike?.at === "5,0") {
          rackedAtStation = true;
          if (!held.has(c.id)) held.set(c.id, c.parkedBike.tripId);
          // Standing at their desk in the far town while the bike still holds
          // its stand at the boarding station's rack.
          if (!c.trip && c.work && c.at === c.work) heldThroughWork = true;
        }
        const trip = c.trip;
        if (
          trip?.mode === "bikeAndRide" &&
          trip.carTrip &&
          trip.carTrip === held.get(c.id) &&
          trip.to === c.home
        ) {
          returnRodeSame = true;
        }
        if (
          returnRodeSame &&
          held.has(c.id) &&
          c.at === c.home &&
          !c.trip &&
          !c.parkedBike &&
          c.recent.some(o => o.mode === "bikeAndRide" && o.failed === null)
        ) {
          roundTripDone = true;
        }
      }
    }
    expect(rackedAtStation).toBe(true);
    expect(heldThroughWork).toBe(true);
    expect(returnRodeSame).toBe(true);
    expect(roundTripDone).toBe(true);
    // The resume was the racked bike, released after the ride home ended.
    const heldIds = new Set(held.values());
    expect(calls.resumes.some(r => heldIds.has(r.id))).toBe(true);
  });

  itSlow("the bikeoverflow board: the mini-rack saturates and wild bikes lean at the gate, posed for drawing", async () => {
    // The scenario end to end, exactly as /test/bikeoverflow runs it: the
    // citizens mode's own setup, the real road sim underneath, ambient riders
    // competing for the six derived stands. The wild bikes must show up BOTH
    // as model records (stats/wildBikes — what the tests read) and as posed
    // renderer bodies (game.wildBikes — what the board draws), because the two
    // are one source and this is the pin that keeps them so.
    const game = createGame(
      bikeoverflow.level,
      [],
      200,
      bikeoverflow.mode!,
      1,
      undefined,
      bikeoverflow.traffic,
      bikeoverflow.id
    );
    let peakWild = 0;
    let posedMatchesModel = false;
    run(game, 360, () => {
      const bodies = game.wildBikes.length;
      if (bodies > peakWild) peakWild = bodies;
      if (bodies > 0 && bodies === game.citizenStats.bikesWild) {
        posedMatchesModel = true;
      }
    });
    // Several riders found every stand taken and left the bike leaning — the
    // clutter the board exists to show.
    expect(peakWild).toBeGreaterThanOrEqual(3);
    expect(posedMatchesModel).toBe(true);
  });

  itSlow("on the real road sim, the whole circle closes: rack stand claimed, held, resumed, retired", async () => {
    // No mocks: real bikes on the real street, the real rack registry under
    // them. The citizenbike board's rack sits two tiles from the workshop's
    // frontage — inside `bikeParkTiles` — so plain bike commuters rack there,
    // hold the stand all day, and ride the same vehicle home at night.
    const world = buildCitizenWorld(citizenbike.level, 7);
    const s = citizenbike.size!;
    const roadSim = createRoadSim({
      level: citizenbike.level,
      width: s.cols,
      height: s.rows,
      seed: 7,
      carSpeed: 0.5,
      carLength: 0.19,
      maxCars: 10,
    });
    const sim = createCitizenSim({
      world,
      seed: 7,
      driving: {
        request: (from, to, park, kind) =>
          roadSim.requestTrip(from, to, kind ?? "car", {
            park: !!park,
            permit: park?.permit,
            parkSearchTiles: park?.searchTiles,
          }),
        status: id => roadSim.tripStatus(id),
        parkedAt: id => roadSim.tripParkedAt(id),
        wantedSpace: id => roadSim.tripWantedSpace(id),
        resume: (id, to, park) =>
          roadSim.releaseTrip(id, to, {
            park: !!park,
            permit: park?.permit,
            parkSearchTiles: park?.searchTiles,
          }),
        abandon: id => roadSim.abandonTrip(id),
        release: id => roadSim.clearFinishedTrip(id),
      },
    });

    const held = new Map<string, string>();
    let standClaimed = false;
    let resumedHome = false;
    let retiredAtDoor = false;
    for (let i = 0; i < 600; i++) {
      roadSim.step(0.2, () => false);
      sim.step(0.2);
      for (const c of sim.citizens()) {
        if (c.parkedBike && !held.has(c.id)) held.set(c.id, c.parkedBike.tripId);
        const mine = held.get(c.id);
        if (!mine) continue;
        // The record's vehicle really is a bike standing in a real stall.
        if (!standClaimed) {
          const car = roadSim.cars().find(k => k.id === mine);
          if (car?.parked && car.kind === "bike") standClaimed = true;
        }
        if (c.trip?.carTrip === mine && c.trip.to === c.home) resumedHome = true;
        if (
          resumedHome &&
          c.at === c.home &&
          !c.trip &&
          !c.parkedBike &&
          !roadSim.cars().some(k => k.id === mine)
        ) {
          retiredAtDoor = true;
        }
      }
      if (retiredAtDoor) break;
    }
    expect(standClaimed).toBe(true);
    expect(resumedHome).toBe(true);
    expect(retiredAtDoor).toBe(true);
  });
});
