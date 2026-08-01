import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { TileCell } from "@/tiles/model";
import { addConnection, removeConnection, emptyCell } from "@/tiles/editOps";
import {
  BRIDGE_BUILD_FACTOR,
  TUNNEL_BUILD_FACTOR,
  canBuildOn,
  cellCorridors,
  needsTunnel,
  terrainTunnelable,
  terrainBuildFactor,
} from "@/tiles/terrain";
import { planRoute } from "@/tiles/routePlanner";
import { validateLevel } from "@/tiles/validate";

const { Top, Right, Bottom, Left } = Position;
const mountain = (): TileCell => ({ connections: [], terrain: "mountain" });
const rock = (): TileCell => ({ connections: [], terrain: "rock" });

describe("tunnels", () => {
  describe("the exception lives inside canBuildOn", () => {
    it("makes a cell buildable whatever is over it", () => {
      expect(canBuildOn(mountain())).toBe(false);
      expect(canBuildOn(rock())).toBe(false);
      expect(canBuildOn({ ...mountain(), tunnel: true })).toBe(true);
      expect(canBuildOn({ ...rock(), tunnel: true })).toBe(true);
    });

    it("only rock and mountain can be bored — water is bridged, never tunnelled", () => {
      expect(terrainTunnelable("rock")).toBe(true);
      expect(terrainTunnelable("mountain")).toBe(true);
      expect(terrainTunnelable("water")).toBe(false);
      expect(needsTunnel(mountain())).toBe(true);
      expect(needsTunnel({ connections: [], terrain: "water" })).toBe(false);
      // Already bored: nothing more to build.
      expect(needsTunnel({ ...mountain(), tunnel: true })).toBe(false);
    });

    it("satisfies the validator through that same predicate", () => {
      const bore: TileCell = {
        connections: [[Left, Right]],
        terrain: "mountain",
        tunnel: true,
      };
      const level = {
        "0,0": { connections: [[Right, Position.Center]] as TileCell["connections"], role: "depot" as const },
        "1,0": bore,
        "2,0": { connections: [[Left, Position.Center]] as TileCell["connections"], role: "depot" as const },
      };
      const res = validateLevel(level);
      expect(res.issues.filter(i => i.type === "blocked-terrain")).toEqual([]);
      // Without the bore, the same board is illegal.
      const walled = { ...level, "1,0": { ...bore, tunnel: undefined } };
      expect(validateLevel(walled).issues.some(i => i.type === "blocked-terrain")).toBe(true);
    });
  });

  describe("laying a line on rock/mountain bores the tunnel", () => {
    it("marks what it lays, in the one place every build path funnels through", () => {
      expect(addConnection(mountain(), Left, Right).tunnel).toBe(true);
      expect(addConnection(rock(), Left, Right).tunnel).toBe(true);
      // Open ground gets no structure it doesn't need — and water gets a
      // BRIDGE, not a tunnel (no ground is both).
      expect(addConnection(emptyCell(), Left, Right).tunnel).toBeUndefined();
      const spanned = addConnection({ connections: [], terrain: "water" }, Left, Right);
      expect(spanned.bridge).toBe(true);
      expect(spanned.tunnel).toBeUndefined();
    });

    it("takes the bore away with the last line it carried", () => {
      // Otherwise a razed crossing leaves a permanently buildable tile in the
      // middle of the ridge — a free crossing, bought once.
      const bore = addConnection(mountain(), Left, Right);
      expect(removeConnection(bore, Left, Right).tunnel).toBeUndefined();
      // …but not while it still carries something.
      const two = addConnection(bore, Top, Bottom);
      expect(removeConnection(two, Left, Right).tunnel).toBe(true);
    });
  });

  describe("price", () => {
    it("charges for the structure, both before and after it exists", () => {
      expect(terrainBuildFactor(mountain())).toBe(TUNNEL_BUILD_FACTOR);
      expect(terrainBuildFactor({ ...mountain(), tunnel: true })).toBe(TUNNEL_BUILD_FACTOR);
      expect(terrainBuildFactor(emptyCell())).toBe(1);
    });

    it("is dearer than the span, the previous dearest thing", () => {
      expect(TUNNEL_BUILD_FACTOR).toBeGreaterThan(BRIDGE_BUILD_FACTOR);
    });
  });

  describe("the ground stays unbroken over the bore", () => {
    it("lays no rail keep-out corridor on a tunnel cell", () => {
      // The line is underground: clearing the right-of-way would draw the
      // tunnel's route onto the ridge as a bald stripe.
      const open: TileCell = { connections: [[Left, Right]], terrain: "mountain" };
      expect(cellCorridors(open).length).toBe(1);
      expect(cellCorridors({ ...open, tunnel: true }).length).toBe(0);
    });
  });

  describe("the route planner", () => {
    // A two-wide ridge down columns 3-4 of a 9x5 grid, bank to bank.
    const ridge = (c: { x: number; y: number }) => c.x === 3 || c.x === 4;
    const opts = {
      width: 9,
      height: 5,
      passable: (c: { x: number; y: number }) => !ridge(c),
      tunnelable: ridge,
    };

    it("bores through a ridge it cannot go round", () => {
      const steps = planRoute({ id: "1,2", edge: Right }, { id: "6,2", edge: Right }, opts);
      expect(steps).not.toBeNull();
      expect(steps!.some(s => s.id.startsWith("3,"))).toBe(true);
      expect(steps!.some(s => s.id.startsWith("4,"))).toBe(true);
    });

    it("refuses when the ridge cannot be bored at all", () => {
      const steps = planRoute({ id: "1,2", edge: Right }, { id: "6,2", edge: Right }, {
        ...opts,
        tunnelable: () => false,
      });
      expect(steps).toBeNull();
    });

    it("goes round rather than under when going round is close", () => {
      // A single mountain cell with open ground either side. A bore costs nine
      // tiles of routing, so a two-tile detour wins — a lone crag gets rounded,
      // a range gets bored.
      const crag = (c: { x: number; y: number }) => c.x === 3 && c.y === 2;
      const steps = planRoute({ id: "1,2", edge: Right }, { id: "6,2", edge: Right }, {
        width: 9,
        height: 5,
        passable: (c: { x: number; y: number }) => !crag(c),
        tunnelable: crag,
      });
      expect(steps).not.toBeNull();
      expect(steps!.some(s => s.id === "3,2")).toBe(false);
    });
  });
});
