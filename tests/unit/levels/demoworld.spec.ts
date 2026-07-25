import { describe, it, expect } from "vitest";
import { scenarioById } from "@/levels/test";
import { oppositePort } from "@/sim/topology";
import { simFor } from "../support/roadSim";

// The demo world is the one board meant to show the whole game at once, so the
// things that make it a *world* rather than a diorama are worth pinning.
//
// Read through `scenarioById`, not the raw export: the registry applies the same
// junction lane sync the editor does, and that is what the running game sees.
const demoworld = scenarioById("demoworld");

describe("demoworld", () => {
  it("has crossroads cars can actually turn at", () => {
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
});
