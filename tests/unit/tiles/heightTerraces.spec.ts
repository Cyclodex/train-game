import { describe, it, expect, beforeEach } from "vitest";
import {
  _clearTerrainCache,
  HeightNeighbours,
  bandInsets,
  heightTint,
  tileHeightSvg,
} from "@/tiles/terrain";

// Hypsometric terraces when the ground falls more than ONE step at a boundary.
//
// A cell used to lay a single body — its own level — so a summit that dropped
// straight to the ground next door showed one contour where the same hill
// showed two or three on the axis someone had authored ramps along. /test/grades
// is the case that made it obvious: terraced east-west, sheer north and south.
// A cell now owes one contour PER LEVEL it stands above each neighbour, and
// draws the ones nobody authored inside its own tile.

const around = (h: number): HeightNeighbours => ({
  top: h,
  right: h,
  bottom: h,
  left: h,
  topLeft: h,
  topRight: h,
  bottomRight: h,
  bottomLeft: h,
});

/** The bodies (opaque fills) a terrace emits, in painting order. */
function bodies(svg: string): string[] {
  return [...svg.matchAll(/<path d="([^"]+)" fill="(hsl[^"]+)"\/>/g)].map(m => m[2]);
}

/** A body's outline flattened to points, six samples per cubic. */
function outline(svg: string, index: number): { x: number; y: number }[] {
  const d = [...svg.matchAll(/<path d="([^"]+)" fill="hsl[^"]+"\/>/g)].map(m => m[1])[index];
  const m = d.match(/M([-\d.]+) ([-\d.]+)/)!;
  let cursor = { x: Number(m[1]), y: Number(m[2]) };
  const pts: { x: number; y: number }[] = [];
  for (const c of d.matchAll(/C([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)/g)) {
    const n = c.slice(1).map(Number);
    const [a, p1, p2, b] = [
      cursor,
      { x: n[0], y: n[1] },
      { x: n[2], y: n[3] },
      { x: n[4], y: n[5] },
    ];
    for (let k = 0; k < 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      pts.push({
        x: u ** 3 * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * b.x,
        y: u ** 3 * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * b.y,
      });
    }
    cursor = b;
  }
  return pts;
}

describe("height terraces", () => {
  beforeEach(() => _clearTerrainCache());

  it("draws nothing at ground level", () => {
    expect(tileHeightSvg(0, "2,2", around(0), 9)).toBe("");
  });

  it("draws one contour per level of the fall, not one per cell", () => {
    // The heart of it. A lone h1 knoll is one contour; a lone h3 mesa is three,
    // in its own tile — the level-1 and level-2 rings nobody authored.
    expect(bodies(tileHeightSvg(1, "2,2", around(0), 9))).toHaveLength(1);
    expect(bodies(tileHeightSvg(2, "2,2", around(0), 9))).toHaveLength(2);
    expect(bodies(tileHeightSvg(3, "2,2", around(0), 9))).toHaveLength(3);
  });

  it("tints each contour for the level it represents, low to high", () => {
    const drawn = bodies(tileHeightSvg(3, "2,2", around(0), 9));
    const expected = [1, 2, 3].map(k => heightTint(k, "meadow"));
    // Painted lowest first, so the higher bands nest on top of the lower ones.
    for (let i = 0; i < 3; i++) {
      expect(drawn[i]).toContain(`${expected[i][0]} ${expected[i][1]}%`);
    }
  });

  it("stops the contours the neighbours already carry at the boundary", () => {
    // 1 -> 3 in one boundary. The level-1 terrace is shared with the neighbour,
    // so it runs full-bleed to the tile edge (only the corners this tile cuts
    // show it); levels 2 and 3 are this cell's to draw, the level-2 contour on
    // the boundary and the level-3 one inside — which is the "1 -> 2 -> 3"
    // reading, produced from data that never mentions level 2.
    const drawn = bodies(tileHeightSvg(3, "2,2", around(1), 9));
    expect(drawn.map(c => c.split(" ")[0])).toEqual(
      [1, 2, 3].map(k => `hsl(${heightTint(k)[0]}`),
    );
    expect(bandInsets(1, around(1))).toEqual([0, 0, 0, 0]);
    expect(bandInsets(2, around(1))).toEqual([0, 0, 0, 0]);
    for (const inset of bandInsets(3, around(1))) expect(inset).toBeGreaterThan(0);
  });

  it("draws a plateau's interior as one body", () => {
    // Every neighbour is already at the summit, so the lower bands would be
    // covered exactly by this one: emitting them is invisible work, on most of
    // the cells of any large hill.
    expect(bodies(tileHeightSvg(3, "2,2", around(3), 9))).toHaveLength(1);
  });

  it("puts the FIRST step off a summit on the tile boundary", () => {
    // The compatibility rule, and the reason an ordinary ramped hill renders
    // exactly as it did before this: the lowest contour a cell owes toward a
    // neighbour always lands on the shared boundary, and only the ones ABOVE it
    // are pushed inside. So a 1-step drop is never inset at all.
    expect(bandInsets(1, around(0))).toEqual([0, 0, 0, 0]);
    expect(bandInsets(2, around(1))).toEqual([0, 0, 0, 0]);
    expect(bandInsets(3, around(2))).toEqual([0, 0, 0, 0]);
  });

  it("steps each further contour deeper into the tile", () => {
    // Contours closer together IS what a steeper slope looks like on a map.
    const [top2] = bandInsets(2, around(0));
    const [top3] = bandInsets(3, around(0));
    expect(top2).toBeGreaterThan(0);
    expect(top3).toBeGreaterThan(top2);
  });

  it("insets only the edges that actually drop", () => {
    // The glitch this fixes, at its smallest: a cell whose west neighbour is one
    // step down and whose north neighbour is two. The west contour sits on the
    // boundary as it always did; the north one steps in, so the hill terraces
    // the same way on both faces instead of going sheer on the unauthored one.
    const mixed: HeightNeighbours = { ...around(2), top: 0, left: 1 };
    const [top, right, bottom, left] = bandInsets(2, mixed);
    expect(top).toBeGreaterThan(0);
    expect(left).toBe(0);
    expect(right).toBe(0);
    expect(bottom).toBe(0);
  });

  it("nests each contour strictly inside the one below it", () => {
    // Not merely "smaller": a band that bulged back out over the ring below
    // would eat the very contour it is meant to sit in (see outwardRoom).
    const svg = tileHeightSvg(3, "2,2", around(0), 9);
    const inward = (i: number) =>
      Math.min(...outline(svg, i).map(p => Math.min(p.x, p.y, 100 - p.x, 100 - p.y)));
    expect(inward(1)).toBeGreaterThan(inward(0));
    expect(inward(2)).toBeGreaterThan(inward(1));
  });

  it("keeps every contour on its own tile", () => {
    // Same containment rule as any other patch: what answers for a cell (a
    // bridge deck, a tunnel portal) spans exactly one tile, so the ground must
    // fit inside it.
    for (const pts of [0, 1, 2].map(i => outline(tileHeightSvg(3, "2,2", around(0), 9), i))) {
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(-1);
        expect(p.x).toBeLessThanOrEqual(101);
        expect(p.y).toBeGreaterThanOrEqual(-1);
        expect(p.y).toBeLessThanOrEqual(101);
      }
    }
  });

  it("keys the memo on the neighbours' heights, not on a same/different flag", () => {
    // Two cells that differ ONLY in how far the ground falls owe different
    // contours; a key that had compressed both to "lower" would serve the
    // second from the first and redraw the glitch out of the cache.
    const cliff = tileHeightSvg(3, "2,2", around(0), 9);
    const shelf = tileHeightSvg(3, "2,2", around(2), 9);
    expect(shelf).not.toEqual(cliff);
    expect(tileHeightSvg(3, "2,2", around(0), 9)).toEqual(cliff);
  });

  it("anchors the tint to the theme", () => {
    // "Higher" only exists relative to the ground the theme paints.
    expect(tileHeightSvg(2, "2,2", around(0), 9, "plain")).not.toEqual(
      tileHeightSvg(2, "2,2", around(0), 9, "meadow"),
    );
  });
});

// EVERY GROUND TERRACES, IN ITS OWN COLOUR (2026-08-03).
//
// The terrace used to be the meadow's green whatever the cell carried, painted
// UNDER the terrain patch — so raising a wood, a rock field or a town changed
// the data, the grade and the chevrons, and not one pixel of the ground. Only
// grass, which paints no patch of its own, ever looked higher.
describe("terraces on terrain", () => {
  beforeEach(() => _clearTerrainCache());

  const hues = (svg: string) => bodies(svg).map(c => Number(c.slice(4).split(" ")[0]));
  const lights = (svg: string) =>
    bodies(svg).map(c => Number(c.split(" ")[2].replace("%)", "")));

  it("tints a hillside in its OWN ground, not in the meadow's green", () => {
    for (const kind of ["forest", "rock", "mountain", "urban"] as const) {
      const svg = tileHeightSvg(1, "2,2", around(0), 9, "meadow", kind);
      // The kind's own hue (GROUND), not the terrace green.
      expect(hues(svg)[0]).not.toBe(heightTint(1, "meadow")[0]);
      expect(hues(svg)[0]).toBe(heightTint(1, "meadow", kind)[0]);
    }
  });

  it("lifts every step, and never off its own colour", () => {
    // A step has to MOVE (a height-1 wood the colour of the flat wood beside it
    // is the bug this fixes) and has to stay recognisably that ground: hue is
    // what says "wood" or "slate", so only the lightness climbs.
    const svg = tileHeightSvg(3, "2,2", around(0), 9, "meadow", "forest");
    const [l1, l2, l3] = lights(svg);
    expect(l1).toBeGreaterThan(30); // the flat forest's own lightness
    expect(l2).toBeGreaterThan(l1);
    expect(l3).toBeGreaterThan(l2);
    expect(new Set(hues(svg)).size).toBe(1);
  });

  it("keeps the pale grounds off white", () => {
    // A flat lift bleached the town's tan to paper by the third step — a hill
    // town whiter than a depot roof. The step is a share of the headroom.
    for (const kind of ["urban", "rock", "industry"] as const) {
      expect(heightTint(3, "meadow", kind)[2]).toBeLessThan(82);
    }
  });

  it("ignores the theme for a ground that paints its own patch", () => {
    // The theme anchor exists because grass shows the BOARD. A wood shows the
    // wood, on any board.
    expect(tileHeightSvg(2, "2,2", around(0), 9, "plain", "forest")).toEqual(
      tileHeightSvg(2, "2,2", around(0), 9, "meadow", "forest"),
    );
  });

  it("keys the memo on the kind", () => {
    // Same cell, same heights, different ground: a key without the kind would
    // serve the wood's terrace to the rock field next door.
    const wood = tileHeightSvg(2, "2,2", around(0), 9, "meadow", "forest");
    expect(tileHeightSvg(2, "2,2", around(0), 9, "meadow", "rock")).not.toEqual(wood);
    expect(tileHeightSvg(2, "2,2", around(0), 9, "meadow", "forest")).toEqual(wood);
  });

  it("steps SURVEYED ground on straight banks", () => {
    // A field, a town and a works are cut to a line by people; a hillside is
    // shaped by weather. The terrace is drawn the way its own patch is drawn,
    // so a terraced field has straight banks and a wood has contours.
    // How far the drawn edge bows off the chord between its two corners: ~0 for
    // a surveyed bank (its controls sit ON the chord), units for a contour.
    const bow = (svg: string, i: number) => {
      const pts = outline(svg, i);
      const corners = pts.filter((_, k) => k % 6 === 0);
      let worst = 0;
      corners.forEach((a, k) => {
        const b = corners[(k + 1) % corners.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        for (const p of pts.slice(k * 6, k * 6 + 6)) {
          const off = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len;
          worst = Math.max(worst, off);
        }
      });
      return worst;
    };
    const straight = (svg: string, i: number) => bow(svg, i) < 0.5;
    expect(straight(tileHeightSvg(1, "2,2", around(0), 9, "meadow", "urban"), 0)).toBe(true);
    expect(straight(tileHeightSvg(1, "2,2", around(0), 9, "meadow", "forest"), 0)).toBe(
      false,
    );
  });

  it("insets a surveyed band's steps too", () => {
    // `corners()` used to return early for surveyed ground BEFORE applying the
    // band inset, so a town dropping three steps at one boundary stacked all
    // three bands on the same tile edge and showed one. A cut bench still has
    // to fit its steps inside its own tile.
    const svg = tileHeightSvg(3, "2,2", around(0), 9, "meadow", "urban");
    const inward = (i: number) =>
      Math.min(...outline(svg, i).map(p => Math.min(p.x, p.y, 100 - p.x, 100 - p.y)));
    expect(bodies(svg)).toHaveLength(3);
    expect(inward(1)).toBeGreaterThan(inward(0));
    expect(inward(2)).toBeGreaterThan(inward(1));
  });

  it("leaves the soft fringe to grass alone", () => {
    // The fringe is a halo of the band's colour spilled DOWNHILL. Over the
    // backdrop that is a falloff; over a ground that paints its own opaque
    // patch it is a pale bar along the LOW side of every step — the light back
    // to front.
    const halo = /stroke-width="30"/;
    expect(tileHeightSvg(2, "2,2", around(0), 9)).toMatch(halo);
    expect(tileHeightSvg(2, "2,2", around(0), 9, "meadow", "forest")).not.toMatch(halo);
  });
});
