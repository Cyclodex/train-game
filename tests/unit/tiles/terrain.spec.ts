import { describe, it, expect, beforeEach } from "vitest";
import {
  _clearTerrainCache,
  canBuildOn,
  edgeBow,
  latticeOffset,
  patchPath,
  patchRimPath,
  terrainBlocksBuilding,
  terrainOf,
  tileGroundSvg,
  TERRAIN_KINDS,
} from "@/tiles/terrain";
import { TerrainNeighbours } from "@/tiles/terrain";

const around = (kind: TerrainNeighbours["top"]): TerrainNeighbours => ({
  top: kind,
  right: kind,
  bottom: kind,
  left: kind,
});

describe("terrain", () => {
  beforeEach(() => _clearTerrainCache());

  describe("terrainOf", () => {
    it("defaults to grass for a missing cell or an untagged one", () => {
      expect(terrainOf(undefined)).toBe("grass");
      expect(terrainOf(null)).toBe("grass");
      expect(terrainOf({ connections: [] })).toBe("grass");
    });

    it("reads the cell's kind when present", () => {
      expect(terrainOf({ connections: [], terrain: "water" })).toBe("water");
    });
  });

  describe("patch geometry", () => {
    const all = (v: boolean) => ({ top: v, right: v, bottom: v, left: v });

    it("bows every boundary of an isolated patch", () => {
      // Four quadratics = four shores. No straight edges, so nothing reads as a
      // square.
      expect(patchPath(all(false), 2, 3, 9).match(/Q/g)?.length).toBe(4);
    });

    it("keeps an internal join almost flat, and bulges it outward not inward", () => {
      // A tile in the middle of a lake has no shore of its own. Its edges are
      // still curves, but only by SEAM_OVERLAP and in the OUTWARD direction, so
      // neighbours overlap by a hair instead of abutting — an exact shared edge
      // leaves an antialiasing hairline. Measured on the top edge: its control
      // point must sit above the corners (smaller y), i.e. outside the tile.
      const c = patchPath(all(true), 2, 3, 9);
      const first = c.match(/Q([-\d.]+) ([-\d.]+)/);
      const start = c.match(/M([-\d.]+) ([-\d.]+)/);
      expect(first).not.toBeNull();
      expect(Number(first![2])).toBeLessThan(Number(start![2]));
    });

    it("bows the stopping edges far more than the internal ones", () => {
      const stopping = patchPath(all(false), 2, 3, 9);
      const internal = patchPath(all(true), 2, 3, 9);
      const spread = (d: string) => {
        const ys = [...d.matchAll(/[-\d.]+ ([-\d.]+)/g)].map(m => Number(m[1]));
        return Math.max(...ys) - Math.min(...ys);
      };
      expect(spread(stopping)).toBeGreaterThan(spread(internal));
    });

    it("bows every shore OUTWARD, never inward", () => {
      // THE shape rule. The bow used to be symmetric, so about half of every
      // patch's boundaries curved inward — and an inward shore is a pinch, which
      // turned a lake into a star instead of a rounded blob. Outward is NEGATIVE
      // here: the outline is wound clockwise (same convention as SEAM_OVERLAP).
      for (let gx = 0; gx < 14; gx++) {
        for (let gy = 0; gy < 14; gy++) {
          expect(edgeBow(gx, gy, gx + 1, gy, 7)).toBeLessThan(0);
          expect(edgeBow(gx, gy, gx, gy + 1, 7)).toBeLessThan(0);
        }
      }
    });

    it("varies how far each shore bulges, so the blob is not a circle", () => {
      // Outward-only fixes the pinching; a CONSTANT outward bow would trade it
      // for a lake with four identical arcs. The direction is pinned, the amount
      // is not.
      const bows = [];
      for (let gx = 0; gx < 24; gx++) bows.push(edgeBow(gx, 3, gx + 1, 3, 7));
      const min = Math.min(...bows);
      const max = Math.max(...bows);
      expect(max / min).toBeLessThan(0.6); // flattest shore < 60% of the fullest
    });

    it("bulges every boundary of an isolated patch beyond its corners", () => {
      // The geometric statement of the rule, measured on the real path: each
      // quadratic's control point must sit OUTSIDE the chord between the two
      // corners it spans — above the top edge, right of the right edge, and so
      // on. Reading it off the path is what catches a sign flip in bowedEdge.
      const d = patchPath(all(false), 2, 3, 9);
      const nums = [...d.matchAll(/[MQ]([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?/g)];
      const start = { x: Number(nums[0][1]), y: Number(nums[0][2]) };
      const seg = nums.slice(1).map(m => ({
        c: { x: Number(m[1]), y: Number(m[2]) },
        end: { x: Number(m[3]), y: Number(m[4]) },
      }));
      const corner = [start, ...seg.map(s => s.end)];
      // top: control above both corners; right: right of them; etc.
      expect(seg[0].c.y).toBeLessThan(Math.min(corner[0].y, corner[1].y));
      expect(seg[1].c.x).toBeGreaterThan(Math.max(corner[1].x, corner[2].x));
      expect(seg[2].c.y).toBeGreaterThan(Math.max(corner[2].y, corner[3].y));
      expect(seg[3].c.x).toBeLessThan(Math.min(corner[3].x, corner[0].x));
    });

    it("does not land on the tile grid — corners are nudged off it", () => {
      // The whole point of the jitter: if any corner sat exactly on 0 or 100 the
      // grid would still be legible through the art.
      const d = patchPath(all(false), 4, 1, 9);
      expect(d).not.toMatch(/(^|[ ,])(0\.0|100\.0)([ ,]|$)/);
    });
  });

  describe("neighbour agreement (why the seams stay shut)", () => {
    it("gives every tile touching a lattice point the same corner", () => {
      // The corner is seeded by the POINT, not by whoever is asking, so the four
      // tiles around it agree on where it moved to.
      const a = latticeOffset(5, 5, 3);
      const b = latticeOffset(5, 5, 3);
      expect(b).toEqual(a);
    });

    it("gives the two tiles either side of an edge the same bow", () => {
      // Canonicalised on the endpoint pair. Without this the tile on each side
      // would bow its shared boundary differently — a crack or an overlap along
      // every internal border.
      expect(edgeBow(4, 2, 5, 2, 11)).toBe(edgeBow(5, 2, 4, 2, 11));
      expect(edgeBow(2, 7, 2, 8, 11)).toBe(edgeBow(2, 8, 2, 7, 11));
    });

    it("still varies from edge to edge", () => {
      expect(edgeBow(4, 2, 5, 2, 11)).not.toBe(edgeBow(6, 2, 7, 2, 11));
    });
  });

  describe("patchRimPath", () => {
    const all = (v: boolean) => ({ top: v, right: v, bottom: v, left: v });

    it("draws no rim at all inside a patch", () => {
      // Regression: stroking the whole outline drew a bright line down every
      // shared edge, so a 2x2 lake read as four tiled ponds instead of one body.
      expect(patchRimPath(all(true), 1, 1, 5)).toBe("");
    });

    it("draws a rim only along the boundaries where the terrain stops", () => {
      // Water to the left only: that edge is an internal join and must carry no
      // shore; the other three do.
      const d = patchRimPath({ top: false, right: false, bottom: false, left: true }, 1, 1, 5);
      expect(d.split("M").filter(Boolean).length).toBe(3);
    });
  });

  describe("tileGroundSvg", () => {
    it("draws nothing for grass, so an untagged world looks untouched", () => {
      expect(tileGroundSvg("grass", "1,1", around("grass"))).toBe("");
    });

    it("draws something for every other kind", () => {
      for (const kind of TERRAIN_KINDS) {
        if (kind === "grass") continue;
        expect(tileGroundSvg(kind, "1,1", around("grass")).length).toBeGreaterThan(0);
      }
    });

    it("is deterministic across cache clears, not merely memoised", () => {
      const first = tileGroundSvg("forest", "3,4", around("grass"), 42);
      _clearTerrainCache();
      const second = tileGroundSvg("forest", "3,4", around("grass"), 42);
      expect(second).toBe(first);
    });

    it("gives different tiles different art", () => {
      const a = tileGroundSvg("forest", "3,4", around("grass"), 42);
      const b = tileGroundSvg("forest", "3,5", around("grass"), 42);
      expect(a).not.toBe(b);
    });

    it("changes with the world seed", () => {
      const a = tileGroundSvg("forest", "3,4", around("grass"), 1);
      const b = tileGroundSvg("forest", "3,4", around("grass"), 2);
      expect(a).not.toBe(b);
    });

    it("reacts to its neighbours, so a lake tile differs from a pond tile", () => {
      const alone = tileGroundSvg("water", "2,2", around("grass"), 7);
      const inLake = tileGroundSvg("water", "2,2", around("water"), 7);
      expect(inLake).not.toBe(alone);
    });

    it("scatters nothing onto the rails: no object sits on a tile edge", () => {
      // Objects are placed with a margin so a canopy never overhangs the tile
      // boundary a train runs through. Parse the placement transforms back out.
      // Every kind, not just forest: buildings and peaks are far bigger than a
      // tree and each carries its own placement band.
      let total = 0;
      for (const kind of TERRAIN_KINDS) {
        if (kind === "grass") continue;
        for (const coord of ["6,6", "2,9", "11,4"]) {
          const svg = tileGroundSvg(kind, coord, around(kind), 3);
          const coords = [...svg.matchAll(/translate\(([\d.]+) ([\d.]+)\)/g)];
          total += coords.length;
          for (const [, x, y] of coords) {
            expect(Number(x)).toBeGreaterThanOrEqual(10);
            expect(Number(x)).toBeLessThanOrEqual(90);
            expect(Number(y)).toBeGreaterThanOrEqual(10);
            expect(Number(y)).toBeLessThanOrEqual(90);
          }
        }
      }
      // Counted across the sweep, not per tile: a lone water tile may honestly
      // draw no lily pads at all (its scatter range starts at zero).
      expect(total).toBeGreaterThan(20);
    });
  });

  describe("mountain", () => {
    it("is a terrain kind of its own", () => {
      expect(TERRAIN_KINDS).toContain("mountain");
    });

    it("blocks building, like water and rock", () => {
      // A range is scenery you route AROUND, not scenery you fell. (A tunnel
      // will be an exception to this predicate, not a second rule — same as the
      // bridge over water.)
      expect(terrainBlocksBuilding("mountain")).toBe(true);
      expect(canBuildOn({ connections: [], terrain: "mountain" })).toBe(false);
    });

    it("does not look like rock", () => {
      // The two blocking grounds sit next to each other on real boards, so they
      // have to be tellable apart at a glance: different ground colour, and a
      // scatter that stands much taller.
      const rock = tileGroundSvg("rock", "3,3", around("rock"), 5);
      const mountain = tileGroundSvg("mountain", "3,3", around("mountain"), 5);
      expect(mountain).not.toBe(rock);
      const highest = (svg: string) =>
        Math.min(...[...svg.matchAll(/[ML]([-\d.]+) (-[\d.]+)/g)].map(m => Number(m[2])));
      expect(highest(mountain)).toBeLessThan(highest(rock) * 1.8);
    });

    it("fuses with its neighbours like every other patch", () => {
      // Nothing kind-specific about the outline: a range painted as an area has
      // to run full-bleed into the next mountain tile.
      expect(patchRimPath({ top: true, right: true, bottom: true, left: true }, 2, 2, 5)).toBe("");
      const alone = tileGroundSvg("mountain", "2,2", around("grass"), 5);
      const inRange = tileGroundSvg("mountain", "2,2", around("mountain"), 5);
      expect(inRange).not.toBe(alone);
    });
  });
});
