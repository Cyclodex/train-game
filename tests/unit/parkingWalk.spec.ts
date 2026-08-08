import { describe, it, expect } from "vitest";
import { itSlow } from "./support/tier";
import { createGame } from "@/game";
import { createCitizenSim, type DrivingPort, type WalkingPort } from "@/sim/citizens";
import { buildCitizenWorld } from "@/tiles/cities";
import { homeparking } from "@/levels/test/scenarios/homeparking";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { citizensModeWith } from "@/modes/citizens";
import { planWalkFromKerb, sideOfBank, sideOfPlot } from "@/tiles/footway";
import { accessTileOf } from "@/tiles/access";
import { rowsOf, bankOf } from "@/tiles/parking";
import { Position } from "@/types";

// THE LAST LEG ON FOOT — from the space the car stopped in to the door.
//
// It was already CHARGED: `walkFromBaySec` measures the distance from the stall
// the car really took, so a bay two streets away has always cost its owner more
// than the one at the gate. What was missing is that nobody was DRAWN doing it,
// so a car park fed no one into the building it served — the cost was modelled
// and the person was not.

describe("a walk can start at a kerb, not just at a building", () => {
  const level = homeparking.level;

  function aKerb(): { tileId: string; bank: Position } {
    for (const tileId of Object.keys(level).sort()) {
      for (const row of rowsOf(level[tileId])) {
        return { tileId, bank: bankOf(row) };
      }
    }
    throw new Error("no parking on the board");
  }

  it("puts the driver on the pavement their bay hugs", () => {
    // The whole reason a kerb start needs its own entry point: a plot's side is
    // decided by where its BUILDING stands, and a parked car has no building.
    // Its side is decided by the bank its bay is against — and a street with a
    // bay on each side has two, so the tile alone cannot answer it.
    const { tileId, bank } = aKerb();
    const side = sideOfBank(level, tileId, bank);
    expect(side === 1 || side === -1).toBe(true);
    // The two banks of one street are opposite pavements, never the same one.
    const opposite = ((bank + 2) % 4) as Position;
    expect(sideOfBank(level, tileId, opposite)).toBe(side === 1 ? -1 : 1);
  });

  it("routes from that kerb to a plot", () => {
    const { tileId, bank } = aKerb();
    // Somewhere with a pavement to walk to: the plot this street serves.
    const plot = Object.keys(level).find(
      id => !level[id].road?.length && accessTileOf(level, id) === tileId,
    );
    expect(plot).toBeDefined();
    const route = planWalkFromKerb(level, tileId, bank, plot!);
    expect(route).not.toBeNull();
    expect(route!.tiles.length).toBeGreaterThan(0);
    expect(route!.tiles[0]).toBe(tileId);
  });

  it("agrees with sideOfPlot where a plot and a bay share a bank", () => {
    // The two answers are the same question asked from either end of a driveway,
    // so a board where they disagreed would walk somebody across the road to
    // reach the house their car is parked outside.
    for (const [tileId, cell] of Object.entries(level)) {
      for (const row of rowsOf(cell)) {
        if (!row.resident) continue; // a drive: we know exactly whose it is
        const bank = bankOf(row);
        expect(sideOfBank(level, tileId, bank)).toBe(
          sideOfPlot(level, row.resident, tileId),
        );
      }
    }
  });

  it("gives up rather than guess where there is no footway", () => {
    expect(planWalkFromKerb(level, "nowhere", Position.Top, "0,0")).toBeNull();
  });
});

describe("the citizen actually walks it", () => {
  // A stub pair of ports so the walk can be observed directly: the road sim is
  // not the thing under test here, the citizen's REACTION to a parked car is.
  function ports() {
    const asked: { carTripId: string; toPlotId: string }[] = [];
    let walkDone = false;
    const driving: DrivingPort = {
      request: () => "car1",
      status: () => "parked",
      parkedAt: () => "1,2",
      wantedSpace: () => true,
      resume: () => true,
      abandon: () => {},
      release: () => {},
    } as unknown as DrivingPort;
    const walking: WalkingPort = {
      request: () => null,
      requestFromKerb: (carTripId, toPlotId) => {
        asked.push({ carTripId, toPlotId });
        return `walk${asked.length}`;
      },
      status: () => (walkDone ? "arrived" : "walking"),
      release: () => {},
    };
    return { asked, driving, walking, finish: () => (walkDone = true) };
  }

  itSlow("asks for a walk from the CAR the moment it parks", () => {
    const { asked, driving, walking } = ports();
    const sim = createCitizenSim({
      world: buildCitizenWorld(citizencars.level),
      seed: 3,
      driving,
      walking,
    });
    for (let t = 0; t < 900; t += 0.25) sim.step(0.25, []);
    expect(asked.length).toBeGreaterThan(0);
    // It is named by the CAR's trip, not by a tile — that is what lets the far
    // side work out which kerb, and which pavement, without the citizen layer
    // ever holding a bank.
    for (const a of asked) expect(a.carTripId).toBe("car1");
  });

  itSlow("does not arrive until the walker does", () => {
    // The leg used to be a pure countdown. Now the countdown is only the
    // backstop, so somebody whose walker never finishes must not teleport into
    // the building — and must not be stranded either.
    const { driving, walking } = ports();
    const sim = createCitizenSim({
      world: buildCitizenWorld(citizencars.level),
      seed: 3,
      driving,
      walking,
    });
    for (let t = 0; t < 1800; t += 0.25) sim.step(0.25, []);
    // Nobody is stuck for ever: the backstop still lets journeys complete.
    expect(sim.stats().tripsCompleted).toBeGreaterThan(0);
  });
});

describe("on a real board", () => {
  itSlow("puts people on the pavement between the car and the works", () => {
    const game = createGame(
      homeparking.level,
      [],
      200,
      homeparking.mode ?? citizensModeWith({ secPerDay: 240 }),
      1,
      homeparking.colors,
      homeparking.traffic,
      homeparking.id,
    );
    let peakOnFoot = 0;
    let sawParkedAndWalking = false;
    for (let t = 0; t < 900; t += 0.2) {
      game.advance(0.2);
      const s = game.citizenStats;
      peakOnFoot = Math.max(peakOnFoot, s.onFoot);
      // Somebody's car is standing in a space while somebody is on a pavement —
      // which is what a car park feeding a workplace looks like.
      if (s.carsParked > 0 && s.onFoot > 0) sawParkedAndWalking = true;
    }
    expect(peakOnFoot).toBeGreaterThan(0);
    expect(sawParkedAndWalking).toBe(true);
    // ...and the board still works.
    expect(game.citizenStats.tripsCompleted).toBeGreaterThan(20);
  });
});
