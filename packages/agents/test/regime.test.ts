import type { Candle } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { classifyRegime } from "../src/regime.js";

function flat(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: i,
    open: 1,
    high: 1.0001,
    low: 0.9999,
    close: 1,
    volume: 0,
  }));
}

function trending(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: i,
    open: 1 + i * 0.001,
    high: 1 + i * 0.001 + 0.0008,
    low: 1 + i * 0.001,
    close: 1 + i * 0.001 + 0.0007,
    volume: 0,
  }));
}

describe("classifyRegime", () => {
  it("classifies a flat series as ranging / low-vol", () => {
    const r = classifyRegime({ candlesH1: flat(60), upcomingHighImpactCount: 0 });
    expect(r.label).toBe("ranging");
    expect(r.volBucket).toBe("low");
  });

  it("classifies a steady uptrend as trending", () => {
    const r = classifyRegime({ candlesH1: trending(60), upcomingHighImpactCount: 0 });
    expect(r.label).toBe("trending");
  });

  it("classifies dense calendar window as event-driven", () => {
    const r = classifyRegime({ candlesH1: flat(60), upcomingHighImpactCount: 3 });
    expect(r.label).toBe("event-driven");
  });
});
