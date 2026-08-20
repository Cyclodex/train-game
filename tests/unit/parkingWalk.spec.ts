import { describe, it, expect } from "vitest";
import { itSlow } from "./support/tier";
import { createGame } from "@/game";
import { createCitizenSim, type DrivingPort, type WalkingPort } from "@/sim/citizens";
import { buildCitizenWorld } from "@/tiles/cities";
import { homeparking } from "@/levels/test/scenarios/homeparking";
import { workparking } from "@/levels/test/scenarios/workparking";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { citizensModeWith } from "@/modes/citizens";
import {
  planWalkFromKerb,
  sideOfBank,
  sideOfPlot,
  pavementOffsetEndsFor,
  hasFootway,
  roadHalfUnits,
  roadThrough,
  PAVEMENT_WIDTH,
} from "@/tiles/footway";
import { accessTileOf } from "@/tiles/access";
import {
  rowsOf,
  bankOf,
  bayNearPx,
  kerbOffsetAt,
  stallDepthPx,
  turnsInAcrossKerb,
  needsBigBay,
} from "@/tiles/parking";
import { twoWay } from "@/tiles/lanes";
import { laneSegmentPointAt } from "@/sim/pathGeometry";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { parseCoordId, type Level } from "@/tiles/model";
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

describe("the street cross-section: who is behind whom", () => {
  // docs/superpowers/specs/2026-08-20-street-cross-section-design.md:
  //
  //   carriageway → kerbside parking → PAVEMENT → across-kerb parking → plot
  //
  // ALONG the kerb (parallel) is street furniture: the pavement runs behind it.
  // ACROSS the kerb (a drive, a forecourt) is property access: the pavement
  // runs in front of it and the CAR crosses the pavement — never the pedestrian
  // the parking.

  function bandAt(level: Level, tileId: string, side: 1 | -1) {
    const cell = level[tileId];
    const through = roadThrough(cell)!;
    const ends = pavementOffsetEndsFor(level, tileId, side, through.from, through.to);
    return {
      inner: Math.min(Math.abs(ends.offEntry), Math.abs(ends.offExit)) - PAVEMENT_WIDTH / 2,
      outer: Math.max(Math.abs(ends.offEntry), Math.abs(ends.offExit)) + PAVEMENT_WIDTH / 2,
    };
  }

  it("keeps the pavement clear of every KERBSIDE bay", () => {
    const level = homeparking.level;
    for (const [tileId, cell] of Object.entries(level)) {
      const coord = parseCoordId(tileId);
      for (const row of rowsOf(cell)) {
        if (row.kind !== "parallel") continue;
        const side = sideOfBank(level, tileId, bankOf(row));
        if (side === null) continue;
        const bayOuter =
          (kerbOffsetAt(level, coord, row.from, 200) +
            stallDepthPx(row.kind, 200, needsBigBay(row.reserved))) /
          2;
        expect(
          bandAt(level, tileId, side).inner,
          `pavement runs through the ${row.kind} bay on ${tileId}`,
        ).toBeGreaterThanOrEqual(bayOuter);
      }
    }
  });

  it("keeps every ACROSS-KERB rank behind the pavement instead", () => {
    // A drive does not move the pavement — the car crosses it. So the bay's
    // NEAR edge must clear the band's outer edge, which is the opposite
    // inequality to the kerbside case, and the pair of them is the whole rule.
    const level = homeparking.level;
    let drives = 0;
    for (const [tileId, cell] of Object.entries(level)) {
      const coord = parseCoordId(tileId);
      for (const row of rowsOf(cell)) {
        if (!turnsInAcrossKerb(row.kind)) continue;
        drives++;
        const side = sideOfBank(level, tileId, bankOf(row));
        if (side === null) continue;
        const bayInner =
          bayNearPx(row, 200, kerbOffsetAt(level, coord, row.from, 200)) / 2;
        expect(
          bandAt(level, tileId, side).outer,
          `the ${row.kind} rank on ${tileId} sits under the pavement`,
        ).toBeLessThanOrEqual(bayInner);
      }
    }
    expect(drives).toBeGreaterThan(0);
  });

  it("is one CONNECTED line — both tiles agree wherever it crosses a seam", () => {
    // The failure this replaces: a per-tile outset put a parking tile's band 13
    // units further out than its neighbour's, so the pavement broke into
    // disconnected segments and the walkers teleported sideways at every seam.
    // This samples the actual walker geometry (the same two-offset call the
    // pedestrians make) at t=1 on one tile and t=0 on the next, and demands the
    // physical points coincide.
    for (const scenario of [homeparking, workparking]) {
      const level = scenario.level;
      for (const [tileId, cell] of Object.entries(level)) {
        if (!hasFootway(cell)) continue;
        const through = roadThrough(cell);
        if (!through) continue;
        const exitPort = through.to;
        const coord = parseCoordId(tileId);
        const n = neighborCoord(coord, exitPort);
        if (!n) continue;
        const nId = `${n.x},${n.y}`;
        const nCell = level[nId];
        if (!hasFootway(nCell)) continue;
        const nThrough = roadThrough(nCell);
        if (!nThrough) continue;
        // Orient the neighbour's traversal to ENTER through the shared seam.
        const back = oppositePort(exitPort);
        let nEntry: Position;
        let nExit: Position;
        if (nThrough.from === back) [nEntry, nExit] = [nThrough.from, nThrough.to];
        else if (nThrough.to === back) [nEntry, nExit] = [nThrough.to, nThrough.from];
        else continue; // roads do not actually join at this seam
        const pointsOf = (
          id: string,
          entry: Position,
          exit: Position,
          t: number,
        ): { x: number; y: number }[] => {
          const { x, y } = parseCoordId(id);
          return ([1, -1] as (1 | -1)[]).map(side => {
            const e = pavementOffsetEndsFor(level, id, side, entry, exit);
            const pt = laneSegmentPointAt(entry, exit, 1, e.offEntry / 100, e.offExit / 100, t);
            return { x: x + pt.x, y: y + pt.y };
          });
        };
        const ours = pointsOf(tileId, through.from, through.to, 1);
        const theirs = pointsOf(nId, nEntry, nExit, 0);
        for (const p of ours) {
          const met = theirs.some(q => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6);
          expect(met, `pavement breaks at the ${tileId}→${nId} seam of ${scenario.id}`).toBe(true);
        }
      }
    }
  });

  it("moves only the bank that HAS the kerbside parking", () => {
    // A street with marked bays on one side and nothing on the other has two
    // pavements at two distances; pushing both out by the wider of them would
    // leave the empty side's band floating in the verge.
    const level: Level = {
      "0,1": { connections: [], road: twoWay(Position.Left, Position.Right), terrain: "urban" },
      "2,1": { connections: [], road: twoWay(Position.Left, Position.Right), terrain: "urban" },
      "1,1": {
        connections: [],
        road: twoWay(Position.Left, Position.Right),
        terrain: "urban",
        parking: {
          rows: [{ from: Position.Left, side: "right", kind: "parallel", count: 3 }],
        },
      },
    };
    const plain = roadHalfUnits(level["1,1"]) + 8; // gap + half the band
    const south = pavementOffsetEndsFor(level, "1,1", 1, Position.Left, Position.Right);
    const north = pavementOffsetEndsFor(level, "1,1", -1, Position.Left, Position.Right);
    expect(Math.abs(south.offEntry)).toBeGreaterThan(plain);
    expect(Math.abs(north.offEntry)).toBe(plain);
  });

  it("keeps the band on its own tile however deep the bay", () => {
    // A lorry lay-by is 55 units deep on its own, which would put the pavement
    // half a tile into the neighbour's ground.
    const level: Level = {
      "1,1": {
        connections: [],
        road: twoWay(Position.Left, Position.Right),
        terrain: "urban",
        parking: {
          rows: [
            { from: Position.Left, side: "right", kind: "parallel", count: 1, reserved: "long" },
          ],
        },
      },
    };
    const e = pavementOffsetEndsFor(level, "1,1", 1, Position.Left, Position.Right);
    expect(Math.abs(e.offEntry) + PAVEMENT_WIDTH / 2).toBeLessThanOrEqual(50);
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
