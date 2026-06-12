import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Port } from "@/sim/topology";
import {
  phasePlan,
  cycleJunctionSignal,
  signalModeLabel,
  createJunctionSignal,
  GREEN_SEC,
  AMBER_SEC,
  ALL_RED_SEC,
} from "@/sim/junctionSignal";

const { Top, Right, Bottom, Left } = Position;
const FOUR: Port[] = [Top, Right, Bottom, Left];

// Step a controller forward by `total` seconds in small `dt` increments, feeding a
// fixed approaching-bus set each tick (deterministic).
function run(
  ctrl: ReturnType<typeof createJunctionSignal>,
  total: number,
  approaching: ReadonlySet<Port> = new Set(),
  dt = 0.05,
): void {
  let t = 0;
  while (t < total - 1e-9) {
    const step = Math.min(dt, total - t);
    ctrl.step(step, approaching);
    t += step;
  }
}

describe("phasePlan", () => {
  it("two-phase pairs opposing arms (N+S, then E+W)", () => {
    const plan = phasePlan("two-phase", FOUR);
    expect(plan.length).toBe(2);
    expect(new Set(plan[0])).toEqual(new Set([Top, Bottom]));
    expect(new Set(plan[1])).toEqual(new Set([Left, Right]));
  });

  it("round-robin gives one arm per phase, cycling N→E→S→W", () => {
    expect(phasePlan("round-robin", FOUR)).toEqual([[Top], [Right], [Bottom], [Left]]);
  });

  it("omits a T-junction's missing arm (decision 7)", () => {
    const tee: Port[] = [Top, Right, Bottom]; // no Left
    expect(phasePlan("two-phase", tee)).toEqual([[Top, Bottom], [Right]]);
    expect(phasePlan("round-robin", tee)).toEqual([[Top], [Right], [Bottom]]);
  });

  it("off has no phases", () => {
    expect(phasePlan("off", FOUR)).toEqual([]);
  });
});

describe("cycleJunctionSignal", () => {
  it("cycles off → two-phase → +bus → round-robin → +bus → off", () => {
    let sig = cycleJunctionSignal(undefined);
    expect(sig).toEqual({ mode: "two-phase" });
    sig = cycleJunctionSignal(sig);
    expect(sig).toEqual({ mode: "two-phase", busPriority: true });
    sig = cycleJunctionSignal(sig);
    expect(sig).toEqual({ mode: "round-robin" });
    sig = cycleJunctionSignal(sig);
    expect(sig).toEqual({ mode: "round-robin", busPriority: true });
    sig = cycleJunctionSignal(sig);
    expect(sig).toEqual({ mode: "off" });
  });

  it("labels the live mode", () => {
    expect(signalModeLabel(undefined)).toBe("off");
    expect(signalModeLabel({ mode: "off" })).toBe("off");
    expect(signalModeLabel({ mode: "two-phase" })).toBe("two-phase");
    expect(signalModeLabel({ mode: "round-robin", busPriority: true })).toBe(
      "round-robin +bus",
    );
  });
});

describe("two-phase controller", () => {
  it("an off junction shows green on every arm (the gate is a no-op)", () => {
    const ctrl = createJunctionSignal(FOUR, { mode: "off" });
    run(ctrl, 3);
    for (const arm of FOUR) expect(ctrl.aspect(arm)).toBe("green");
  });

  it("runs N+S green, amber, all-red, then E+W — deterministically", () => {
    const ctrl = createJunctionSignal(FOUR, { mode: "two-phase" });
    // Mid-green of phase 0 (N+S).
    run(ctrl, GREEN_SEC / 2);
    expect(ctrl.aspect(Top)).toBe("green");
    expect(ctrl.aspect(Bottom)).toBe("green");
    expect(ctrl.aspect(Left)).toBe("red");
    expect(ctrl.aspect(Right)).toBe("red");

    // Into amber of phase 0.
    run(ctrl, GREEN_SEC / 2 + AMBER_SEC / 2);
    expect(ctrl.aspect(Top)).toBe("amber");
    expect(ctrl.aspect(Left)).toBe("red");

    // Into all-red (between phases): everything red.
    run(ctrl, AMBER_SEC / 2 + ALL_RED_SEC / 2);
    for (const arm of FOUR) expect(ctrl.aspect(arm)).toBe("red");

    // Into green of phase 1 (E+W).
    run(ctrl, ALL_RED_SEC / 2 + GREEN_SEC / 2);
    expect(ctrl.aspect(Left)).toBe("green");
    expect(ctrl.aspect(Right)).toBe("green");
    expect(ctrl.aspect(Top)).toBe("red");
  });
});

describe("round-robin controller", () => {
  it("greens exactly one arm at a time, cycling N→E→S→W", () => {
    const ctrl = createJunctionSignal(FOUR, { mode: "round-robin" });
    const phaseLen = GREEN_SEC + AMBER_SEC + ALL_RED_SEC;
    const order = [Top, Right, Bottom, Left];
    for (let i = 0; i < order.length; i++) {
      const ctrl2 = createJunctionSignal(FOUR, { mode: "round-robin" });
      run(ctrl2, i * phaseLen + GREEN_SEC / 2); // mid-green of phase i
      const green = order.filter(a => ctrl2.aspect(a) === "green");
      expect(green).toEqual([order[i]]);
    }
    void ctrl;
  });
});

describe("bus priority", () => {
  it("extends the active green while a bus approaches that arm", () => {
    // Two identical two-phase controllers; one has bus-priority. Drive both to a
    // point past the base green where, WITH a bus on the active (N+S) arm, the
    // priority one is still green while the plain one has moved on.
    const plain = createJunctionSignal(FOUR, { mode: "two-phase" });
    const prio = createJunctionSignal(FOUR, { mode: "two-phase", busPriority: true });
    const bus = new Set<Port>([Top]); // a bus approaching the N arm

    run(plain, GREEN_SEC + AMBER_SEC + 0.5, bus); // ~7.5s: plain is into all-red/E+W
    run(prio, GREEN_SEC + AMBER_SEC + 0.5, bus);

    // The plain light has left N+S green; the prioritised one holds it green for
    // the approaching bus (transit signal priority).
    expect(prio.aspect(Top)).toBe("green");
    expect(plain.aspect(Top)).not.toBe("green");
  });

  it("does not extend green forever — cross traffic is still served (no starvation)", () => {
    // Even with a bus PERMANENTLY on the N arm, the green is capped and the E+W
    // phase still gets its turn: bring-forward never re-selects the phase it just
    // served, so the standing bus can't monopolise the junction.
    const prio = createJunctionSignal(FOUR, { mode: "two-phase", busPriority: true });
    const bus = new Set<Port>([Top]);
    let ewSeenGreen = false;
    let nsSeenNonGreen = false;
    const dt = 0.1;
    for (let t = 0; t < 40; t += dt) {
      prio.step(dt, bus);
      if (prio.aspect(Left) === "green") ewSeenGreen = true;
      if (prio.aspect(Top) !== "green") nsSeenNonGreen = true;
    }
    expect(ewSeenGreen).toBe(true);
    expect(nsSeenNonGreen).toBe(true);
  });

  it("brings a waiting bus's phase forward at the phase boundary", () => {
    // Round-robin: after the Top phase, Right is the natural next. With a bus
    // waiting on Bottom and bus-priority on, the Bottom phase is brought forward.
    const prio = createJunctionSignal(FOUR, { mode: "round-robin", busPriority: true });
    const bus = new Set<Port>([Bottom]);
    // Run through Top's green+amber+all-red into the next green.
    run(prio, GREEN_SEC + AMBER_SEC + ALL_RED_SEC + GREEN_SEC / 2, bus);
    expect(prio.aspect(Bottom)).toBe("green");
    expect(prio.aspect(Right)).toBe("red");
  });
});
