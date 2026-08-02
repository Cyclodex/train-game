import { describe, it, expect } from "vitest";
import { itSlow } from "../support/tier";
import { scenarioById } from "@/levels/test";
import { oppositePort } from "@/sim/topology";
import { terrainBlocksBuilding, terrainOf } from "@/tiles/terrain";
import { simFor } from "../support/roadSim";

// The demo world is the one board meant to show the whole game at once, so the
// things that make it a *world* rather than a diorama are worth pinning.
//
// Read through `scenarioById`, not the raw export: the registry applies the same
// junction lane sync the editor does, and that is what the running game sees.
const demoworld = scenarioById("demoworld");

describe("demoworld", () => {
  itSlow("has crossroads cars can actually turn at", () => {
    // A four-way junction authored as just the two opposite-port pairs
    // (`twoWay(L,R) + twoWay(T,B)`) looks exactly like a crossroads and behaves
    // like a flyover: every car goes straight through, nobody can turn. The
    // junction sync cannot fix it either — it only re-distributes exits a lane
    // already reaches. So assert the behaviour, not the authoring.
    const sim = simFor(demoworld, 5);
    const junctions = new Set(["9,6", "13,6", "9,9", "13,9"]);
    let straight = 0;
    let turned = 0;
    const counted = new Set<string>();

    for (let i = 0; i < 3000; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        const id = `${f.coord.x},${f.coord.y}`;
        if (!junctions.has(id) || f.exitPort === null) continue;
        const key = `${c.id}@${id}`;
        if (counted.has(key)) continue; // count each car's pass once
        counted.add(key);
        if (f.exitPort === oppositePort(f.entryPort)) straight++;
        else turned++;
      }
    }

    expect(straight, "no car crossed a junction at all").toBeGreaterThan(0);
    expect(turned, "every car went straight through — the crosses allow no turns").toBeGreaterThan(0);
    // Not a precise ratio (it depends on routing and the seed), just that turning
    // is ordinary rather than a fluke.
    expect(turned / (turned + straight)).toBeGreaterThan(0.15);
  }, 60000);

  it("keeps every level crossing on a plain straight", () => {
    // A crossing may only sit where the rail runs straight through — never on a
    // curve, a spur junction or a depot, where the gate furniture and the
    // reservation would gate the wrong thing.
    for (const [id, cell] of Object.entries(demoworld.level)) {
      if (!cell.road?.length || !cell.connections.length) continue;
      expect(cell.connections.length, `${id} is a crossing on a non-straight tile`).toBe(1);
      expect(cell.role, `${id} is a crossing on a depot`).not.toBe("depot");
    }
  });

  describe("ground", () => {
    const cells = Object.entries(demoworld.level);

    it("never blocks a cell that carries a line", () => {
      // `paintGround` skips blocking ground on anything already built, so an
      // authored rectangle can span the ring without hand-cut holes. This is the
      // property that makes that safe — `validateLevel` would also catch it, but
      // stated here it says WHY the regions are allowed to be plain rectangles.
      for (const [id, cell] of cells) {
        const built = cell.connections.length > 0 || (cell.road?.length ?? 0) > 0;
        if (!built) continue;
        expect(
          terrainBlocksBuilding(terrainOf(cell)),
          `${id} carries a line over ${cell.terrain}`,
        ).toBe(false);
      }
    });

    it("does run the railway through the woods and the streets through the town", () => {
      // The other half of the same rule, and the reason the demo reads as a
      // place: forest and urban are painted straight over rail and road, so the
      // corridor/canopy work (/test/clearing) has something to do here.
      const railInWood = cells.filter(
        ([, c]) => c.connections.length > 0 && c.terrain === "forest",
      );
      const roadInTown = cells.filter(
        ([, c]) => (c.road?.length ?? 0) > 0 && c.terrain === "urban",
      );
      expect(railInWood.length).toBeGreaterThan(4);
      expect(roadInTown.length).toBeGreaterThan(4);
    });

    it("leaves enough of the board buildable", () => {
      // The build tool has to have somewhere to go. `generateTerrain` caps its
      // own margin at 22%; an authored board is under no less of an obligation.
      const blocked = cells.filter(([, c]) => terrainBlocksBuilding(terrainOf(c)));
      const { cols, rows } = demoworld.size!;
      expect(blocked.length / (cols * rows)).toBeLessThan(0.22);
    });

    it("paints in bodies, not confetti", () => {
      // `patchPath` fuses orthogonally adjacent same-kind cells into one outline,
      // so a lone painted cell renders as a tiny island. Every painted cell here
      // should touch one of its own.
      const kindAt = (id: string) => demoworld.level[id]?.terrain;
      for (const [id, cell] of cells) {
        if (!cell.terrain) continue;
        const [x, y] = id.split(",").map(Number);
        const touching = [
          `${x},${y - 1}`,
          `${x + 1},${y}`,
          `${x},${y + 1}`,
          `${x - 1},${y}`,
        ].some(n => kindAt(n) === cell.terrain);
        expect(touching, `${id} is a lone ${cell.terrain} cell`).toBe(true);
      }
    });
  });
});
