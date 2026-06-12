import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { TileCell, Level } from "@/tiles/model";
import { nWayLanes } from "@/tiles/lanes";
import { deriveJunctionCarLanes } from "@/tiles/editOps";

// --- deriveJunctionCarLanes: the receiving-capacity rule -------------------
// Asserts exactly the user-confirmed examples table in
// docs/superpowers/specs/2026-06-12-junction-lane-capacity-design.md
const { Top, Right, Bottom, Left } = Position;

// a straight two-way street cell with n lanes each way along a..b
const street = (a: Position, b: Position, n: number): TileCell => ({
  connections: [],
  road: nWayLanes(a, b, n),
});

// a junction approach authored all-to-all (what the road tool draws)
const allTo = (from: Position, exits: Position[], n: number) =>
  Array.from({ length: n }, (_, i) => ({ from, to: [...exits], index: i }));

const toSet = (cell: TileCell, from: Position, index: number) => {
  const lane = (cell.road ?? []).find(l => l.from === from && l.index === index);
  return new Set(lane?.to ?? []);
};

describe("deriveJunctionCarLanes (junction lane capacity)", () => {
  it("2L approach, straight 2L + right 1L: inner=S, kerb=S+R", () => {
    const level: Level = {
      "1,1": {
        connections: [],
        road: [...allTo(Left, [Right, Bottom], 2), ...allTo(Right, [Left], 2)],
      },
      "0,1": street(Left, Right, 2),
      "2,1": street(Left, Right, 2),
      "1,2": street(Top, Bottom, 1),
    };
    const out = deriveJunctionCarLanes(level, "1,1");
    expect(toSet(out, Left, 1)).toEqual(new Set([Right])); // inner: straight only
    expect(toSet(out, Left, 0)).toEqual(new Set([Right, Bottom])); // kerb: S+R
  });

  it("2L cross, straight 2L: inner=L+S, kerb=S+R", () => {
    const level: Level = {
      "1,1": {
        connections: [],
        road: [
          ...allTo(Left, [Right, Top, Bottom], 2),
          ...allTo(Right, [Left, Top, Bottom], 2),
          ...allTo(Top, [Bottom, Left, Right], 1),
          ...allTo(Bottom, [Top, Left, Right], 1),
        ],
      },
      "0,1": street(Left, Right, 2),
      "2,1": street(Left, Right, 2),
      "1,0": street(Top, Bottom, 1),
      "1,2": street(Top, Bottom, 1),
    };
    const out = deriveJunctionCarLanes(level, "1,1");
    expect(toSet(out, Left, 1)).toEqual(new Set([Top, Right])); // inner: L+S
    expect(toSet(out, Left, 0)).toEqual(new Set([Right, Bottom])); // kerb: S+R
  });

  it("2L cross, straight 1L: inner=L only, kerb=S+R", () => {
    const level: Level = {
      "1,1": {
        connections: [],
        road: [
          ...allTo(Left, [Right, Top, Bottom], 2),
          ...allTo(Right, [Left, Top, Bottom], 1),
          ...allTo(Top, [Bottom, Left, Right], 1),
          ...allTo(Bottom, [Top, Left, Right], 1),
        ],
      },
      "0,1": street(Left, Right, 2),
      "2,1": street(Left, Right, 1), // straight dest only 1L
      "1,0": street(Top, Bottom, 1),
      "1,2": street(Top, Bottom, 1),
    };
    const out = deriveJunctionCarLanes(level, "1,1");
    expect(toSet(out, Left, 1)).toEqual(new Set([Top])); // inner: left only
    expect(toSet(out, Left, 0)).toEqual(new Set([Right, Bottom])); // kerb: S+R
  });

  it("3L T with right 2L: inner=S, mid=R+S, kerb=R (dual right, mid shares straight)", () => {
    const level: Level = {
      "1,1": {
        connections: [],
        road: [...allTo(Left, [Right, Bottom], 3), ...allTo(Right, [Left], 3)],
      },
      "0,1": street(Left, Right, 3),
      "2,1": street(Left, Right, 3),
      "1,2": street(Top, Bottom, 2), // right dest 2L
    };
    const out = deriveJunctionCarLanes(level, "1,1");
    expect(toSet(out, Left, 2)).toEqual(new Set([Right])); // inner: straight only
    expect(toSet(out, Left, 1)).toEqual(new Set([Bottom, Right])); // mid: R+S (shares straight)
    expect(toSet(out, Left, 0)).toEqual(new Set([Bottom])); // kerb: right only
  });

  it("3L T with left 2L: inner=L, mid=L+S, kerb=S (dual left, mid shares straight)", () => {
    // Mirror of the dual-right case: from Left, the side arm is on Top, which
    // is a LEFT turn. Receiving 2L -> dual left (nL=2). The inner-most lane is
    // a dedicated left pocket; the middle left lane shares L+S so two through
    // lanes survive (the user-requested relax, symmetric to dual right).
    const level: Level = {
      "1,1": {
        connections: [],
        road: [...allTo(Left, [Top, Right], 3), ...allTo(Right, [Left], 3)],
      },
      "0,1": street(Left, Right, 3),
      "2,1": street(Left, Right, 3),
      "1,0": street(Top, Bottom, 2), // left dest 2L
    };
    const out = deriveJunctionCarLanes(level, "1,1");
    expect(toSet(out, Left, 2)).toEqual(new Set([Top])); // inner: left only (pocket)
    expect(toSet(out, Left, 1)).toEqual(new Set([Top, Right])); // mid: L+S (shares straight)
    expect(toSet(out, Left, 0)).toEqual(new Set([Right])); // kerb: straight only
  });

  it("3L cross: inner=L only (even with left cap 2), mid=S, kerb=S+R", () => {
    const level: Level = {
      "1,1": {
        connections: [],
        road: [
          ...allTo(Left, [Right, Top, Bottom], 3),
          ...allTo(Right, [Left, Top, Bottom], 3),
          ...allTo(Top, [Bottom, Left, Right], 2),
          ...allTo(Bottom, [Top, Left, Right], 1),
        ],
      },
      "0,1": street(Left, Right, 3),
      "2,1": street(Left, Right, 3),
      "1,0": street(Top, Bottom, 2), // left dest 2L — still single left
      "1,2": street(Top, Bottom, 1),
    };
    const out = deriveJunctionCarLanes(level, "1,1");
    expect(toSet(out, Left, 2)).toEqual(new Set([Top])); // inner: LEFT ONLY
    expect(toSet(out, Left, 1)).toEqual(new Set([Right])); // mid: straight
    expect(toSet(out, Left, 0)).toEqual(new Set([Right, Bottom])); // kerb: S+R
  });

  it("1L approach keeps all movements (nearest-lane landings are runtime)", () => {
    const level: Level = {
      "1,1": {
        connections: [],
        road: [
          ...allTo(Left, [Right, Top, Bottom], 1),
          ...allTo(Right, [Left, Top, Bottom], 3),
          ...allTo(Top, [Bottom, Left, Right], 3),
          ...allTo(Bottom, [Top, Left, Right], 3),
        ],
      },
      "0,1": street(Left, Right, 1),
      "2,1": street(Left, Right, 3),
      "1,0": street(Top, Bottom, 3),
      "1,2": street(Top, Bottom, 3),
    };
    const out = deriveJunctionCarLanes(level, "1,1");
    expect(toSet(out, Left, 0)).toEqual(new Set([Right, Top, Bottom]));
  });

  it("counts only CAR lanes as receiving capacity (kerb bus lane on dest)", () => {
    // right dest arm: 2 lanes but the kerb one is bus-only -> car capacity 1
    // -> single right (shared S+R kerb), NOT a dual right.
    const busKerb = (): TileCell => ({
      connections: [],
      road: [
        { from: Top, to: [Bottom], index: 0, kind: "bus" },
        { from: Top, to: [Bottom], index: 1 },
        { from: Bottom, to: [Top], index: 0, kind: "bus" },
        { from: Bottom, to: [Top], index: 1 },
      ],
    });
    const level: Level = {
      "1,1": {
        connections: [],
        road: [...allTo(Left, [Right, Bottom], 3), ...allTo(Right, [Left], 3)],
      },
      "0,1": street(Left, Right, 3),
      "2,1": street(Left, Right, 3),
      "1,2": busKerb(),
    };
    const out = deriveJunctionCarLanes(level, "1,1");
    expect(toSet(out, Left, 2)).toEqual(new Set([Right])); // inner: straight
    expect(toSet(out, Left, 1)).toEqual(new Set([Right])); // mid: straight
    expect(toSet(out, Left, 0)).toEqual(new Set([Right, Bottom])); // kerb: S+R
  });


  it("allArms (editor heal) restores movements an older sync ate", () => {
    // A user-reported T-junction of bus-only streets where the R approach had
    // lost its straight-through (busTo only [Top]) — the editor invariant is
    // all arms reach all arms, so the editor-heal restores Right -> Left.
    const busStreetEW = (): TileCell => ({
      connections: [],
      road: [
        { from: Left, to: [Right], index: 0, kind: "bus" },
        { from: Right, to: [Left], index: 0, kind: "bus" },
      ],
    });
    const busStreetNS = (): TileCell => ({
      connections: [],
      road: [
        { from: Top, to: [Bottom], index: 0, kind: "bus" },
        { from: Bottom, to: [Top], index: 0, kind: "bus" },
      ],
    });
    const level: Level = {
      "1,1": {
        connections: [],
        road: [
          { from: Top, to: [], busTo: [Right, Left], index: 0 },
          { from: Right, to: [], busTo: [Top], index: 0 }, // straight to Left LOST
          { from: Left, to: [], busTo: [Right, Top], index: 0 },
        ],
      },
      "1,0": busStreetNS(),
      "0,1": busStreetEW(),
      "2,1": busStreetEW(),
    };
    // Default derivation preserves the damage (it never invents movements).
    const kept = deriveJunctionCarLanes(level, "1,1");
    expect(toSet(kept, Right, 0).has(Left)).toBe(false);
    // The editor heal (allArms) restores the editor invariant.
    const healed = deriveJunctionCarLanes(level, "1,1", true);
    expect(toSet(healed, Right, 0).has(Left)).toBe(true);
    expect(toSet(healed, Top, 0)).toEqual(new Set([Right, Left]));
  });

  it("is idempotent and preserves removed movements", () => {
    const level: Level = {
      "1,1": {
        connections: [],
        // author removed the left turn entirely: only S+R reachable
        road: [...allTo(Left, [Right, Bottom], 2), ...allTo(Right, [Left], 2)],
      },
      "0,1": street(Left, Right, 2),
      "2,1": street(Left, Right, 2),
      "1,2": street(Top, Bottom, 1),
    };
    const once = deriveJunctionCarLanes(level, "1,1");
    expect(toSet(once, Left, 1).has(Top)).toBe(false); // no Top movement invented
    const level2: Level = { ...level, "1,1": once };
    const twice = deriveJunctionCarLanes(level2, "1,1");
    expect(twice).toBe(once); // unchanged object => idempotent
  });
});
