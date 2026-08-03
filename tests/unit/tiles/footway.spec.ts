import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level, TileCell } from "@/tiles/model";
import { nWayLanes, oneWay, twoWay } from "@/tiles/lanes";
import { expandKind } from "@/tiles/kinds";
import {
  hasFootCrossing,
  hasFootway,
  pavementOffsets,
  pavementOffsetFor,
  hasRailCrossing,
  pavementPaths,
  planWalk,
  roadHalfUnits,
  sideOfPlot,
  walkNeighbours,
} from "@/tiles/footway";

const town = (): TileCell => ({ connections: [], terrain: "urban" });
const street = (from = Position.Left, to = Position.Right): TileCell => ({
  connections: [],
  road: twoWay(from, to),
  terrain: "urban",
});

// The pavement art of ONE cell standing on its own. `pavementPaths` seam-matches
// each end to its neighbour, so it takes the level; an isolated tile has none
// and keeps its own full width, which is what these cases are about.
const draw = (cell: TileCell, size = 100): string => pavementPaths({ "0,0": cell }, "0,0", size);

describe("footways: derived by default, opt out explicitly", () => {
  it("gives every street a pavement without anyone asking", () => {
    expect(hasFootway(street())).toBe(true);
    // ...which is what lets every board written before footways existed grow
    // them for free.
    expect(hasFootway(town())).toBe(false);
    expect(hasFootway(expandKind("straight", 1))).toBe(false);
  });

  it("takes them away only when the tile says so", () => {
    expect(hasFootway({ ...street(), footway: "none" })).toBe(false);
    expect(hasFootway({ ...street(), footway: "both" })).toBe(true);
  });

  it("pushes the pavement out on a wider road", () => {
    const narrow = street();
    const wide: TileCell = {
      connections: [],
      road: nWayLanes(Position.Left, Position.Right, 3),
    };
    expect(roadHalfUnits(wide)).toBeGreaterThan(roadHalfUnits(narrow));
    const [a] = pavementOffsets(wide);
    const [b] = pavementOffsets(narrow);
    expect(a).toBeGreaterThan(b);
    // Symmetric: one pavement each side of the carriageway.
    expect(pavementOffsets(narrow)[1]).toBe(-pavementOffsets(narrow)[0]);
  });

  it("draws one band per side and never twice for a two-way street", () => {
    // twoWay is two lanes over the SAME ground; painting per lane would stack
    // two bands per side and show a seam at every tile edge.
    const paths = draw(street()).match(/<path /g) ?? [];
    expect(paths).toHaveLength(2);
    expect(draw(town())).toBe("");
    expect(draw({ ...street(), footway: "none" })).toBe("");
  });

  // THE BUG THAT VANISHED THE PAVEMENT ON EVERY BEND. A curve carries no lanes
  // on the port opposite an arm, so the old `laneCount(p) + laneCount(opposite)`
  // sum measured every bend as the 2-lane minimum: a 2-lanes-each-way street
  // laid its band 28 units in from its own kerb — under the tarmac, which is
  // painted over it — and the pavement disappeared for the length of the corner.
  it("keeps a multi-lane bend's pavement OUTSIDE the tarmac", () => {
    const straight: TileCell = {
      connections: [],
      road: nWayLanes(Position.Left, Position.Right, 2),
    };
    const bend: TileCell = {
      connections: [],
      road: nWayLanes(Position.Left, Position.Bottom, 2),
    };
    // A bend is exactly as wide as the straight it continues — 4 lanes across,
    // so its kerb (and its pavement) sits at the same distance out. Before the
    // fix the bend measured 2 lanes and the band landed under the road.
    expect(roadHalfUnits(bend)).toBe(2 * 14);
    expect(roadHalfUnits(bend)).toBe(roadHalfUnits(straight));
    expect(pavementOffsets(bend)[0]).toBeGreaterThan(roadHalfUnits(bend));
  });

  // A 1-lane one-way street is drawn its true ONE lane wide (the run-max kerb
  // anchor), so a min-2 floor left its pavement floating half a lane out in the
  // grass with a strip of ground behind the kerb.
  it("hugs the kerb of a single-lane one-way street", () => {
    const one: TileCell = { connections: [], road: [oneWay(Position.Left, Position.Right)] };
    expect(roadHalfUnits(one)).toBe(7);
    expect(roadHalfUnits(street())).toBe(14);
  });

  // A width change is a TAPER on the tarmac, so it has to be a taper on the
  // pavement too: measure the band against the tile alone and it steps sideways
  // at a seam where the kerb it follows does not.
  it("meets a narrower neighbour flush instead of stepping at the seam", () => {
    const level: Level = {
      "0,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
      "1,0": street(),
    };
    const endOf = (id: string, which: 0 | 1) =>
      [...pavementPaths(level, id, 100).matchAll(/d="M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)"/g)]
        .map(m => (which === 0 ? Number(m[2]) : Number(m[4])))
        .sort((a, b) => a - b);
    // The wide tile's right-hand end and the narrow tile's left-hand end are the
    // same seam: the two bands have to arrive at the same y.
    expect(endOf("0,0", 1)).toEqual(endOf("1,0", 0));
  });
});

describe("the walking graph", () => {
  function highStreet(): Level {
    const level: Level = {};
    for (let x = 0; x <= 4; x++) level[`${x},1`] = street();
    for (let x = 0; x <= 4; x++) level[`${x},0`] = town(); // houses along the north kerb
    for (let x = 0; x <= 4; x++) level[`${x},2`] = town(); // and the south
    return level;
  }

  it("steps between adjoining pavements, and nowhere else", () => {
    const level = highStreet();
    expect(walkNeighbours(level, "2,1").sort()).toEqual(["1,1", "3,1"]);
    // A house is not a pavement: you step off it onto one, you do not walk
    // THROUGH it (which is what keeps people visibly on the street).
    expect(walkNeighbours(level, "2,0")).toEqual([]);
  });

  it("knows which pavement a house stands on", () => {
    const level = highStreet();
    // North and south of the same street are opposite sides, and the sign
    // matches the one `pavementOffsets` uses so the walker lands on the paint.
    expect(sideOfPlot(level, "2,0", "2,1")).toBe(-1);
    expect(sideOfPlot(level, "2,2", "2,1")).toBe(1);
  });

  it("routes along one pavement when both doors are on the same side", () => {
    const level = highStreet();
    const route = planWalk(level, "0,0", "4,0");
    expect(route?.tiles).toEqual(["0,1", "1,1", "2,1", "3,1", "4,1"]);
    // Never changes side: there is no crossing, and none is needed.
    expect(new Set(route?.sides)).toEqual(new Set([-1]));
  });

  it("WILL NOT CROSS THE ROAD without a crossing", () => {
    // The mechanic, stated as a refusal. Two doors facing each other across a
    // street with no zebra between them are not walkable, and the citizen layer
    // falls back to its clock rather than teleporting somebody over the tarmac.
    const level = highStreet();
    expect(planWalk(level, "2,0", "2,2")).toBeNull();
  });

  it("crosses at a zebra, and takes the detour to reach one", () => {
    const level = highStreet();
    level["4,1"] = { ...street(), footCrossing: true };
    expect(hasFootCrossing(level["4,1"])).toBe(true);
    expect(hasFootCrossing(level["2,1"])).toBe(false);

    const route = planWalk(level, "2,0", "2,2");
    expect(route).not.toBeNull();
    // Down to the crossing, over it, and back — the detour is the cost of
    // putting the zebra where it is.
    expect(route?.tiles).toEqual(["2,1", "3,1", "4,1", "4,1", "3,1", "2,1"]);
    // The tile appears twice: once on each pavement. That repeat IS the crossing.
    expect(route?.sides).toEqual([-1, -1, -1, 1, 1, 1]);
  });

  it("crosses on the spot when the zebra is right there", () => {
    const level = highStreet();
    level["2,1"] = { ...street(), footCrossing: true };
    const route = planWalk(level, "2,0", "2,2");
    expect(route?.tiles).toEqual(["2,1", "2,1"]);
    expect(route?.sides).toEqual([-1, 1]);
  });

  it("returns null rather than a bad route when there is no way to walk", () => {
    const level = highStreet();
    expect(planWalk(level, "2,0", "2,0")).toBeNull(); // already there
    // A house with no street in reach.
    level["9,9"] = town();
    expect(planWalk(level, "2,0", "9,9")).toBeNull();
    // Two streets with a gap between them: no pavement joins the pieces.
    const split: Level = {
      "0,1": street(),
      "0,0": town(),
      "4,1": street(),
      "4,0": town(),
    };
    expect(planWalk(split, "0,0", "4,0")).toBeNull();
  });

  it("will not route over a street that opted out of its pavement", () => {
    const level = highStreet();
    level["2,1"] = { ...street(), footway: "none" };
    // The motorway in the middle severs the walk; nothing else can get past it.
    expect(planWalk(level, "0,0", "4,0")).toBeNull();
    // ...and a crossing on a street with no pavement is not a crossing.
    expect(hasFootCrossing({ ...street(), footway: "none", footCrossing: true })).toBe(false);
  });
});

describe("which bank of the street a walker is on", () => {
  // A `side` belongs to the STREET; the offset the geometry sampler wants
  // belongs to the walker's DIRECTION OF TRAVEL. Getting those two confused put
  // people on the wrong pavement the moment they walked back the other way, and
  // the driveway at the far end then dragged them over the carriageway.
  it("flips the offset when the walk runs against the tile's own direction", () => {
    const cell = street(Position.Left, Position.Right); // canonical: eastbound
    const [half] = pavementOffsets(cell);

    // Eastbound, side +1: right of travel, so the south bank.
    expect(pavementOffsetFor(cell, 1, Position.Left, Position.Right)).toBeCloseTo(half);
    // Westbound, side +1: STILL the south bank, which is now on the left — so
    // the offset handed to the sampler has to change sign.
    expect(pavementOffsetFor(cell, -1, Position.Right, Position.Left)).toBeCloseTo(half);
    expect(pavementOffsetFor(cell, 1, Position.Right, Position.Left)).toBeCloseTo(-half);
  });

  it("agrees with the side a plot is assigned, whichever way it is walked", () => {
    const level: Level = { "1,1": street(), "1,0": town(), "1,2": town() };
    const north = sideOfPlot(level, "1,0", "1,1") as 1 | -1;
    const south = sideOfPlot(level, "1,2", "1,1") as 1 | -1;
    expect(north).toBe(-south);
    // The house north of the street is north of the centreline no matter which
    // way its owner happens to be walking.
    const cell = level["1,1"];
    expect(pavementOffsetFor(cell, north, Position.Left, Position.Right)).toBeLessThan(0);
    expect(pavementOffsetFor(cell, north, Position.Right, Position.Left)).toBeGreaterThan(0);
  });

  it("keeps a bend's two directions on the same pavement", () => {
    const bend: TileCell = { connections: [], road: twoWay(Position.Top, Position.Right) };
    const [half] = pavementOffsets(bend);
    expect(pavementOffsetFor(bend, 1, Position.Top, Position.Right)).toBeCloseTo(half);
    expect(pavementOffsetFor(bend, 1, Position.Right, Position.Top)).toBeCloseTo(-half);
  });
});

describe("the pavement reaches the tile boundary", () => {
  // "Not connected to each other" was the report, and it was true: a plot's
  // ground patch is jittered OFF the tile grid on purpose and so spills into
  // the road tile beside it, and both were painted in the same z band. The
  // renderer fix is a layer of its own (TileGround → .tile-paving); this is the
  // geometry half of the contract, so a band can never be authored short.
  it("starts on one edge and ends on the other, on a straight", () => {
    const d = draw(street(), 100);
    // Every band on a straight runs the full width of the tile.
    const ends = [...d.matchAll(/d="M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+)"/g)];
    expect(ends.length).toBe(2);
    for (const [, x0, , x1] of ends) {
      expect(Number(x0)).toBe(0);
      expect(Number(x1)).toBe(100);
    }
  });

  it("meets the tile edge on a bend too, on both sides", () => {
    const bend: TileCell = { connections: [], road: twoWay(Position.Left, Position.Bottom) };
    const ds = [...draw(bend, 100).matchAll(/ d="([^"]+)"/g)].map(m => m[1]);
    expect(ds.length).toBe(2);
    for (const d of ds) {
      const pts = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
      const [first] = pts;
      const last = pts[pts.length - 1];
      // A bend enters on one edge and leaves on another: both ends sit exactly
      // on a boundary (x or y at 0 or 100).
      for (const p of [first, last]) {
        expect(p[0] === 0 || p[0] === 100 || p[1] === 0 || p[1] === 100).toBe(true);
      }
    }
  });
});

describe("walking over the railway", () => {
  it("is a crossing wherever a pavement and the rails share a tile", () => {
    // Derived, not authored — so every level crossing on every board that
    // already exists is a pedestrian crossing with nothing to change.
    const levelCrossing: TileCell = {
      ...expandKind("straight", 0), // vertical rail
      road: twoWay(Position.Left, Position.Right),
    };
    expect(hasRailCrossing(levelCrossing)).toBe(true);
    // Rails alone are not: nobody walks there, there is no pavement.
    expect(hasRailCrossing(expandKind("straight", 0))).toBe(false);
    // A plain street is not either — that is what a `footCrossing` is for.
    expect(hasRailCrossing(street())).toBe(false);
    // ...and a crossing whose street opted out of its pavement is not one.
    expect(hasRailCrossing({ ...levelCrossing, footway: "none" })).toBe(false);
  });
});
