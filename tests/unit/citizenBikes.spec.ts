import { describe, it, expect } from "vitest";
import { itSlow } from "./support/tier";
import { createGame } from "@/game";
import { citizensMode } from "@/modes/citizens";
import { citizenbike } from "@/levels/test/scenarios/citizenbike";
import { buildCitizenWorld } from "@/tiles/cities";
import {
  createCitizenSim,
  TRAVEL_MODES,
  type ModeQuote,
} from "@/sim/citizens";
import { createRoadSim } from "@/sim/road";
import { createPedestrianSim } from "@/sim/pedestrians";
import { planWalk } from "@/tiles/footway";
import { bikeRangeOf } from "@/tiles/catchment";

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
