import { describe, it, expect, beforeEach } from "vitest";
import {
  _clearTerrainCache,
  canBuildOn,
  cellCorridors,
  corridorsFor,
  edgeBow,
  latticeOffset,
  patchOutlinePolygon,
  patchPath,
  patchRimPath,
  pointInPolygon,
  terrainBlocksBuilding,
  terrainOf,
  tileCanopySvg,
  tileGroundSvg,
  TERRAIN_KINDS,
} from "@/tiles/terrain";
import { TerrainNeighbours } from "@/tiles/terrain";
import { TileCell } from "@/tiles/model";
import { Position } from "@/types";

const around = (kind: TerrainNeighbours["top"]): TerrainNeighbours => ({
  top: kind,
  right: kind,
  bottom: kind,
  left: kind,
  topLeft: kind,
  topRight: kind,
  bottomRight: kind,
  bottomLeft: kind,
});

interface Pt {
  x: number;
  y: number;
}
interface Seg {
  start: Pt;
  c1: Pt;
  c2: Pt;
  end: Pt;
}

/** The cubic segments of a patch outline, in clockwise order from the top. */
function parsePath(d: string): Seg[] {
  const m = d.match(/M([-\d.]+) ([-\d.]+)/)!;
  let cursor: Pt = { x: Number(m[1]), y: Number(m[2]) };
  const segs: Seg[] = [];
  for (const c of d.matchAll(
    /C([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)/g,
  )) {
    const n = c.slice(1).map(Number);
    const end = { x: n[4], y: n[5] };
    segs.push({ start: cursor, c1: { x: n[0], y: n[1] }, c2: { x: n[2], y: n[3] }, end });
    cursor = end;
  }
  return segs;
}

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
      // Four cubics = four shores. No straight edges, so nothing reads as a
      // square. Cubics rather than quadratics because only a cubic lets both
      // ends of a shore choose their tangent — see the seam tests below.
      expect(patchPath(all(false), 2, 3, 9).match(/C/g)?.length).toBe(4);
    });

    it("keeps an internal join almost flat, and bulges it outward not inward", () => {
      // A tile in the middle of a lake has no shore of its own. Its edges are
      // still curves, but only by SEAM_OVERLAP and in the OUTWARD direction, so
      // neighbours overlap by a hair instead of abutting — an exact shared edge
      // leaves an antialiasing hairline. Measured on the top edge: its control
      // point must sit above the corners (smaller y), i.e. outside the tile.
      const c = patchPath(all(true), 2, 3, 9);
      const first = c.match(/C([-\d.]+) ([-\d.]+)/);
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
      // The geometric statement of the rule, measured on the real path: every
      // control point must sit OUTSIDE the chord between the two corners it
      // spans. The outline is wound clockwise, so "outside" is a NEGATIVE cross
      // product of (chord x offset) — which is what catches a sign flip.
      const segs = parsePath(patchPath(all(false), 2, 3, 9));
      expect(segs).toHaveLength(4);
      for (const s of segs) {
        for (const c of [s.c1, s.c2]) {
          const chord = { x: s.end.x - s.start.x, y: s.end.y - s.start.y };
          const off = { x: c.x - s.start.x, y: c.y - s.start.y };
          expect(chord.x * off.y - chord.y * off.x).toBeLessThan(0);
        }
      }
    });

    it("does not land on the tile grid — corners are nudged off it", () => {
      // The whole point of the jitter: if any corner sat exactly on 0 or 100 the
      // grid would still be legible through the art.
      const d = patchPath(all(false), 4, 1, 9);
      expect(d).not.toMatch(/(^|[ ,])(0\.0|100\.0)([ ,]|$)/);
    });

    it("pulls a real corner deep inside the tile, off the bounding box", () => {
      // The rectangle-silhouette fix. Outward bows alone still left every real
      // corner sitting ON the corner of the authored bounding box, so a 3x2
      // lake was a rectangle with wavy edges. A corner-role point now sits a
      // CORNER_INSET (>= 14 units, along the diagonal) inside the jittered
      // lattice point it used to sit on — for every seed, not just a lucky one.
      for (const seed of [1, 3, 7, 9, 42]) {
        for (const [gx, gy] of [
          [0, 0],
          [2, 3],
          [5, 1],
        ]) {
          const segs = parsePath(patchPath(all(false), gx, gy, seed));
          const { dx, dy } = latticeOffset(gx, gy, seed);
          // Corner 0 (the M point): its distance along the inward diagonal from
          // the bare jittered lattice point is the inset times sqrt(2).
          expect(segs[0].start.x + segs[0].start.y).toBeGreaterThan(dx + dy + 15);
        }
      }
    });

    it("covers meaningfully less than the tile square when it stands alone", () => {
      // The silhouette property itself, pinned by area: a lone patch is a blob,
      // not a rounded square. Its outline covers well under the full tile (the
      // corners are ceded) but still most of it (it is a pond, not a puddle).
      // An interior tile stays near-full — the cut is a corner phenomenon; the
      // few percent an interior tile "loses" to its jittered shared chords is
      // covered by the neighbour that shares each chord.
      const coverage = (same: Parameters<typeof patchOutlinePolygon>[0], seed: number) => {
        const poly = patchOutlinePolygon(same, 2, 3, seed);
        const steps = 40;
        let inside = 0;
        for (let i = 0; i < steps; i++) {
          for (let j = 0; j < steps; j++) {
            const p = { x: ((i + 0.5) * 100) / steps, y: ((j + 0.5) * 100) / steps };
            if (pointInPolygon(p, poly)) inside++;
          }
        }
        return inside / (steps * steps);
      };
      for (const seed of [1, 2, 3, 5, 8, 13, 42, 99]) {
        const lone = coverage(all(false), seed);
        expect(lone).toBeLessThan(0.85);
        expect(lone).toBeGreaterThan(0.55);
      }
      for (const seed of [1, 9, 42]) {
        expect(coverage(all(true), seed)).toBeGreaterThan(0.88);
      }
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

    // A shore that runs on into the next tile has to leave one tile and enter
    // the next along ONE line. It did not: each edge bowed off its own chord, so
    // the outline arrived at the shared corner ~24 degrees off and left it ~24
    // degrees the other way — a sharp inward V at every tile boundary. On a 3x2
    // lake you could count the tiles down the shoreline, which is the tile grid
    // drawn back onto the water: exactly what the jittered outline exists to
    // hide. Pinned here by measuring the tangents on both sides.
    const world = (tx: number, ty: number, p: { x: number; y: number }) => ({
      x: tx * 100 + p.x,
      y: ty * 100 + p.y,
    });
    // The path is written to one decimal, so two points derived from it can
    // legitimately differ by 0.1 — a tenth of a unit on a 100-unit tile, three
    // orders of magnitude below the ~24-degree kink this is here to catch.
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(0.11);
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(0.11);
    };

    it("joins a shore that runs on into the next tile without a kink", () => {
      // Two water tiles side by side, grass all around: one shore running west
      // to east across the top of both.
      const west = parsePath(
        patchPath({ top: false, right: true, bottom: false, left: false }, 2, 3, 9),
      );
      const east = parsePath(
        patchPath({ top: false, right: false, bottom: false, left: true }, 3, 3, 9),
      );
      // Same corner: the end of the west tile's top shore IS the start of the
      // east tile's.
      near(world(2, 3, west[0].end), world(3, 3, east[0].start));
      // Same tangent through it: arriving direction == leaving direction.
      const arrive = { x: west[0].end.x - west[0].c2.x, y: west[0].end.y - west[0].c2.y };
      const leave = { x: east[0].c1.x - east[0].start.x, y: east[0].c1.y - east[0].start.y };
      near(arrive, leave);
    });

    it("smooths a running shore by lifting the corner off the lattice", () => {
      // The other half of the fix: the shared point is pushed OUTWARD too, so
      // the shore never comes back to touch the straight grid line. Compare the
      // mid-shore corner with the bare jittered lattice point it would sit on.
      const run = parsePath(
        patchPath({ top: false, right: true, bottom: false, left: false }, 2, 3, 9),
      );
      const { dy } = latticeOffset(3, 3, 9);
      expect(run[0].end.y).toBeLessThan(dy - 3); // above the lattice = outward
    });

    it("leaves the inside corner of an L on the lattice, so both arms agree", () => {
      // The reflex corner of an L-shaped wood: forest at 0,0 / 1,0 / 0,1. The
      // boundary TURNS around 1,1 — the two tiles meeting there run at right
      // angles, so smoothing it would push one arm north and the other east and
      // tear the patch open. Both must leave it exactly on the lattice point.
      const top = parsePath(
        patchPath(
          { top: false, right: false, bottom: false, left: true, bottomLeft: true },
          1,
          0,
          9,
        ),
      );
      const side = parsePath(
        patchPath(
          { top: true, right: false, bottom: false, left: false, topRight: true },
          0,
          1,
          9,
        ),
      );
      // Corner 3 (end of the bottom shore) vs corner 1 (end of the top shore).
      near(world(1, 0, top[2].end), world(0, 1, side[0].end));
      const { dx, dy } = latticeOffset(1, 1, 9);
      near(world(1, 0, top[2].end), { x: 100 + dx, y: 100 + dy });
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

    it("keeps every placed object standing ON the patch, not on ceded ground", () => {
      // With real corners cutting deep into the tile (see CORNER_INSET), the
      // per-kind placement bands alone no longer keep an object on its own
      // ground: a band-legal position in a corner would put a tree on the lawn
      // or a lily pad on the shore. Lone tiles are the worst case — all four
      // corners are cut.
      const alone = { top: false, right: false, bottom: false, left: false };
      for (const kind of TERRAIN_KINDS) {
        if (kind === "grass") continue;
        for (const coord of ["6,6", "2,9", "11,4"]) {
          const svg = tileGroundSvg(kind, coord, around("grass"), 3);
          const [x, y] = coord.split(",").map(Number);
          const poly = patchOutlinePolygon(alone, x, y, 3);
          for (const [, px, py] of svg.matchAll(/translate\(([\d.]+) ([\d.]+)\)/g)) {
            expect(pointInPolygon({ x: Number(px), y: Number(py) }, poly)).toBe(true);
          }
        }
      }
    });
  });

  describe("keep-out corridors", () => {
    const straight: TileCell = {
      connections: [[Position.Left, Position.Right]],
    };
    const translates = (svg: string) =>
      [...svg.matchAll(/translate\(([\d.]+) ([\d.]+)\)/g)].map(m => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));

    it("derives a rail corridor from a connection", () => {
      const cs = cellCorridors(straight);
      expect(cs).toHaveLength(1);
      expect(cs[0].pts).toEqual([
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ]);
    });

    it("keeps every ground object and mark clear of the line", () => {
      // A W-E straight runs along y=50. Nothing on the GROUND layer — trees,
      // buildings, boulders, paving, gardens, scree — may put its footprint on
      // the corridor (half-width 8, plus each object's own clear radius).
      const cs = cellCorridors(straight);
      for (const kind of TERRAIN_KINDS) {
        if (kind === "grass") continue;
        for (const coord of ["6,6", "2,9", "11,4"]) {
          const svg = tileGroundSvg(kind, coord, around(kind), 3, cs);
          for (const p of translates(svg)) {
            expect(Math.abs(p.y - 50)).toBeGreaterThan(11);
          }
        }
      }
    });

    it("sends overhanging forest trees to the canopy layer, trunks off the ballast", () => {
      // The pass-under effect: trees whose trunks stand just OFF the line but
      // whose crowns reach over it. Trunk at >= half+TRUNK_CLEAR (12) from the
      // centreline, and close enough that the canopy actually overhangs.
      const cs = cellCorridors(straight);
      let seen = 0;
      for (const coord of ["6,6", "2,9", "11,4", "5,5", "7,2"]) {
        const canopy = tileCanopySvg("forest", coord, around("forest"), 3, cs);
        for (const p of translates(canopy)) {
          seen++;
          const d = Math.abs(p.y - 50);
          expect(d).toBeGreaterThanOrEqual(11.9);
          expect(d).toBeLessThan(23.1);
        }
      }
      expect(seen).toBeGreaterThan(0);
    });

    it("draws no canopy without a line, and none for other kinds", () => {
      expect(tileCanopySvg("forest", "6,6", around("forest"), 3)).toBe("");
      expect(
        tileCanopySvg("urban", "6,6", around("urban"), 3, cellCorridors(straight)),
      ).toBe("");
      expect(
        tileCanopySvg("rock", "6,6", around("rock"), 3, cellCorridors(straight)),
      ).toBe("");
    });

    it("carries a neighbour's line into this tile's space", () => {
      const cs = corridorsFor(undefined, { top: straight });
      expect(cs).toHaveLength(1);
      expect(cs[0].pts[0]).toEqual({ x: 0, y: -50 });
    });

    it("widens a road corridor with its lane count", () => {
      const oneLane: TileCell = {
        connections: [],
        road: [
          { from: Position.Left, to: [Position.Right], index: 0 },
          { from: Position.Right, to: [Position.Left], index: 0 },
        ],
      };
      const twoLane: TileCell = {
        connections: [],
        road: [
          { from: Position.Left, to: [Position.Right], index: 0 },
          { from: Position.Left, to: [Position.Right], index: 1 },
        ],
      };
      const narrow = cellCorridors(oneLane)[0].half;
      const wide = cellCorridors(twoLane)[0].half;
      expect(wide).toBeGreaterThan(narrow);
      // A road is wider than a rail line.
      expect(narrow).toBeGreaterThan(cellCorridors(straight)[0].half);
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
      // have to be tellable apart at a glance. Top-down nothing "stands taller"
      // any more — what separates them is the ground tone (dark blue slate vs
      // cool light grey) and the snow that only a ridge carries.
      const rock = tileGroundSvg("rock", "3,3", around("rock"), 5);
      const mountain = tileGroundSvg("mountain", "3,3", around("mountain"), 5);
      expect(mountain).not.toBe(rock);
      expect(mountain).toContain("hsl(214 13% 42.0%)");
      expect(rock).toContain("hsl(210 7% 56.0%)");
      // Snow tones appear on ridges and nowhere on rock. (Deterministic: the
      // seed is fixed, and each of this tile's peaks rolls snow at ~82%.)
      expect(mountain).toContain("hsl(202 24% 94%)");
      expect(rock).not.toContain("hsl(202 24% 94%)");
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
