import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { TileCell } from "@/tiles/model";
import { addConnection, removeConnection, emptyCell } from "@/tiles/editOps";
import {
  BRIDGE_BUILD_FACTOR,
  canBuildOn,
  needsBridge,
  terrainBridgeable,
  terrainBuildFactor,
} from "@/tiles/terrain";
import { planRoute } from "@/tiles/routePlanner";
import { validateLevel } from "@/tiles/validate";
import { createSimulation } from "@/sim/simulation";
import { createRoadSim } from "@/sim/road";
import { bridge } from "@/levels/test/scenarios/bridge";

const { Top, Right, Bottom, Left } = Position;
const water = (): TileCell => ({ connections: [], terrain: "water" });

describe("bridges", () => {
  describe("the exception lives inside canBuildOn", () => {
    it("makes a cell buildable whatever is under it", () => {
      expect(canBuildOn(water())).toBe(false);
      expect(canBuildOn({ ...water(), bridge: true })).toBe(true);
    });

    it("only water can be spanned — rock and mountain wait for a tunnel", () => {
      expect(terrainBridgeable("water")).toBe(true);
      expect(terrainBridgeable("rock")).toBe(false);
      expect(terrainBridgeable("mountain")).toBe(false);
      expect(needsBridge(water())).toBe(true);
      expect(needsBridge({ connections: [], terrain: "rock" })).toBe(false);
      // Already spanned: nothing more to build.
      expect(needsBridge({ ...water(), bridge: true })).toBe(false);
    });

    it("satisfies the validator through that same predicate", () => {
      // The point of putting the exception inside canBuildOn rather than beside
      // it: `validateLevel` learns about bridges without being told.
      const span: TileCell = {
        connections: [[Left, Right]],
        terrain: "water",
        bridge: true,
      };
      const level = {
        "0,0": { connections: [[Right, Position.Center]] as TileCell["connections"], role: "depot" as const },
        "1,0": span,
        "2,0": { connections: [[Left, Position.Center]] as TileCell["connections"], role: "depot" as const },
      };
      const res = validateLevel(level);
      expect(res.issues.filter(i => i.type === "blocked-terrain")).toEqual([]);
      // Without the span, the same board is illegal.
      const drowned = { ...level, "1,0": { ...span, bridge: undefined } };
      expect(validateLevel(drowned).issues.some(i => i.type === "blocked-terrain")).toBe(true);
    });
  });

  describe("laying a line on water builds the span", () => {
    it("marks what it lays, in the one place every build path funnels through", () => {
      expect(addConnection(water(), Left, Right).bridge).toBe(true);
      // Dry ground gets no structure it doesn't need.
      expect(addConnection(emptyCell(), Left, Right).bridge).toBeUndefined();
      expect(addConnection({ connections: [], terrain: "forest" }, Left, Right).bridge)
        .toBeUndefined();
    });

    it("takes the span away with the last line it carried", () => {
      // Otherwise a razed crossing leaves a permanently buildable tile in the
      // middle of the river — a free crossing, bought once.
      const span = addConnection(water(), Left, Right);
      expect(removeConnection(span, Left, Right).bridge).toBeUndefined();
      // …but not while it still carries something.
      const two = addConnection(span, Top, Bottom);
      expect(removeConnection(two, Left, Right).bridge).toBe(true);
    });
  });

  describe("price", () => {
    it("charges for the structure, both before and after it exists", () => {
      // The build verb prices a route BEFORE the edit lands, so a factor that
      // only recognised the finished bridge would quote every crossing at the
      // price of open water.
      expect(terrainBuildFactor(water())).toBe(BRIDGE_BUILD_FACTOR);
      expect(terrainBuildFactor({ ...water(), bridge: true })).toBe(BRIDGE_BUILD_FACTOR);
      expect(terrainBuildFactor(emptyCell())).toBe(1);
    });

    it("is the dearest thing to build", () => {
      expect(BRIDGE_BUILD_FACTOR).toBeGreaterThan(terrainBuildFactor({ connections: [], terrain: "urban" }));
    });
  });

  describe("what actually crosses it (the /test/bridge board)", () => {
    // A span is only a bridge if traffic uses it. Run on the scenario's OWN
    // board, so a change to the demo fails here rather than quietly leaving a
    // crossing nothing can cross.
    const railRow = 2;
    const roadRow = 5;

    it("carries a train from bank to bank", () => {
      const sim = createSimulation({
        level: bridge.level,
        depotColors: { [`0,${railRow}`]: "blue", [`8,${railRow}`]: "green" },
        trains: [
          {
            id: "train1",
            coord: { x: 0, y: railRow },
            entryPort: Position.Center,
            color: "green",
            type: "people",
            wagonCount: 2,
            speed: 1,
          },
        ],
      });
      const events = [];
      for (let i = 0; i < 400; i++) events.push(...sim.step(0.1));
      // The river runs bank to bank, so reaching the far depot IS the crossing.
      expect(sim.trainState("train1")).toBe("parked");
      expect(events.some(e => e.type === "arrived")).toBe(true);
    });

    it("carries cars over the road span", () => {
      const sim = createRoadSim({
        level: bridge.level,
        width: bridge.size!.cols,
        height: bridge.size!.rows,
        seed: 5,
        spawnInterval: 0.5,
        carSpeed: 0.5,
        carLength: 0.2,
        maxCars: 8,
      });
      const span = `4,${roadRow}`;
      let onSpan = 0;
      let crossed = 0;
      const seenWest = new Set<string>();
      for (let i = 0; i < 1500; i++) {
        sim.step(0.05, () => false);
        for (const c of sim.sample()) {
          for (const u of c.units) {
            for (const s of [u.front, u.rear]) {
              const id = `${s.coord.x},${s.coord.y}`;
              if (id === span) onSpan++;
              // Bank to bank: seen west of the river, later seen east of it.
              if (s.coord.y === roadRow && s.coord.x <= 2) seenWest.add(c.id);
              if (s.coord.y === roadRow && s.coord.x >= 6 && seenWest.has(c.id)) {
                crossed++;
              }
            }
          }
        }
      }
      expect(onSpan).toBeGreaterThan(0);
      expect(crossed).toBeGreaterThan(0);
    }, 30000); // heavy sim loop — fine alone, can exceed 5s under full-suite load
  });

  describe("the route planner", () => {
    // A one-wide river down column 3 of an 8x5 grid.
    const river = (c: { x: number; y: number }) => c.x === 3;
    const opts = {
      width: 8,
      height: 5,
      passable: (c: { x: number; y: number }) => !river(c),
      bridgeable: river,
    };

    it("crosses a river it cannot go round", () => {
      // The river runs bank to bank, so there is no dry way: without the
      // bridgeable gate this simply returns null and the feature is unbuildable.
      const steps = planRoute({ id: "1,2", edge: Right }, { id: "6,2", edge: Right }, opts);
      expect(steps).not.toBeNull();
      expect(steps!.some(s => s.id.startsWith("3,"))).toBe(true);
    });

    it("refuses when the water cannot be spanned at all", () => {
      // The same board with rock instead of water: no `bridgeable`, no route.
      const steps = planRoute({ id: "1,2", edge: Right }, { id: "6,2", edge: Right }, {
        ...opts,
        bridgeable: () => false,
      });
      expect(steps).toBeNull();
    });

    it("goes round rather than over when going round is close", () => {
      // A single water cell with dry ground either side of it. A span costs six
      // tiles of routing, so a two-tile detour wins — which is the whole design:
      // a lake gets routed around, a river gets bridged.
      const pond = (c: { x: number; y: number }) => c.x === 3 && c.y === 2;
      const steps = planRoute({ id: "1,2", edge: Right }, { id: "6,2", edge: Right }, {
        width: 8,
        height: 5,
        passable: (c: { x: number; y: number }) => !pond(c),
        bridgeable: pond,
      });
      expect(steps).not.toBeNull();
      expect(steps!.some(s => s.id === "3,2")).toBe(false);
    });
  });
});
