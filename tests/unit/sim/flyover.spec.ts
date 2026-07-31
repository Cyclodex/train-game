import { describe, it, expect } from "vitest";
import { createSimulation } from "@/sim/simulation";
import { Position } from "@/types";
import { TileCell, claimKey, claimKeysOf, tileIdOfClaim } from "@/tiles/model";
import { flyover } from "@/levels/test/scenarios/flyover";

const { Top, Right, Bottom, Left } = Position;

// The sim contract behind the flyover scenario: a grade-separated crossing is
// TWO pieces of track as far as contention goes. Runs on the scenario's own
// board (imported), so a change to the board fails here rather than silently
// making the demo undemonstrative.
function simOf(level = flyover.level) {
  return createSimulation({
    level,
    // Destination colours pinned so both trains PARK (a mismatched depot
    // bounces, which reads as "the crossing broke" — the classic test trap).
    depotColors: {
      "0,2": "blue",
      "6,2": "green",
      "3,0": "yellow",
      "3,4": "red",
    },
    trains: [
      {
        id: "east",
        coord: { x: 0, y: 2 },
        entryPort: Position.Center,
        color: "green",
        type: "people",
        wagonCount: 2,
        speed: 1,
      },
      {
        id: "south",
        coord: { x: 3, y: 0 },
        entryPort: Position.Center,
        color: "red",
        type: "people",
        wagonCount: 2,
        speed: 1,
      },
    ],
  });
}

// The same board with the crossing FLAT: identical topology, no deck.
function flatLevel(): Record<string, TileCell> {
  const level = { ...flyover.level };
  const { flyover: _drop, ...cross } = level["3,2"];
  level["3,2"] = cross;
  return level;
}

function run(sim: ReturnType<typeof simOf>, ticks: number) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...sim.step(0.1));
  return events;
}

describe("claim keys (tiles/model)", () => {
  const cross: TileCell = {
    connections: [
      [Left, Right],
      [Top, Bottom],
    ],
    flyover: [Top, Bottom],
  };

  it("keys each level of a flyover separately, and plain tiles by id", () => {
    expect(claimKey(cross, "3,2", Top)).toBe("3,2#over");
    expect(claimKey(cross, "3,2", Bottom)).toBe("3,2#over");
    expect(claimKey(cross, "3,2", Left)).toBe("3,2#under");
    expect(claimKey(cross, "3,2", Right)).toBe("3,2#under");
    expect(claimKey({ connections: [[Left, Right]] }, "1,1", Left)).toBe("1,1");
    expect(claimKey(undefined, "9,9", Top)).toBe("9,9");
  });

  it("round-trips through tileIdOfClaim and enumerates via claimKeysOf", () => {
    expect(tileIdOfClaim("3,2#over")).toBe("3,2");
    expect(tileIdOfClaim("3,2")).toBe("3,2");
    expect(claimKeysOf("3,2")).toContain("3,2#over");
    expect(claimKeysOf("3,2")).toContain("3,2#under");
  });

  it("falls back to whole-tile conflict for a switchable (multi-partner) entry", () => {
    // A junction's lines DO interact; a flyover flag on one must not split it.
    const junction: TileCell = {
      connections: [
        [Left, Right],
        [Left, Bottom],
        [Top, Bottom],
      ],
      flyover: [Top, Bottom],
    };
    expect(claimKey(junction, "3,2", Left)).toBe("3,2");
  });
});

describe("the flyover crossing (sim contract of /test/flyover)", () => {
  it("lets both trains cross at once — neither is ever blocked", () => {
    const sim = simOf();
    const events = run(sim, 120);
    expect(events.filter(e => e.type === "blocked")).toEqual([]);
    expect(sim.trainState("east")).toBe("parked");
    expect(sim.trainState("south")).toBe("parked");
    // Both delivered to a matching depot — nobody bounced.
    const arrivals = events.filter(e => e.type === "arrived");
    expect(arrivals.every(a => (a as { matched: boolean }).matched)).toBe(true);
  });

  it("both trains' reservations coexist across the shared cell", () => {
    const sim = simOf();
    // A route is claimed at the first BOUNDARY CROSSING, not at departure —
    // two seconds in, both trains have left their depot tile and claimed their
    // unsignalled route to the far depot, INCLUDING their own level of 3,2. On
    // a flat crossing one claim would exclude the other for the whole run.
    run(sim, 20);
    expect(sim.reservedBy("3,2")).toBeDefined();
    // The by-tile query answers for either level; the per-level truth is that
    // both levels are spoken for by different trains.
    const holders = new Set(["east", "south"]);
    expect(holders.has(sim.reservedBy("3,2")!)).toBe(true);
    expect(sim.occupiedBy("0,2")).toBe("east");
    expect(sim.occupiedBy("3,0")).toBe("south");
  });

  it("the SAME board flat serialises the crossing instead", () => {
    const sim = simOf(flatLevel());
    const events = run(sim, 120);
    // One train's whole-route reservation holds the other at its depot door:
    // the contrast that shows the claim keys are doing the separating above.
    const blocked = events.filter(e => e.type === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    expect((blocked[0] as { reason: string }).reason).toBe("reservation");
  });
});
