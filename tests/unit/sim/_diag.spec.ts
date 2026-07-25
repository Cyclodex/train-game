import { describe, it } from "vitest";
import { busarterial, busmegacross } from "@/levels/test/scenarios/buscrosses";
import { simFor } from "../support/roadSim";

describe("diag", () => {
  for (const [name, sc] of Object.entries({ busarterial, busmegacross })) {
    it(`worst pair in ${name}`, () => {
      const sim = simFor(sc, 5);
      let worst = 0, detail = "";
      for (let i = 0; i < 800; i++) {
        sim.step(0.05, () => false);
        const parts = new Map<string, string>();
        for (const c of sim.sample()) parts.set(c.id, c.units.map(u => u.part).join("+"));
        type Ext = { id: string; tMin: number; tMax: number; lMin: number; lMax: number };
        const groups = new Map<string, Map<string, Ext>>();
        for (const body of sim.bodies()) {
          for (const p of body.points) {
            const key = `${p.tileId}|${p.entry}|L${p.lane}`;
            let per = groups.get(key);
            if (!per) groups.set(key, (per = new Map()));
            const e = per.get(body.id);
            if (!e) per.set(body.id, { id: body.id, tMin: p.t, tMax: p.t, lMin: p.lanePos, lMax: p.lanePos });
            else {
              e.tMin = Math.min(e.tMin, p.t); e.tMax = Math.max(e.tMax, p.t);
              e.lMin = Math.min(e.lMin, p.lanePos); e.lMax = Math.max(e.lMax, p.lanePos);
            }
          }
        }
        for (const [key, per] of groups) {
          const arr = [...per.values()];
          for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
            const A = arr[a], B = arr[b];
            const lon = Math.min(A.tMax, B.tMax) - Math.max(A.tMin, B.tMin);
            const lat = Math.max(0, Math.max(A.lMin, B.lMin) - Math.min(A.lMax, B.lMax));
            if (lon > worst && lat < 0.7) {
              worst = lon;
              const cars = sim.cars();
              const ca = cars.find(c => c.id === A.id)!, cb = cars.find(c => c.id === B.id)!;
              detail = `tick=${i} ${key} overlap=${lon.toFixed(4)} lat=${lat.toFixed(2)}\n` +
                `   A ${A.id}[${parts.get(A.id)}] lane=${ca.laneIndex.toFixed(2)}->${ca.targetLane} v=${ca.velocity.toFixed(2)} phase=${ca.overtakePhase} t=[${A.tMin.toFixed(2)},${A.tMax.toFixed(2)}] lp=[${A.lMin.toFixed(2)},${A.lMax.toFixed(2)}]\n` +
                `   B ${B.id}[${parts.get(B.id)}] lane=${cb.laneIndex.toFixed(2)}->${cb.targetLane} v=${cb.velocity.toFixed(2)} phase=${cb.overtakePhase} t=[${B.tMin.toFixed(2)},${B.tMax.toFixed(2)}] lp=[${B.lMin.toFixed(2)},${B.lMax.toFixed(2)}]`;
            }
          }
        }
      }
      console.log(`\n### ${name}\n${detail}`);
    }, 60000);
  }
});
