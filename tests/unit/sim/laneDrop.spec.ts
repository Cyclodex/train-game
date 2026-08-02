import { describe, it, expect } from "vitest";
import { createRoadSim } from "@/sim/road";
import { Level } from "@/tiles/model";
import { nWayLanes, laneCount } from "@/tiles/lanes";
import { Position } from "@/types";
import { lanedrop } from "@/levels/test/scenarios/lanedrop";
import { roadlanemerge } from "@/levels/test/scenarios/roadlanemerge";

// LANE-DROP DISCIPLINE on a bidirectional road (the `lanedrop` scenario).
//
// A bidirectional road anchors its lanes at the centreline, so a change of width
// is felt at the KERB: the lane that continues through a narrow section is the
// centre-adjacent one, and a widening adds lanes outboard of it. Three rules come
// out of that, and this file pins all three:
//
//  1. crossing a seam keeps the car on the tarmac it is on (its lane INDEX is
//     renumbered — `laneIndexAcrossSeam`), rather than carrying the index and
//     sweeping the car two lanes out to the kerb;
//  2. a lane that stops within LANE_DROP_LOOKAHEAD tiles is a lane no car may aim
//     for, so a short wide stretch is driven straight through;
//  3. a lane change moves ONE lane and then settles before the next.

// A west→east straight of `counts.length` tiles at row `y`, `count` lanes each
// direction, starting at x = `startX`.
function laneRow(counts: number[], y = 0, startX = 0): Level {
  const lvl: Level = {};
  counts.forEach((count, i) => {
    lvl[`${startX + i},${y}`] = {
      connections: [],
      road: nWayLanes(Position.Left, Position.Right, count),
    };
  });
  return lvl;
}

// Every eastbound car's lane index per tick, keyed by car id: the trace the rules
// below are read off. Only cars travelling east (entered via Left) on row `y`.
interface Obs {
  t: number;
  x: number;
  lane: number;
  count: number;
}

function traceRow(
  level: Level,
  opts: {
    width: number;
    height: number;
    y: number;
    seed?: number;
    ticks?: number;
    spawnEntries?: { coord: { x: number; y: number }; entryPort: Position }[];
    maxCars?: number;
    spawnInterval?: number;
  },
): Map<string, Obs[]> {
  const dt = 0.05;
  const sim = createRoadSim({
    level,
    width: opts.width,
    height: opts.height,
    seed: opts.seed ?? 3,
    spawnInterval: opts.spawnInterval ?? 3,
    carSpeed: 0.5,
    carLength: 0.23,
    maxCars: opts.maxCars ?? 4,
    ...(opts.spawnEntries ? { spawnEntries: opts.spawnEntries } : {}),
  });
  const out = new Map<string, Obs[]>();
  for (let i = 0; i < (opts.ticks ?? 3000); i++) {
    sim.step(dt, () => false);
    for (const c of sim.sample()) {
      const f = c.units[0].front;
      if (f.coord.y !== opts.y || f.entryPort !== Position.Left) continue;
      const count = laneCount(level[`${f.coord.x},${f.coord.y}`]?.road, Position.Left);
      if (!out.has(c.id)) out.set(c.id, []);
      out.get(c.id)!.push({ t: i * dt, x: f.coord.x, lane: c.laneIndex, count });
    }
  }
  return out;
}

// The lateral distance covered between two moments of rest, for one car's trace.
// A "rest" is a tick where the car sits exactly on an integer lane (the sim pins
// it there and zeroes `laneVel` on arrival). Ticks that cross a lane-count change
// are excluded: the index is deliberately renumbered there, and the car has not
// moved at all.
function changeSizes(obs: Obs[]): number[] {
  const out: number[] = [];
  let start = obs[0]?.lane ?? 0;
  for (let i = 1; i < obs.length; i++) {
    if (obs[i].count !== obs[i - 1].count) {
      start = obs[i].lane;
      continue;
    }
    const settled = Math.abs(obs[i].lane - Math.round(obs[i].lane)) < 1e-9;
    if (!settled) continue;
    if (Math.abs(obs[i].lane - start) > 1e-6) out.push(Math.abs(obs[i].lane - start));
    start = obs[i].lane;
  }
  return out;
}

describe("lane drop — a car holds the lane that continues", () => {
  it("drives a SHORT widening straight through, in the lane it arrived in", () => {
    // 1 · 3 3 3 3 · 1 — the `roadlanemerge` gallery's skip-a-lane row, and the
    // reported bug: a car came out of the single lane and immediately swept two
    // lanes over to the far kerb (carrying its lane INDEX across the seam while
    // the geometry re-anchored what that index meant), rode the kerb for three
    // tiles, and was dragged back inward at the taper. Now the index is remapped
    // to the lane it is physically in — 2, the centre-adjacent one — and nothing
    // sends it anywhere else: the kerb lanes end four tiles later.
    const level = laneRow([1, 3, 3, 3, 3, 1]);
    const trace = traceRow(level, { width: 6, height: 1, y: 0 });
    expect(trace.size).toBeGreaterThan(0);
    for (const obs of trace.values()) {
      const wide = obs.filter(o => o.count === 3);
      if (wide.length === 0) continue;
      // Never leaves the surviving lane — no drift out, no merge back.
      for (const o of wide) expect(o.lane).toBeCloseTo(2, 6);
    }
  });

  it("is a straight line for the whole crossing (no lateral movement at all)", () => {
    const level = laneRow([1, 3, 3, 3, 3, 1]);
    const trace = traceRow(level, { width: 6, height: 1, y: 0 });
    for (const obs of trace.values()) {
      // Not one lane change on the whole road (count changes are renumberings,
      // and `changeSizes` excludes them).
      expect(changeSizes(obs)).toEqual([]);
    }
  });

  it("still USES the extra lanes when the wide stretch is long enough to be worth it", () => {
    // Same shape, 13 wide tiles instead of 4. Now keep-right does send the car out
    // to the kerb — the drift is discretionary, not forbidden.
    const level = laneRow([1, ...Array(13).fill(3), 1]);
    const trace = traceRow(level, { width: 15, height: 1, y: 0, ticks: 6000 });
    const reachedKerb = [...trace.values()].filter(obs => obs.some(o => o.lane < 0.001));
    expect(reachedKerb.length).toBeGreaterThan(0);
  });

  it("merges back inward BEFORE the taper, not at it", () => {
    // The drop is at x = 14, so a car must be back in the surviving lane while it
    // still has road to do it in — the four tiles of notice LANE_DROP_LOOKAHEAD
    // gives. Asserted on the last wide tile: everyone is in lane 2 by then.
    const level = laneRow([1, ...Array(13).fill(3), 1]);
    const trace = traceRow(level, { width: 15, height: 1, y: 0, ticks: 6000 });
    let checked = 0;
    for (const obs of trace.values()) {
      for (const o of obs.filter(s => s.x === 13)) {
        expect(o.lane).toBeCloseTo(2, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("lane changes — one lane at a time, with a look in between", () => {
  it("never crosses two lanes in a single manoeuvre", () => {
    const level = laneRow([1, ...Array(13).fill(3), 1]);
    const trace = traceRow(level, { width: 15, height: 1, y: 0, ticks: 6000 });
    let changes = 0;
    for (const obs of trace.values()) {
      for (const size of changeSizes(obs)) {
        expect(size).toBeLessThanOrEqual(1 + 1e-6);
        changes++;
      }
    }
    // The road really did make cars change lane, so the bound above means
    // something (a sim that never moved anyone would pass it vacuously).
    expect(changes).toBeGreaterThan(0);
  });

  it("settles between two changes instead of sweeping through", () => {
    // Two consecutive changes by the same car are separated by the settle, so a
    // 2-lane journey reads as two decisions. Measured between the ticks the car
    // comes to rest on a lane.
    const level = laneRow([1, ...Array(13).fill(3), 1]);
    const trace = traceRow(level, { width: 15, height: 1, y: 0, ticks: 6000 });
    let pairs = 0;
    for (const obs of trace.values()) {
      const at: number[] = [];
      let start = obs[0].lane;
      for (let i = 1; i < obs.length; i++) {
        if (obs[i].count !== obs[i - 1].count) {
          start = obs[i].lane;
          continue;
        }
        if (Math.abs(obs[i].lane - Math.round(obs[i].lane)) > 1e-9) continue;
        if (Math.abs(obs[i].lane - start) > 1e-6) at.push(obs[i].t);
        start = obs[i].lane;
      }
      for (let i = 1; i < at.length; i++) {
        expect(at[i] - at[i - 1]).toBeGreaterThan(1);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });
});

describe("the lanedrop scenario runs its own board", () => {
  it("holds the lane on the short row and uses the kerb on the long one", () => {
    const trace = traceRow(lanedrop.level, {
      width: 15,
      height: 5,
      y: 1,
      ticks: 4000,
      spawnEntries: lanedrop.traffic!.spawnEntries as never,
      maxCars: lanedrop.traffic!.maxCars,
      spawnInterval: lanedrop.traffic!.spawnInterval,
    });
    expect(trace.size).toBeGreaterThan(0);
    for (const obs of trace.values()) {
      for (const o of obs.filter(s => s.count === 3)) expect(o.lane).toBeCloseTo(2, 6);
    }
    const long = traceRow(lanedrop.level, {
      width: 15,
      height: 5,
      y: 3,
      ticks: 6000,
      spawnEntries: lanedrop.traffic!.spawnEntries as never,
      maxCars: lanedrop.traffic!.maxCars,
      spawnInterval: lanedrop.traffic!.spawnInterval,
    });
    expect([...long.values()].some(obs => obs.some(o => o.lane < 0.001))).toBe(true);
  });

  it("keeps every car in a lane that still exists ahead of it", () => {
    // The rule as a safety property rather than as a behaviour: on the SHORT row
    // no car is ever in a lane that stops within the next four tiles.
    const trace = traceRow(lanedrop.level, {
      width: 15,
      height: 5,
      y: 1,
      ticks: 4000,
      spawnEntries: lanedrop.traffic!.spawnEntries as never,
      maxCars: lanedrop.traffic!.maxCars,
      spawnInterval: lanedrop.traffic!.spawnInterval,
    });
    for (const obs of trace.values()) {
      for (const o of obs) {
        // Tiles 5..8 are the wide ones; the road narrows at x = 9. The surviving
        // band on a 3-lane tile whose road drops to 1 is {2}.
        if (o.count === 3) expect(o.lane).toBeGreaterThanOrEqual(2 - 1e-6);
      }
    }
  });
});

describe("roadlanemerge gallery — the reported case, on its own board", () => {
  it("no longer sweeps a car across the 1 → 3 widening", () => {
    // Row y = 5 of the gallery is 1 · 3 3 3 3 · 1 at x = 4..9. This is the exact
    // map from the report.
    const trace = traceRow(roadlanemerge.level, { width: 14, height: 9, y: 5, ticks: 4000 });
    expect(trace.size).toBeGreaterThan(0);
    for (const obs of trace.values()) {
      for (const o of obs.filter(s => s.count === 3)) expect(o.lane).toBeCloseTo(2, 6);
      expect(changeSizes(obs)).toEqual([]);
    }
  });
});
