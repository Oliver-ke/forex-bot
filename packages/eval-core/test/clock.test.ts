import { describe, expect, it } from "vitest";
import { ReplayClock } from "../src/clock.js";

describe("ReplayClock", () => {
  it("defaults to time 0", () => {
    const clock = new ReplayClock();
    expect(clock.now()).toBe(0);
  });

  it("respects an initial timestamp", () => {
    const clock = new ReplayClock(1000);
    expect(clock.now()).toBe(1000);
  });

  it("step(500) advances by 500ms", () => {
    const clock = new ReplayClock(1000);
    clock.step(500);
    expect(clock.now()).toBe(1500);
  });

  it("advanceTo(2000) jumps to 2000", () => {
    const clock = new ReplayClock(1000);
    clock.advanceTo(2000);
    expect(clock.now()).toBe(2000);
  });

  it("advanceTo a past timestamp throws", () => {
    const clock = new ReplayClock(1000);
    expect(() => clock.advanceTo(999)).toThrow(/backwards/);
  });

  it("step(-1) throws", () => {
    const clock = new ReplayClock(1000);
    expect(() => clock.step(-1)).toThrow();
  });

  it("step(0) is allowed and is a no-op", () => {
    const clock = new ReplayClock(1000);
    clock.step(0);
    expect(clock.now()).toBe(1000);
  });

  it("advanceTo the current time is allowed", () => {
    const clock = new ReplayClock(1000);
    clock.advanceTo(1000);
    expect(clock.now()).toBe(1000);
  });
});
