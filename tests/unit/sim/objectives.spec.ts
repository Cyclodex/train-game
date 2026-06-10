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

  it("keeps a high-water mark of the worst car wait", () => {
    const t = createObjectiveTracker({ deliveriesRequired: 5 });
    t.start();
    t.observe({ ...emptyObservation, maxCarWaitSec: 3 }, 1);
    expect(t.state().counters.maxCarWaitSec).toBe(3);
    // A later, smaller live wait does not pull the high-water mark down.
    t.observe({ ...emptyObservation, maxCarWaitSec: 1 }, 1);
    expect(t.state().counters.maxCarWaitSec).toBe(3);
    t.observe({ ...emptyObservation, maxCarWaitSec: 5 }, 1);
    expect(t.state().counters.maxCarWaitSec).toBe(5);
  });

  it("tracks the latest road throughput", () => {
    const t = createObjectiveTracker({ deliveriesRequired: 5 });
    t.start();
    t.observe({ ...emptyObservation, carsDelivered: 2 }, 1);
    t.observe({ ...emptyObservation, carsDelivered: 7 }, 1);
    expect(t.state().counters.carsDelivered).toBe(7);
  });

  it("loses when a car waits longer than fail.maxCarWaitSec", () => {
    const t = createObjectiveTracker({
      deliveriesRequired: 5,
      fail: { maxCarWaitSec: 4 },
    });
    t.start();
    t.observe({ ...emptyObservation, maxCarWaitSec: 3 }, 1);
    expect(t.state().phase).toBe("playing");
    t.observe({ ...emptyObservation, maxCarWaitSec: 4.1 }, 1);
    expect(t.state().phase).toBe("lost");
    expect(t.state().lostReason).toBe("A car was stuck at the crossing too long");
  });

  it("loses on a crossing incident when onCrossingIncident is set", () => {
    const t = createObjectiveTracker({
      deliveriesRequired: 5,
      fail: { onCrossingIncident: true },
    });
    t.start();
    t.observe({ ...emptyObservation, crossingIncidentDelta: 1 }, 1);
    expect(t.state().phase).toBe("lost");
    expect(t.state().lostReason).toBe("A car was caught on the crossing");
  });

  it("ignores crossing incidents without onCrossingIncident", () => {
    const t = createObjectiveTracker({ deliveriesRequired: 5 });
    t.start();
    t.observe({ ...emptyObservation, crossingIncidentDelta: 1 }, 1);
    expect(t.state().phase).toBe("playing");
    expect(t.state().counters.crossingIncidents).toBe(1);
  });

  it("win beats a same-tick crossing-wait fail", () => {
    const t = createObjectiveTracker({
      deliveriesRequired: 1,
      fail: { maxCarWaitSec: 1 },
    });
    t.start();
    t.observe({ ...emptyObservation, deliveredDelta: 1, maxCarWaitSec: 99 }, 1);
    expect(t.state().phase).toBe("won");
  });

  it("a smooth-operator star reads the high-water car wait", () => {
    const smooth = {
      id: "smooth-operator",
      label: "Smooth operator",
      predicate: (c: Counters) => c.maxCarWaitSec <= 5,
    };
    const t = createObjectiveTracker({ deliveriesRequired: 5, stars: [smooth] });
    t.start();
    expect(t.state().stars[0].earned).toBe(true);
    t.observe({ ...emptyObservation, maxCarWaitSec: 6 }, 1);
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
