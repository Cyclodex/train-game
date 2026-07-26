import { describe, it, expect } from "vitest";
import { isOpenEnd, openEndPortsAt, buildTargetsAt, allOpenEnds } from "@/tiles/openEnds";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";
import { Position } from "@/types";

const L = Position.Left;
const R = Position.Right;
const T = Position.Top;
const B = Position.Bottom;

// The buildgap shape: rail stops at 2,1's east edge; 3,1 and 4,1 are empty;
// rail resumes at 5,1 whose west edge is the facing open end.
function gapLevel(): Level {
  return {
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    "2,1": expandKind("straight", 1),
    "5,1": expandKind("straight", 1),
    "6,1": expandKind("depot", 3),
  };
}

describe("open ends", () => {
  it("finds the edge where a line stops", () => {
    const level = gapLevel();
    expect(isOpenEnd(level, "2,1", R)).toBe(true);
    // ...and not the edge that joins its neighbour.
    expect(isOpenEnd(level, "2,1", L)).toBe(false);
  });

  it("does not invent ends on edges the tile has no rail on", () => {
    const level = gapLevel();
    expect(isOpenEnd(level, "2,1", T)).toBe(false);
    expect(isOpenEnd(level, "2,1", B)).toBe(false);
    expect(isOpenEnd(level, "3,1", L)).toBe(false); // empty tile: nothing to end
  });

  it("treats rail running off the map as an end", () => {
    const level: Level = { "0,0": expandKind("straight", 1) };
    expect(isOpenEnd(level, "0,0", L)).toBe(true);
    expect(isOpenEnd(level, "0,0", R)).toBe(true);
  });

  it("counts a depot's own mouth", () => {
    // A depot connects Center↔edge; if nothing meets that edge it is a place
    // you can build from, which is how a severed station gets reconnected.
    const level: Level = { "0,0": expandKind("depot", 1) };
    expect(openEndPortsAt(level, "0,0")).toEqual([R]);
  });

  it("lists exactly the two ends of the gap board", () => {
    const ends = allOpenEnds(gapLevel());
    expect(ends).toContainEqual({ id: "2,1", edge: R });
    expect(ends).toContainEqual({ id: "5,1", edge: L });
    // 0,1 and 6,1 are depots whose mouths are joined; nothing else dangles.
    expect(ends).toHaveLength(2);
  });

  describe("buildTargetsAt — the forgiving part", () => {
    it("offers the open end from the tile that owns the rail", () => {
      const targets = buildTargetsAt(gapLevel(), "2,1");
      expect(targets).toEqual([{ port: R, end: { id: "2,1", edge: R } }]);
    });

    it("ALSO offers it from the empty tile facing it", () => {
      // The point of the whole change: the end of a line is one physical place
      // on a boundary between two tiles. Clicking the empty side used to arm a
      // different anchor; now it delegates to the same open end.
      const targets = buildTargetsAt(gapLevel(), "3,1");
      expect(targets).toEqual([{ port: L, end: { id: "2,1", edge: R } }]);
    });

    it("offers nothing on a tile nowhere near an end", () => {
      // 4,0 sits off the line entirely — a click there does nothing, rather
      // than arming something wrong.
      expect(buildTargetsAt(gapLevel(), "4,0")).toEqual([]);
      // And a tile mid-line has no ends either: you grow from the end, not the
      // middle (tapping the side of a line buys an unreachable crossing).
      expect(buildTargetsAt(gapLevel(), "1,1")).toEqual([]);
    });

    it("offers the far end from the gap tile beside it", () => {
      // Both gap tiles are adjacent to an end — 3,1 to the west line's, 4,1 to
      // the east line's — so either can start the route that closes the gap.
      expect(buildTargetsAt(gapLevel(), "4,1")).toEqual([
        { port: R, end: { id: "5,1", edge: L } },
      ]);
    });

    it("offers both ends where two lines stop against the same tile", () => {
      // A one-tile gap: the empty tile faces an open end on either side, so it
      // carries two targets and each arms its own line.
      const level: Level = {
        "0,0": expandKind("straight", 1),
        "2,0": expandKind("straight", 1),
      };
      const targets = buildTargetsAt(level, "1,0");
      expect(targets).toContainEqual({ port: L, end: { id: "0,0", edge: R } });
      expect(targets).toContainEqual({ port: R, end: { id: "2,0", edge: L } });
      expect(targets).toHaveLength(2);
    });
  });
});
