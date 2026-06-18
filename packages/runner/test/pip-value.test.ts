import { describe, expect, it } from "vitest";
import { pipValuePerLot } from "../src/pip-value.js";

describe("pipValuePerLot", () => {
  it("EURUSD → 10 (non-JPY, no quoteToUsd)", () => {
    expect(pipValuePerLot("EURUSD")).toBe(10);
  });

  it("GBPUSD → 10 (non-JPY, no quoteToUsd)", () => {
    expect(pipValuePerLot("GBPUSD")).toBe(10);
  });

  it("USDJPY default quoteToUsd → 1000/150 ≈ 6.666...", () => {
    expect(pipValuePerLot("USDJPY")).toBeCloseTo(1000 / 150, 5);
  });

  it("USDJPY with explicit quoteToUsd=150 → 1000/150", () => {
    expect(pipValuePerLot("USDJPY", 150)).toBeCloseTo(1000 / 150, 5);
  });

  it("USDJPY with quoteToUsd=100 → 1000/100 = 10", () => {
    expect(pipValuePerLot("USDJPY", 100)).toBeCloseTo(10, 5);
  });

  it("EURJPY → uses JPY formula (endsWith JPY)", () => {
    expect(pipValuePerLot("EURJPY")).toBeCloseTo(1000 / 150, 5);
  });

  it("AUDUSD → 10 (non-JPY)", () => {
    expect(pipValuePerLot("AUDUSD")).toBe(10);
  });
});
