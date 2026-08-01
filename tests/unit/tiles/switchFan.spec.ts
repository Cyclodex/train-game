import { describe, it, expect } from "vitest";
import { Position, ActiveIntersection } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { armExit, portsOf, isJunctionEntry } from "@/tiles/model";
import { portPoint, segmentPathD } from "@/sim/pathGeometry";
import {
  ARMS,
  SWITCH_INSET,
  switchHubAt,
  fanArms,
  armReachable,
  railArrow,
  switchFanScale,
} from "@/tiles/switchFan";

const { Top, Right, Bottom, Left } = Position;
const ENTRIES = [Top, Right, Bottom, Left];
const SIZE = 200;

// The shaft is a polyline "Mx y Lx y L…"; pull out its points.
function points(shaft: string): { x: number; y: number }[] {
  return shaft
    .replace(/^M/, "")
    .split("L")
    .map(pair => {
      const [x, y] = pair.trim().split(/\s+/).map(Number);
      return { x, y };
    });
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

// Which of the four edge points a position is nearest to.
function nearestPort(p: { x: number; y: number }): Position {
  return ENTRIES.reduce((best, port) =>
    dist(p, portPoint(port, SIZE)) < dist(p, portPoint(best, SIZE)) ? port : best
  );
}

describe("switch fan geometry", () => {
  // The whole point of drawing on the rails: an arrow cannot lie about where it
  // sends you, because it is laid along the movement it throws. Each arm is
  // ANCHORED AT ITS ENTRY — it starts on the edge trains arrive by and walks
  // toward the exit `armExit` names (exit-anchored arrows read backwards, as
  // "something arrives here"; that was version one and the player caught it).
  it("every arrow starts at its entry edge and advances on its arm's exit", () => {
    const cross = expandKind("cross", 0); // all pairs: the dense case
    for (const entry of ENTRIES) {
      for (const arm of ARMS) {
        const exit = armExit(entry, arm)!;
        const pts = points(railArrow(entry, exit, SIZE, 0.05, 0.35).shaft);
        const label = `entry ${entry} arm ${arm}`;
        expect(armReachable(cross.connections, entry, arm), label).toBe(true);
        expect(nearestPort(pts[0]), `${label} start`).toBe(entry);
        // The tip stops mid-tile, so "nearest port" is ambiguous there; what
        // must hold is monotone progress: every step gets closer to the exit.
        const exitPt = portPoint(exit, SIZE);
        for (let i = 1; i < pts.length; i++) {
          expect(
            dist(pts[i], exitPt),
            `${label} step ${i} moves toward its exit`
          ).toBeLessThan(dist(pts[i - 1], exitPt));
        }
      }
    }
  });

  // The arrow is the rail, not an approximation of it: every point of the body
  // lies ON the same quadratic `segmentPathD` draws, DEAD-CENTRE — an earlier
  // 8px side-offset read as a misdrawn arrow, and the player said so. (The body
  // now stops early where the head's flat back begins, so the check is
  // point-on-curve, not a parameter mapping.)
  it("lies exactly on the rail path it marks", () => {
    for (const [entry, exit] of [
      [Left, Right], // opposite ports: the quadratic degenerates to the line
      [Left, Top], // adjacent ports: the curve through the tile centre
    ] as [Position, Position][]) {
      const p0 = portPoint(entry, SIZE);
      const c = portPoint(Position.Center, SIZE);
      const p2 = portPoint(exit, SIZE);
      // Dense reference sampling of the rail curve.
      const curve: { x: number; y: number }[] = [];
      for (let i = 0; i <= 400; i++) {
        const t = i / 400;
        const u = 1 - t;
        curve.push({
          x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
          y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
        });
      }
      const onCurve = (p: { x: number; y: number }) =>
        Math.min(...curve.map(q => dist(p, q)));
      const arrow = railArrow(entry, exit, SIZE, 0.05, 0.65);
      for (const p of points(arrow.shaft)) {
        expect(onCurve(p)).toBeLessThan(0.5);
      }
      // The head's TIP is on the curve too (its back corners flare off it).
      const tip = points(arrow.head.replace(/Z$/, ""))[0];
      expect(onCurve(tip)).toBeLessThan(0.5);
      // Sanity: that IS the path the sim hands the renderer for this movement.
      expect(segmentPathD(entry, exit, SIZE)).toContain(`${p0.x} ${p0.y}`);
    }
  });

  // Centring is safe because the two directions of one arc can only appear
  // together AT REST (one fan open at a time), and the rest-crop gives each its
  // own half of the curve — their tips must never meet in the middle.
  it("keeps opposing resting arrows on one arc from touching", () => {
    for (const [a, b] of [
      [Left, Right], // the straight through the middle
      [Left, Top], // a curve, both ways round
    ] as [Position, Position][]) {
      const there = points(railArrow(a, b, SIZE, 0.05, 0.35).shaft);
      const back = points(railArrow(b, a, SIZE, 0.05, 0.35).shaft);
      let min = Infinity;
      for (const p of there) for (const q of back) min = Math.min(min, dist(p, q));
      expect(min, `arc ${a}<->${b}`).toBeGreaterThan(10);
    }
  });

  it("puts each hub inside its own edge, centred on it", () => {
    expect(switchHubAt(Top, SIZE)).toEqual({ x: 100, y: SWITCH_INSET });
    expect(switchHubAt(Right, SIZE)).toEqual({ x: 200 - SWITCH_INSET, y: 100 });
    expect(switchHubAt(Bottom, SIZE)).toEqual({ x: 100, y: 200 - SWITCH_INSET });
    expect(switchHubAt(Left, SIZE)).toEqual({ x: SWITCH_INSET, y: 100 });
  });

  it("draws an arm only where the tile can actually route it", () => {
    // A T-junction (rot 0: trunk Left-Right, branch to Top) offers two exits
    // from each of its three entries — never three.
    const tee = expandKind("tjunction", 0);
    for (const entry of portsOf(tee.connections)) {
      expect(isJunctionEntry(tee.connections, entry)).toBe(true);
      expect(fanArms(tee.connections, entry, SIZE, undefined, true)).toHaveLength(2);
    }
    // Bottom is not part of a T at all — no arm is reachable from it.
    for (const arm of ARMS) {
      expect(armReachable(tee.connections, Bottom, arm)).toBe(false);
    }
    const cross = expandKind("cross", 0);
    for (const entry of ENTRIES) {
      expect(fanArms(cross.connections, entry, SIZE, undefined, true)).toHaveLength(3);
    }
  });

  it("drops the arm whose branch was disabled", () => {
    // A cross with the west-to-north connection removed loses exactly that arm
    // from the west fan, keeping the rest.
    const cell = expandKind("cross", 0, { disable: [[Left, Top]] });
    const west = fanArms(cell.connections, Left, SIZE, undefined, true).map(a => a.arm);
    expect(west).not.toContain(ActiveIntersection.Left); // Left arm → Top
    expect(west).toEqual([ActiveIntersection.Straight, ActiveIntersection.Right]);
  });

  // The restraint that makes on-rail arrows survive a 4-way cross: at rest a
  // fan draws ONE arrow — the route it is set to — so the tile reads as "this is
  // how the junction routes", not as twelve overlapping curves. Only the fan
  // being pointed at (or the one a train is due on) shows its alternatives.
  it("draws only the set route at rest, and opens the rest when expanded", () => {
    const cross = expandKind("cross", 0); // three arms reachable from every entry
    const resting = fanArms(cross.connections, Left, SIZE, ActiveIntersection.Left);
    expect(resting).toHaveLength(1);
    expect(resting[0].arm).toBe(ActiveIntersection.Left);
    expect(resting[0].on).toBe(true);

    const opened = fanArms(cross.connections, Left, SIZE, ActiveIntersection.Left, true);
    expect(opened).toHaveLength(3);
    // Opening changes what is drawn — never which arm is set.
    expect(opened.filter(a => a.on).map(a => a.arm)).toEqual([ActiveIntersection.Left]);
    // Opening also runs the arrows further along their routes; at rest they
    // stop around mid-tile so each entry keeps to its own quadrant.
    const len = (shaft: string) => {
      const ps = points(shaft);
      return ps.slice(1).reduce((sum, p, i) => sum + dist(p, ps[i]), 0);
    };
    expect(len(opened.find(a => a.on)!.shaft)).toBeGreaterThan(
      len(resting[0].shaft) * 1.4
    );
  });

  // An entry with no arm yet (a junction the player just built) draws nothing
  // until one is chosen — its hub is the way in. It must not throw or guess.
  it("draws nothing at rest for an entry with no arm set", () => {
    const cross = expandKind("cross", 0);
    expect(fanArms(cross.connections, Left, SIZE, undefined)).toEqual([]);
  });

  it("counter-scales only once the board is zoomed out, and never runaway", () => {
    expect(switchFanScale(1)).toBe(1); // native zoom: authored weight
    expect(switchFanScale(0.5)).toBe(1); // the threshold itself
    expect(switchFanScale(0.25)).toBe(1.7); // clamped, not 2x
    expect(switchFanScale(0.05)).toBe(1.7); // a fitted 20x14 world stays capped
    expect(switchFanScale(0.4)).toBeCloseTo(1.25, 5);
    expect(switchFanScale(2)).toBe(1); // zoomed IN: never shrink the arrows
  });
});
