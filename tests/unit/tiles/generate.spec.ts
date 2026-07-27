import { describe, it, expect } from "vitest";
import { generateLevel } from "@/tiles/generate";
import { validateLevel } from "@/tiles/validate";
import { Level } from "@/tiles/model";
import { terrainBlocksBuilding } from "@/tiles/terrain";

describe("generateLevel", () => {
  it("always produces a level that passes validation", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { level, routes } = generateLevel(seed, {
        width: 7,
        height: 6,
        depotPairs: 2,
      });
      const res = validateLevel(level, routes);
      expect(res.ok, `seed ${seed}: ${JSON.stringify(res.issues)}`).toBe(true);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = generateLevel(42, { width: 8, height: 6, depotPairs: 2 });
    const b = generateLevel(42, { width: 8, height: 6, depotPairs: 2 });
    expect(b).toEqual(a);
  });

  it("places the requested number of paired depots and routes", () => {
    const { depots, routes } = generateLevel(3, {
      width: 9,
      height: 7,
      depotPairs: 2,
    });
    expect(depots.length).toBeGreaterThanOrEqual(4);
    expect(depots.length % 2).toBe(0);
    expect(routes.length).toBe(depots.length / 2);
  });

  it("varies across seeds", () => {
    const a = generateLevel(1, { width: 8, height: 6, depotPairs: 2 });
    const differs = [2, 3, 4, 5].some(
      s =>
        JSON.stringify(generateLevel(s, { width: 8, height: 6, depotPairs: 2 })) !==
        JSON.stringify(a)
    );
    expect(differs).toBe(true);
  });

  describe("terrain", () => {
    const OPTS = { width: 9, height: 7, depotPairs: 2 };
    const builtCells = (level: Level) =>
      Object.fromEntries(
        Object.entries(level).filter(([, c]) => c.connections.length > 0),
      );

    // THE load-bearing test. Terrain draws from its own rng stream, so the
    // TOPOLOGY of every seed must be byte-identical with and without it.
    // Comparing `{terrain:false}` against itself would be tautological; this
    // compares the real output, terrain cells stripped, against the real
    // output of a generator that never painted any. It fails loudly if a stray
    // draw ever creeps into the shared stream ahead of the depot shuffle.
    it("does not disturb the topology of any seed", () => {
      for (let seed = 1; seed <= 30; seed++) {
        const withT = generateLevel(seed, OPTS);
        const without = generateLevel(seed, { ...OPTS, terrain: false });
        expect(builtCells(withT.level), `seed ${seed}`).toEqual(without.level);
        expect(withT.depots, `seed ${seed}`).toEqual(without.depots);
        expect(withT.routes, `seed ${seed}`).toEqual(without.routes);
      }
    });

    // The safety property, as CI rather than as an argument in a comment.
    it("does not change the validator's verdict", () => {
      for (let seed = 1; seed <= 30; seed++) {
        const withT = generateLevel(seed, OPTS);
        const without = generateLevel(seed, { ...OPTS, terrain: false });
        expect(
          validateLevel(withT.level, withT.routes),
          `seed ${seed}`,
        ).toEqual(validateLevel(without.level, without.routes));
      }
    });

    it("paints only cells the generator left empty", () => {
      for (let seed = 1; seed <= 20; seed++) {
        const { level } = generateLevel(seed, OPTS);
        for (const [id, cell] of Object.entries(level)) {
          if (cell.terrain === undefined) continue;
          expect(cell.connections, `${seed} @ ${id}`).toHaveLength(0);
          expect(cell.role, `${seed} @ ${id}`).toBeUndefined();
        }
      }
    });

    it("never stores grass, which is the absence of terrain", () => {
      for (let seed = 1; seed <= 20; seed++) {
        const { level } = generateLevel(seed, OPTS);
        for (const cell of Object.values(level)) {
          expect(cell.terrain).not.toBe("grass");
        }
      }
    });

    it("leaves every depot an unblocked neighbour to build from", () => {
      // A depot ringed by water or rock is legal but can never be extended by
      // the build tool, which reads as a bug rather than as terrain.
      for (let seed = 1; seed <= 20; seed++) {
        const { level, depots } = generateLevel(seed, OPTS);
        for (const id of depots) {
          const [x, y] = id.split(",").map(Number);
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const n = level[`${x + dx},${y + dy}`];
            if (!n?.terrain) continue;
            expect(
              terrainBlocksBuilding(n.terrain),
              `seed ${seed}: depot ${id} blocked by ${n.terrain}`,
            ).toBe(false);
          }
        }
      }
    });

    it("actually paints something", () => {
      const { level } = generateLevel(7, OPTS);
      const painted = Object.values(level).filter(c => c.terrain).length;
      expect(painted).toBeGreaterThan(3);
    });

    // The lake goes INSIDE the ring, which is the one place the loop provably
    // never runs — so it needs a ring with an inside. A 7x6 board (what Daily
    // generates) encloses about six cells, most of them next to a depot spur,
    // and correctly comes out with no water at all; a 10x8 has room.
    it("fills a big board's ring with water, and leaves a small one dry", () => {
      const waterIn = (w: number, h: number, seed: number) => {
        const { level } = generateLevel(seed, {
          width: w,
          height: h,
          depotPairs: 3,
        });
        return Object.values(level).filter(c => c.terrain === "water").length;
      };
      expect(waterIn(10, 8, 20260615)).toBeGreaterThan(0);
      expect(waterIn(7, 6, 20260615)).toBe(0);
    });

    it("gives cells their own object, not a shared reference", () => {
      // A shared literal would make one in-play edit mutate the whole lake.
      const { level } = generateLevel(11, OPTS);
      const water = Object.values(level).filter(c => c.terrain === "water");
      const unique = new Set(water);
      expect(unique.size).toBe(water.length);
    });
  });
});
