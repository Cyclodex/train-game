import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { railPathsFor } from "@/tiles/geometry";
import { segmentPathD } from "@/sim/pathGeometry";

const { Top, Bottom, Left, Center } = Position;
const SIZE = 200;
const OFF = 14;

interface Pt {
  x: number;
  y: number;
}

// Sample any of the shapes railPathsFor can emit — an `M…L…` line, an `M…L…L…`
// polyline, or an `M…Q…` quadratic — as points. The tests below are about WHERE
// the rails lie, never about which SVG commands drew them: the old curve branch
// was a `Q` and the fixed one is a sampled polyline, and both must answer the
// same geometric questions.
function pathPoints(d: string, n = 400): Pt[] {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  if (/Q/.test(d)) {
    const [a, c, b] = pts;
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      out.push({
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
      });
    }
    return out;
  }
  // Polyline / line: densify each leg so nearest-point distances are accurate.
  const out: Pt[] = [pts[0]];
  const per = Math.max(1, Math.ceil(n / (pts.length - 1)));
  for (let i = 1; i < pts.length; i++) {
    for (let k = 1; k <= per; k++) {
      const t = k / per;
      out.push({
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
      });
    }
  }
  return out;
}

const nearest = (p: Pt, pts: Pt[]): number =>
  Math.min(...pts.map(q => Math.hypot(q.x - p.x, q.y - p.y)));

const first = (d: string): Pt => pathPoints(d, 2)[0];
const last = (d: string): Pt => {
  const pts = pathPoints(d, 2);
  return pts[pts.length - 1];
};

describe("railPathsFor", () => {
  it("returns exactly two rail paths", () => {
    expect(railPathsFor(Top, Bottom, SIZE, OFF)).toHaveLength(2);
  });

  it("vertical straight: rails are two vertical lines offset in x by +/- offset", () => {
    const [r1, r2] = railPathsFor(Top, Bottom, SIZE, OFF);
    // Centre of a vertical straight is x=100; rails at 100+/-14 = 86 and 114.
    expect(r1).toContain("86");
    expect(r2).toContain("114");
  });

  it("depot stub (port<->Center) returns two offset lines", () => {
    expect(railPathsFor(Top, Center, SIZE, OFF)).toHaveLength(2);
  });

  // --- Curve geometry: a curve's rails are a TRUE parallel offset ------------
  //
  // The bug these pin: the curve branch used to offset only the two ENDPOINTS,
  // perpendicular to the straight CHORD a->b, and leave the quadratic's control
  // point at the tile centre. That is not a parallel curve — the gauge collapsed
  // to half at the apex (14px at the ports, 7px mid-bend) and the rails started
  // ~5px sideways of where the neighbouring tile put its own.
  describe("curve (adjacent ports)", () => {
    it("holds a constant gauge all the way round the bend", () => {
      const [r1, r2] = railPathsFor(Left, Bottom, SIZE, OFF);
      const a = pathPoints(r1);
      const b = pathPoints(r2);
      const step = Math.floor(a.length / 20);
      for (let i = 0; i <= a.length - 1; i += step) {
        expect(nearest(a[i], b)).toBeCloseTo(2 * OFF, 0);
      }
    });

    it("keeps both rails `offset` from the sleeper centreline everywhere", () => {
      const [r1, r2] = railPathsFor(Left, Bottom, SIZE, OFF);
      const bed = pathPoints(segmentPathD(Left, Bottom, SIZE));
      for (const rail of [r1, r2]) {
        const pts = pathPoints(rail);
        const step = Math.floor(pts.length / 20);
        // Skip the very ends: there the nearest point on the (finite) centreline
        // is its endpoint, so the measured distance is the offset by definition.
        for (let i = step; i <= pts.length - 1 - step; i += step) {
          expect(nearest(pts[i], bed)).toBeCloseTo(OFF, 0);
        }
      }
    });

    it("meets the neighbouring tile's rails square at each seam", () => {
      // A Left<->Bottom curve joins a horizontal straight on its left edge and a
      // vertical straight below. Those put their rails at y=100+/-OFF on x=0 and
      // at x=100+/-OFF on y=200 — the curve must land on exactly those points,
      // or the track visibly jogs sideways at the tile boundary.
      const [r1, r2] = railPathsFor(Left, Bottom, SIZE, OFF);
      const entries = [first(r1), first(r2)].sort((p, q) => p.y - q.y);
      expect(entries[0]).toEqual({ x: 0, y: 100 - OFF });
      expect(entries[1]).toEqual({ x: 0, y: 100 + OFF });
      const exits = [last(r1), last(r2)].sort((p, q) => p.x - q.x);
      expect(exits[0]).toEqual({ x: 100 - OFF, y: 200 });
      expect(exits[1]).toEqual({ x: 100 + OFF, y: 200 });
    });

    it("the two rails sit on opposite sides of the centreline", () => {
      // Not merely `2*OFF apart`: a pinched pair could satisfy that while both
      // rails ran on the same side. The curve bows toward the tile centre, so
      // one rail must be nearer the centre point than the bed and one further.
      const [r1, r2] = railPathsFor(Left, Bottom, SIZE, OFF);
      const mid = (d: string) => {
        const p = pathPoints(d);
        return p[Math.floor(p.length / 2)];
      };
      const c = { x: SIZE / 2, y: SIZE / 2 };
      const bedMid = mid(segmentPathD(Left, Bottom, SIZE));
      const dBed = Math.hypot(bedMid.x - c.x, bedMid.y - c.y);
      const d1 = Math.hypot(mid(r1).x - c.x, mid(r1).y - c.y);
      const d2 = Math.hypot(mid(r2).x - c.x, mid(r2).y - c.y);
      expect(Math.min(d1, d2)).toBeLessThan(dBed);
      expect(Math.max(d1, d2)).toBeGreaterThan(dBed);
    });
  });
});
