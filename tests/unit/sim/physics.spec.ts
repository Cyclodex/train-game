import { describe, it, expect } from "vitest";
import { trainDynamics } from "@/sim/physics";

describe("train dynamics (mass model)", () => {
  it("a heavier train accelerates and brakes more gently", () => {
    const light = trainDynamics("people", 0); // loco only
    const heavy = trainDynamics("fraight", 4); // long & freight

    expect(light.accel).toBeGreaterThan(0);
    expect(light.brake).toBeGreaterThan(0);
    expect(heavy.accel).toBeLessThan(light.accel);
    expect(heavy.brake).toBeLessThan(light.brake);
  });

  it("freight is heavier than an equal-length people train", () => {
    expect(trainDynamics("fraight", 2).accel).toBeLessThan(
      trainDynamics("people", 2).accel
    );
  });

  it("each added wagon makes the train a little heavier", () => {
    const a = trainDynamics("people", 1).accel;
    const b = trainDynamics("people", 3).accel;
    expect(b).toBeLessThan(a);
  });
});
