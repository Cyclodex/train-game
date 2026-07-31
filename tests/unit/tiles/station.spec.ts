import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { kindOf, TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { toggleStation, hasThroughTrack } from "@/tiles/editOps";
import { validateLevel } from "@/tiles/validate";

const { Top, Right, Bottom, Left, Center } = Position;

describe("station tile model", () => {
  it("expandKind builds a station: through-track straight with the role", () => {
    const cell = expandKind("station", 1);
    expect(cell.role).toBe("station");
    expect(cell.connections).toEqual([[Right, Left]]);
    expect(kindOf(cell)).toBe("station");
  });

  it("toggleStation toggles on through-track and refuses elsewhere", () => {
    const straight: TileCell = { connections: [[Top, Bottom]] };
    const on = toggleStation(straight);
    expect(on.role).toBe("station");
    const off = toggleStation(on);
    expect(off.role).toBeUndefined();

    // A curve is through-track too — a station on a curve is legal.
    const curve: TileCell = { connections: [[Top, Right]] };
    expect(toggleStation(curve).role).toBe("station");

    // A depot stays a depot; an empty cell stays empty (same reference back).
    const depot = expandKind("depot", 0);
    expect(toggleStation(depot)).toBe(depot);
    const empty: TileCell = { connections: [] };
    expect(toggleStation(empty)).toBe(empty);
  });

  it("hasThroughTrack sees edge-to-edge pairs and not the depot stub", () => {
    expect(hasThroughTrack({ connections: [[Left, Right]] })).toBe(true);
    expect(hasThroughTrack({ connections: [[Top, Center]] })).toBe(false);
    expect(hasThroughTrack({ connections: [] })).toBe(false);
  });
});

describe("station validation", () => {
  it("accepts a station on connected through-track", () => {
    const res = validateLevel({
      "0,0": expandKind("depot", 1),
      "1,0": expandKind("station", 1),
      "2,0": expandKind("depot", 3),
    });
    expect(res.ok).toBe(true);
  });

  it("flags a station with no through-track or with a Center stub", () => {
    const bare = validateLevel({
      "0,0": { connections: [], role: "station" },
    });
    expect(bare.issues.some(i => i.type === "invalid-station")).toBe(true);

    const stub = validateLevel({
      "0,0": { connections: [[Top, Center]], role: "station" },
    });
    expect(stub.issues.some(i => i.type === "invalid-station")).toBe(true);
  });
});
