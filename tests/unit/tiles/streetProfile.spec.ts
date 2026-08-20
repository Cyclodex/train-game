import { describe, it, expect } from "vitest";
import { SCENARIOS } from "@/levels/test/index";
import {
  resolveSeamProfile,
  flankAt,
  seamFlanks,
  seamPaintLanes,
  PAVEMENT_FRAC,
  PROFILE_LANE_FRAC,
  VERGE_FRAC,
} from "@/tiles/streetProfile";
import {
  pavementOffsetEndsFor,
  hasFootway,
  roadThrough,
  PAVEMENT_GAP,
  PAVEMENT_WIDTH,
} from "@/tiles/footway";
import { bankFor, rowsOf, validateParking } from "@/tiles/parking";
import { levelBounds } from "@/tiles/bounds";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { parseCoordId, type Level, type Port, type TileCell } from "@/tiles/model";
import {
  twoWay,
  oneWay,
  oneWayLanes,
  isOneWayStraight,
  isRoadJunction,
  laneCount,
  laneCountAt,
  oneWayRunMax,
  roadSeamPaintTotal,
  junctionArmPaintTotal,
} from "@/tiles/lanes";
import { Position } from "@/types";

// THE STREET-PROFILE SWEEP — the oracle for "one truth for the cross-section".
//
// Three duties, in order of importance:
//
//  1. PARITY. The resolver must reproduce, to the unit, the numbers the
//     pavement already stands on (`pavementOffsetEndsFor`) — on EVERY seam of
//     EVERY registered scenario board. That is what makes migrating a consumer
//     onto the profile a refactor instead of a redesign.
//  2. SYMMETRY. `resolveSeamProfile(A, p)` and `resolveSeamProfile(B, opp p)`
//     must agree wherever both tiles carry a strip — that agreement IS the
//     connectedness of every band on the board.
//  3. THE MATRIX. Streets × parking × footway combinations that no board
//     happens to author still have to make sense, so a synthetic grid covers
//     them: 1/2/3-lane two-way, 1/2-lane one-way, each with nothing, marked
//     kerb bays, bare kerb, a drive, a lay-by, a bus stop, footway on and off.

const { Top, Right, Bottom, Left } = Position;

// The constants the footway draws with, restated through the profile: if these
// ever drift apart, every parity assertion below goes red at once.
describe("the profile's constants are the footway's constants", () => {
  it("verge and pavement match PAVEMENT_GAP / PAVEMENT_WIDTH", () => {
    expect(VERGE_FRAC * 100).toBe(PAVEMENT_GAP);
    expect(PAVEMENT_FRAC * 100).toBe(PAVEMENT_WIDTH);
  });
});

// Is `flank` the CENTRE side of a one-way straight on this cell? (The kerb side
// is right-of-travel; the centre side is where one-way lanes open and close.)
function oneWayCentreFlank(cell: TileCell | undefined, flank: Port): boolean {
  const road = cell?.road;
  if (!road?.length) return false;
  for (const from of [0, 1, 2, 3] as Port[]) {
    if (!isOneWayStraight(road, from)) continue;
    if (bankFor(from, "left") === flank) return true;
  }
  return false;
}

function eachRoadSeam(
  level: Level,
  visit: (tileId: string, cell: TileCell, port: Port) => void,
): void {
  for (const [tileId, cell] of Object.entries(level)) {
    if (!cell.road?.length) continue;
    const ports = new Set<Port>();
    for (const lane of cell.road) {
      if (lane.from !== Position.Center) ports.add(lane.from);
      for (const to of lane.to) if (to !== Position.Center) ports.add(to);
    }
    for (const port of ports) visit(tileId, cell, port);
  }
}

describe("parity: the profile IS the pavement's numbers, board-wide", () => {
  // Every scenario in the registry — bends, junctions, aisles, crossings, the
  // lot. If a single seam's pavement disagrees with the profile, the migration
  // would move a walker there, and this names the board and the tile.
  it("matches pavementOffsetEndsFor on every seam of every board", () => {
    for (const scenario of SCENARIOS) {
      const level = scenario.level;
      eachRoadSeam(level, (tileId, cell, port) => {
        if (!hasFootway(cell)) return;
        const through = roadThrough(cell);
        if (!through) return;
        // Only the seams this tile's own through movement touches can be
        // compared through the ends API (it is defined per traversal).
        if (port !== through.from && port !== through.to) return;
        // ONE-WAY straights are exempt, deliberately: the walkers never had the
        // kerb-anchored one-way branch the PAINT has always used (`bandsFor`),
        // so people and bands have quietly disagreed on every one-way lane-drop
        // run. The profile sides with the paint; migrating the walkers onto it
        // is what finally closes that gap, so holding them to the old numbers
        // here would pin the bug.
        if (isOneWayStraight(cell.road, through.from) || isOneWayStraight(cell.road, through.to))
          return;
        const coord = parseCoordId(tileId);
        const profile = resolveSeamProfile(level, coord, port);
        for (const side of [1, -1] as const) {
          const ends = pavementOffsetEndsFor(level, tileId, side, through.from, through.to);
          const off = port === through.from ? ends.offEntry : ends.offExit;
          const rel = side === 1 ? ("right" as const) : ("left" as const);
          const flank =
            port === through.from
              ? bankFor(through.from, rel)
              : bankFor(oppositePort(through.to), rel);
          const f = flankAt(profile, flank);
          const got = f.pavement;
          // Where the OLD footway clamped its band INSIDE the carriageway (wide
          // junction arms), the profile deliberately answers null — see the
          // no-room rule. Parity holds everywhere the old band was real.
          if (got === null) {
            // The profile answers null only where the old band was an overlap:
            // clamped inside the carriageway (wide junction arms) or into the
            // parking standing on the flank (deep gapped bays near the tile
            // edge). In both cases the old number was a band THROUGH something
            // solid, and dropping it is the correction, not a regression.
            const solid = f.strips
              .filter(st => st.kind !== "pavement" && st.kind !== "verge")
              .reduce((m, st) => Math.max(m, st.outer), 0);
            expect(
              Math.abs(off) / 100 - PAVEMENT_FRAC / 2,
              `${scenario.id} ${tileId} port ${port} flank ${flank}: profile dropped a REAL pavement`,
            ).toBeLessThan(solid);
            continue;
          }
          expect(
            got * 100,
            `${scenario.id} ${tileId} port ${port} flank ${flank}: profile disagrees with the pavement`,
          ).toBeCloseTo(Math.abs(off), 6);
        }
      });
    }
  });
});

describe("paint parity: seamPaintLanes IS what the surface strokes, board-wide", () => {
  // `Tile.vue`'s roadPaths now reads `seamPaintLanes` for its ribbon widths.
  // This pins the profile to the formulas the paint used before the migration —
  // the junction-aware pairing for centred surfaces, the kerb-anchored run for
  // one-way straights — on every seam of every registered board, so the
  // migration is provably pixel-identical and any future profile change that
  // would move tarmac fails here with the board and tile named.
  it("matches the legacy per-seam paint totals on every board", () => {
    for (const scenario of SCENARIOS) {
      const level = scenario.level;
      const roadAt = (c: { x: number; y: number }) => level[`${c.x},${c.y}`]?.road;
      eachRoadSeam(level, (tileId, cell, port) => {
        const road = cell.road;
        const coord = parseCoordId(tileId);
        const at = `${scenario.id} ${tileId} port ${port}`;
        const crossingAt = (p: Port): { crossing: number; junction: boolean } => {
          const n = neighborCoord(coord, p);
          const nRoad = n ? level[`${n.x},${n.y}`]?.road : undefined;
          return {
            crossing: nRoad ? laneCountAt(nRoad, oppositePort(p)) : 0,
            junction: isRoadJunction(nRoad),
          };
        };
        // ONE-WAY straight along this seam's axis: Tile.vue's one-way branch —
        // width entryCount at the entry seam; the closing lane's tarmac stays
        // full width across a narrowing tile, so max(entry, exit) at the exit.
        const owFrom = ([port, oppositePort(port)] as Port[]).find(f =>
          isOneWayStraight(road, f),
        );
        if (owFrom !== undefined) {
          const m = laneCount(road, owFrom);
          const e = crossingAt(owFrom);
          const x = crossingAt(oppositePort(owFrom));
          const entryCount = !e.junction && e.crossing > 0 ? Math.min(m, e.crossing) : m;
          const exitCount = !x.junction && x.crossing > 0 ? Math.min(m, x.crossing) : m;
          const expected =
            port === owFrom ? entryCount : Math.max(entryCount, exitCount);
          expect(seamPaintLanes(level, coord, port), at).toBeCloseTo(expected, 6);
          // And the kerb flank itself is the run anchor — the constant edge the
          // one-way surface hangs its through lanes on.
          const runMax = oneWayRunMax(roadAt, coord, owFrom);
          const profile = resolveSeamProfile(level, coord, port);
          expect(
            flankAt(profile, bankFor(owFrom, "right")).kerb,
            `${at}: one-way kerb is not the run anchor`,
          ).toBeCloseTo((runMax / 2) * PROFILE_LANE_FRAC, 6);
          return;
        }
        // Centred surfaces (two-way straights, bends, junction arms): the
        // junction-aware pairing, per seam, no min-2 floor.
        const selfAt = laneCountAt(road, port);
        const n = crossingAt(port);
        const expected = isRoadJunction(road)
          ? junctionArmPaintTotal(selfAt, n.crossing, n.junction)
          : roadSeamPaintTotal(selfAt, n.crossing, n.junction);
        expect(seamPaintLanes(level, coord, port), at).toBeCloseTo(expected, 6);
      });
    }
  });
});

describe("symmetry: both tiles of a seam describe the same edge", () => {
  it("agrees on kerb and pavement across every road seam of every board", () => {
    for (const scenario of SCENARIOS) {
      const level = scenario.level;
      eachRoadSeam(level, (tileId, cell, port) => {
        const coord = parseCoordId(tileId);
        const n = neighborCoord(coord, port);
        if (!n) return;
        const nId = `${n.x},${n.y}`;
        const nCell = level[nId];
        if (!nCell?.road?.length) return;
        // The neighbour's road must actually cross the shared seam, or the two
        // tiles are back-to-back streets that never meet.
        const nPorts = new Set<Port>();
        for (const lane of nCell.road) {
          if (lane.from !== Position.Center) nPorts.add(lane.from);
          for (const to of lane.to) if (to !== Position.Center) nPorts.add(to);
        }
        if (!nPorts.has(oppositePort(port))) return;

        const ours = resolveSeamProfile(level, coord, port);
        const theirs = resolveSeamProfile(level, n, oppositePort(port));
        for (const flank of seamFlanks(port)) {
          const a = flankAt(ours, flank);
          const b = flankAt(theirs, flank);
          const at = `${scenario.id} ${tileId}↔${nId} flank ${flank}`;
          // THE ONE DELIBERATE ASYMMETRY: a one-way lane drop's centre-side
          // surface steps a full lane at the gore seam (the closing lane's
          // tarmac stays wide until the hatched gore shuts it). The profile
          // reports the paint's truth on each side rather than smoothing it.
          if (oneWayCentreFlank(cell, flank) || oneWayCentreFlank(nCell, flank)) continue;
          expect(a.kerb, `${at}: kerbs disagree`).toBeCloseTo(b.kerb, 6);
          // The pavement agrees wherever BOTH tiles have one; a tile without a
          // footway simply ends the band at the seam.
          if (a.pavement !== null && b.pavement !== null) {
            expect(a.pavement, `${at}: pavements disagree`).toBeCloseTo(b.pavement, 6);
          }
        }
      });
    }
  });
});

describe("invariants: a profile always reads outward and clear", () => {
  it("orders strips outward with no overlap, pavement clear of parking", () => {
    for (const scenario of SCENARIOS) {
      const level = scenario.level;
      eachRoadSeam(level, (tileId, cell, port) => {
        const profile = resolveSeamProfile(level, parseCoordId(tileId), port);
        for (const f of profile.flanks) {
          const at = `${scenario.id} ${tileId} port ${port} flank ${f.flank}`;
          for (let i = 0; i < f.strips.length; i++) {
            const s = f.strips[i];
            expect(s.outer, `${at}: strip ${s.kind} inverted`).toBeGreaterThanOrEqual(s.inner);
            if (i > 0) {
              expect(
                s.inner,
                `${at}: strip ${s.kind} overlaps ${f.strips[i - 1].kind}`,
              ).toBeGreaterThanOrEqual(f.strips[i - 1].outer - 1e-9);
            }
          }
          if (f.pavement !== null) {
            expect(f.pavement - PAVEMENT_FRAC / 2, `${at}: pavement inside the road`)
              .toBeGreaterThanOrEqual(f.kerb);
            expect(f.pavement + PAVEMENT_FRAC / 2, `${at}: pavement off the tile`)
              .toBeLessThanOrEqual(0.5 + 1e-9);
          }
        }
      });
    }
  });
});

// --- the combination matrix ----------------------------------------------------

type ParkingCombo =
  | "none"
  | "marked"
  | "informal"
  | "drive"
  | "layby"
  | "busstop";

function comboRow(combo: ParkingCombo): TileCell["parking"] {
  switch (combo) {
    case "none":
      return undefined;
    case "marked":
      return { rows: [{ from: Left, side: "right", kind: "parallel", count: 3 }] };
    case "informal":
      return {
        rows: [
          {
            from: Left,
            side: "right",
            kind: "parallel",
            count: 2,
            informal: true,
            marking: "none",
          },
        ],
      };
    case "drive":
      return {
        rows: [
          {
            from: Left,
            side: "right",
            kind: "perpendicular",
            count: 2,
            marking: "none",
            resident: "1,2",
            gap: 1,
          },
        ],
      };
    case "layby":
      return { rows: [{ from: Left, side: "right", kind: "parallel", count: 1, reserved: "long" }] };
    case "busstop":
      return { rows: [{ from: Left, side: "right", kind: "busstop", count: 1, reserved: "bus" }] };
  }
}

type StreetCombo = "2L" | "4L" | "6L" | "1L-oneway" | "2L-oneway";

function comboStreet(street: StreetCombo): TileCell["road"] {
  switch (street) {
    case "2L":
      return twoWay(Left, Right);
    case "4L":
      return [...oneWayLanes(Left, Right, 2), ...oneWayLanes(Right, Left, 2)];
    case "6L":
      return [...oneWayLanes(Left, Right, 3), ...oneWayLanes(Right, Left, 3)];
    case "1L-oneway":
      return [oneWay(Left, Right)];
    case "2L-oneway":
      return oneWayLanes(Left, Right, 2);
  }
}

describe("the combination matrix: street × parking × footway", () => {
  const streets: StreetCombo[] = ["2L", "4L", "6L", "1L-oneway", "2L-oneway"];
  const parkings: ParkingCombo[] = ["none", "marked", "informal", "drive", "layby", "busstop"];

  for (const street of streets) {
    for (const parking of parkings) {
      for (const footway of ["on", "off"] as const) {
        // Deep parking beside a wide road genuinely does not fit — the
        // validator says so and the combination is not authorable. The sweep
        // skips exactly the pairs the validator rejects, and asserts that the
        // REASON is the validator, never a crash or a nonsense profile.
        it(`${street} + ${parking} + footway ${footway}`, () => {
          const mk = (): TileCell => ({
            connections: [],
            road: comboStreet(street),
            terrain: "urban",
            ...(footway === "off" ? { footway: "none" as const } : {}),
          });
          const level: Level = { "0,1": mk(), "1,1": mk(), "2,1": mk(), "1,2": { connections: [], terrain: "urban" } };
          const rows = comboRow(parking);
          if (rows) level["1,1"] = { ...level["1,1"], parking: rows };

          const g = levelBounds(level);
          const issues = validateParking(level, 200, { cols: g.cols, rows: g.rows });
          const authorable = issues.length === 0;

          // Whatever the validator says, the profile must RESOLVE — no crashes,
          // no inverted strips — because the editor shows live boards that are
          // mid-edit and temporarily illegal.
          for (const tileId of ["0,1", "1,1", "2,1"]) {
            for (const port of [Left, Right] as Port[]) {
              const p = resolveSeamProfile(level, parseCoordId(tileId), port);
              for (const f of p.flanks) {
                for (let i = 1; i < f.strips.length; i++) {
                  expect(f.strips[i].inner).toBeGreaterThanOrEqual(f.strips[i - 1].outer - 1e-9);
                }
                if (footway === "off") expect(f.pavement).toBeNull();
                // Footway on: a pavement exists wherever there is ROOM for one.
                // An unauthorable combo (bays deeper than the tile) may squeeze
                // it out entirely, and null is the honest answer there.
                else if (authorable) expect(f.pavement).not.toBeNull();
              }
            }
          }
          if (!authorable) return;

          // An authorable combination must be SYMMETRIC at its seams and keep
          // the cross-section rule: visible kerbside parking below the
          // pavement, everything else leaving the band exactly one verge off
          // the kerb.
          for (const [aId, port] of [
            ["0,1", Right],
            ["1,1", Left],
            ["1,1", Right],
            ["2,1", Left],
          ] as const) {
            const coord = parseCoordId(aId);
            const n = neighborCoord(coord, port)!;
            const ours = resolveSeamProfile(level, coord, port);
            const theirs = resolveSeamProfile(level, n, oppositePort(port));
            for (const flank of seamFlanks(port)) {
              expect(flankAt(ours, flank).kerb).toBeCloseTo(flankAt(theirs, flank).kerb, 6);
              const a = flankAt(ours, flank).pavement;
              const b = flankAt(theirs, flank).pavement;
              if (a !== null && b !== null) expect(a).toBeCloseTo(b, 6);
            }
          }

          if (footway === "on") {
            const p = resolveSeamProfile(level, parseCoordId("1,1"), Left);
            const south = flankAt(p, Bottom);
            const expectStrip = parking === "marked" || parking === "layby";
            expect(south.strips.some(s => s.kind === "parking")).toBe(expectStrip);
            // Drives, bare kerb and halts leave the pavement exactly one verge
            // off the kerb; visible kerbside parking pushes it out by its depth.
            // The clamp can eat the verge on a wide road (a 3+3 boulevard's
            // band sits flush at the kerb), so the expectation is the clamped
            // formula, not the naive kerb + verge.
            const naturalInner = Math.min(
              south.kerb + VERGE_FRAC,
              0.5 - PAVEMENT_FRAC,
            );
            if (!expectStrip) {
              expect(south.pavement! - PAVEMENT_FRAC / 2).toBeCloseTo(naturalInner, 6);
            } else {
              expect(south.pavement! - PAVEMENT_FRAC / 2).toBeGreaterThan(naturalInner);
            }
          }
        });
      }
    }
  }
});
