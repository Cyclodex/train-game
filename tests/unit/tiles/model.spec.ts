import { describe, it, expect } from "vitest";
import { Position, ActiveIntersection } from "@/types";
import {
  samePair,
  pairHas,
  partnersOf,
  portsOf,
  parseCoordId,
  rotatePort,
  rotatePair,
  rotateConnections,
  armExit,
  connectionsToExitPort,
  kindOf,
} from "@/tiles/model";

const { Top, Right, Bottom, Left, Center } = Position;

describe("pair helpers", () => {
  it("samePair is order-independent", () => {
    expect(samePair([Top, Bottom], [Bottom, Top])).toBe(true);
    expect(samePair([Top, Bottom], [Top, Left])).toBe(false);
  });

  it("pairHas detects membership", () => {
    expect(pairHas([Top, Right], Top)).toBe(true);
    expect(pairHas([Top, Right], Bottom)).toBe(false);
  });

  it("partnersOf returns the other end of every connection touching a port", () => {
    const conns = [[Top, Bottom], [Top, Right]] as [Position, Position][];
    expect(partnersOf(conns, Top).sort()).toEqual([Right, Bottom].sort());
    expect(partnersOf(conns, Left)).toEqual([]);
  });

  it("portsOf returns the unique ports used by all connections", () => {
    const conns = [[Top, Bottom]] as [Position, Position][];
    expect(portsOf(conns).sort()).toEqual([Top, Bottom].sort());
  });

  it("parseCoordId splits an x,y id", () => {
    expect(parseCoordId("3,4")).toEqual({ x: 3, y: 4 });
  });
});

describe("rotation", () => {
  it("rotatePort steps T->R->B->L per +1 and leaves Center fixed", () => {
    expect(rotatePort(Top, 1)).toBe(Right);
    expect(rotatePort(Left, 1)).toBe(Top);
    expect(rotatePort(Top, 2)).toBe(Bottom);
    expect(rotatePort(Center, 3)).toBe(Center);
  });

  it("rotatePair rotates both ends", () => {
    expect(rotatePair([Top, Right], 1)).toEqual([Right, Bottom]);
  });

  it("rotateConnections rotates every pair", () => {
    expect(rotateConnections([[Top, Bottom]], 1)).toEqual([[Right, Left]]);
  });
});

const STRAIGHT_V: [Position, Position][] = [[Top, Bottom]];
const CURVE_TR: [Position, Position][] = [[Top, Right]];
const DEPOT_TOP: [Position, Position][] = [[Top, Center]];
const CROSS: [Position, Position][] = [
  [Top, Bottom],
  [Left, Right],
  [Top, Right],
  [Right, Bottom],
  [Bottom, Left],
  [Left, Top],
];

describe("armExit (geometric arm -> exit, entry-relative)", () => {
  it("matches the legacy intersection table for Top entry", () => {
    expect(armExit(Top, ActiveIntersection.Left)).toBe(Right);
    expect(armExit(Top, ActiveIntersection.Straight)).toBe(Bottom);
    expect(armExit(Top, ActiveIntersection.Right)).toBe(Left);
  });
  it("matches for Right entry", () => {
    expect(armExit(Right, ActiveIntersection.Left)).toBe(Bottom);
    expect(armExit(Right, ActiveIntersection.Straight)).toBe(Left);
    expect(armExit(Right, ActiveIntersection.Right)).toBe(Top);
  });
});

describe("connectionsToExitPort", () => {
  it("straight: returns the opposite port, ignores unconnected entries", () => {
    expect(connectionsToExitPort(STRAIGHT_V, Top)).toBe(Bottom);
    expect(connectionsToExitPort(STRAIGHT_V, Bottom)).toBe(Top);
    expect(connectionsToExitPort(STRAIGHT_V, Left)).toBeNull();
  });
  it("curve: returns the single partner", () => {
    expect(connectionsToExitPort(CURVE_TR, Top)).toBe(Right);
    expect(connectionsToExitPort(CURVE_TR, Right)).toBe(Top);
  });
  it("depot: Center<->outer", () => {
    expect(connectionsToExitPort(DEPOT_TOP, Center)).toBe(Top);
    expect(connectionsToExitPort(DEPOT_TOP, Top)).toBe(Center);
  });
  it("junction: needs an arm; resolves arm->exit when that pair exists", () => {
    expect(connectionsToExitPort(CROSS, Top)).toBeNull();
    expect(connectionsToExitPort(CROSS, Top, ActiveIntersection.Straight)).toBe(
      Bottom
    );
    expect(connectionsToExitPort(CROSS, Top, ActiveIntersection.Left)).toBe(
      Right
    );
  });
  it("junction with a missing arm returns null (disabled route)", () => {
    const T: [Position, Position][] = [
      [Left, Right],
      [Left, Top],
      [Right, Top],
    ];
    expect(connectionsToExitPort(T, Bottom, ActiveIntersection.Straight)).toBeNull();
  });
});

describe("kindOf", () => {
  it("labels each shape from its connections + role", () => {
    expect(kindOf({ connections: [] })).toBe("empty");
    expect(kindOf({ connections: [[Top, Center]], role: "depot" })).toBe("depot");
    expect(kindOf({ connections: [[Top, Center]] })).toBe("dead-end");
    expect(kindOf({ connections: [[Top, Bottom]] })).toBe("straight");
    expect(kindOf({ connections: [[Top, Right]] })).toBe("curve");
    expect(
      kindOf({ connections: [[Left, Right], [Left, Top], [Right, Top]] })
    ).toBe("tjunction");
    expect(kindOf({ connections: CROSS })).toBe("cross");
  });
});
