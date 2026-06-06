import { describe, it, expect } from "vitest";
import {
  createObjectiveTracker,
  emptyObservation,
  ObjectiveSpec,
} from "@/sim/objectives";
import type { Counters } from "@/sim/objectives";

const baseSpec: ObjectiveSpec = { deliveriesRequired: 2 };

describe("objective tracker — phase + win", () => {
  it("starts Ready and does not accrue until started", () => {
    const t = createObjectiveTracker(baseSpec);
    expect(t.state().phase).toBe("ready");
    t.observe({ ...emptyObservation, deliveredDelta: 5 }, 1);
    expect(t.state().counters.delivered).toBe(0);
    expect(t.state().phase).toBe("ready");
  });

  it("accrues deliveries and time once Playing", () => {
    const t = createObjectiveTracker(baseSpec);
    t.start();
    expect(t.state().phase).toBe("playing");
    t.observe({ ...emptyObservation, deliveredDelta: 1 }, 1.5);
    expect(t.state().counters.delivered).toBe(1);
    expect(t.state().counters.elapsedSec).toBeCloseTo(1.5);
    expect(t.state().phase).toBe("playing");
  });

  it("wins when deliveries reach the requirement", () => {
    const t = createObjectiveTracker(baseSpec);
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 2 }, 1);
    expect(t.state().phase).toBe("won");
  });

  it("freezes counters after winning", () => {
    const t = createObjectiveTracker(baseSpec);
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 2 }, 1);
    t.observe({ ...emptyObservation, deliveredDelta: 1 }, 1);
    expect(t.state().counters.delivered).toBe(2);
    expect(t.state().counters.elapsedSec).toBeCloseTo(1);
  });
});

describe("objective tracker — lose, stars, reset", () => {
  it("loses on timeout when onTimeout is set", () => {
    const t = createObjectiveTracker({
      deliveriesRequired: 5,
      timeLimitSec: 10,
      fail: { onTimeout: true },
    });
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 1 }, 9);
    expect(t.state().phase).toBe("playing");
    t.observe(emptyObservation, 2);
    expect(t.state().phase).toBe("lost");
    expect(t.state().lostReason).toBe("Time ran out");
  });

  it("does not time out without onTimeout (untimed default stays calm)", () => {
    const t = createObjectiveTracker({ deliveriesRequired: 5, timeLimitSec: 1 });
    t.start();
    t.observe(emptyObservation, 100);
    expect(t.state().phase).toBe("playing");
  });

  it("win takes priority over a same-tick timeout", () => {
    const t = createObjectiveTracker({
      deliveriesRequired: 2,
      timeLimitSec: 1,
      fail: { onTimeout: true },
    });
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 2 }, 5);
    expect(t.state().phase).toBe("won");
  });

  it("evaluates star predicates live over counters", () => {
    const handsOff = {
      id: "hands-off",
      label: "Hands off",
      predicate: (c: Counters) => c.manualHolds + c.manualGreens === 0,
    };
    const t = createObjectiveTracker({ deliveriesRequired: 1, stars: [handsOff] });
    t.start();
    expect(t.state().stars[0].earned).toBe(true);
    t.observe({ ...emptyObservation, manualHoldDelta: 1 }, 1);
    expect(t.state().stars[0].earned).toBe(false);
  });

  it("reset() returns to Ready and clears counters", () => {
    const t = createObjectiveTracker({ deliveriesRequired: 1 });
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 1 }, 3);
    expect(t.state().phase).toBe("won");
    t.reset();
    expect(t.state().phase).toBe("ready");
    expect(t.state().counters.delivered).toBe(0);
    expect(t.state().counters.elapsedSec).toBe(0);
  });
});
