import { describe, it, expect, beforeEach } from "vitest";
import {
  _clearTerrainCache,
  patchPath,
  patchRimPath,
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

  describe("patchPath", () => {
    const all = (v: boolean) => ({ top: v, right: v, bottom: v, left: v });

    it("rounds every corner of an isolated patch", () => {
      // Four arcs = four rounded corners.
      expect(patchPath(all(false)).match(/A/g)?.length).toBe(4);
    });

    it("runs straight through when the terrain continues on all sides", () => {
      // A tile in the middle of a lake has no edge of its own to round off, so
      // neighbouring tiles fuse into one body with no seam.
      expect(patchPath(all(true))).not.toContain("A");
    });

    it("rounds a corner only when BOTH of its edges stop here", () => {
      // Terrain continues upward but not left: the top-left corner is where a
      // straight left edge meets a through-running top edge, so it stays square,
      // while the two corners on the bottom (nothing below, nothing left/right)
      // round off.
      const d = patchPath({ top: true, right: false, bottom: false, left: false });
      expect(d.match(/A/g)?.length).toBe(2);
    });
  });

  describe("patchRimPath", () => {
    const all = (v: boolean) => ({ top: v, right: v, bottom: v, left: v });

    it("draws no rim at all inside a patch", () => {
      // Regression: stroking the whole outline drew a bright line down every
      // shared edge, so a 2x2 lake read as four tiled ponds instead of one body.
      expect(patchRimPath(all(true))).toBe("");
    });

    it("draws a rim only along the edges where the terrain stops", () => {
      // Water to the left only: the left edge is an internal join and must carry
      // no shore; the other three do.
      const d = patchRimPath({ top: false, right: false, bottom: false, left: true });
      const segments = d.split("M").filter(Boolean);
      // 3 straight edges + the 2 corners that are still rounded (top-right,
      // bottom-right); the two left-hand corners are square because the patch
      // runs on through them.
      expect(segments.length).toBe(5);
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
      const svg = tileGroundSvg("forest", "6,6", around("forest"), 3);
      const coords = [...svg.matchAll(/translate\(([\d.]+) ([\d.]+)\)/g)];
      expect(coords.length).toBeGreaterThan(0);
      for (const [, x, y] of coords) {
        expect(Number(x)).toBeGreaterThanOrEqual(10);
        expect(Number(x)).toBeLessThanOrEqual(90);
        expect(Number(y)).toBeGreaterThanOrEqual(10);
        expect(Number(y)).toBeLessThanOrEqual(90);
      }
    });
  });
});
