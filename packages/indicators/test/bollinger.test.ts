import { describe, expect, it } from "vitest";
import { bollinger } from "../src/bollinger.js";

describe("bollinger", () => {
  it("flat series → bands collapse to middle", () => {
    const out = bollinger([5, 5, 5, 5, 5, 5], 3, 2);
    const last = out[out.length - 1];
    expect(last?.middle).toBe(5);
    expect(last?.upper).toBe(5);
    expect(last?.lower).toBe(5);
  });

  it("throws on invalid period", () => {
    expect(() => bollinger([1, 2, 3], 0)).toThrow();
    expect(() => bollinger([1, 2, 3], 5)).toThrow();
  });

  it("upper - lower = 2 * k * stddev", () => {
    const out = bollinger([1, 2, 3, 4, 5], 5, 2);
    const last = out[out.length - 1];
    const mean = 3;
    const sd = Math.sqrt(
      ((1 - mean) ** 2 + (2 - mean) ** 2 + 0 + (4 - mean) ** 2 + (5 - mean) ** 2) / 5,
    );
    expect(last?.middle).toBeCloseTo(mean, 10);
    expect((last?.upper as number) - (last?.lower as number)).toBeCloseTo(4 * sd, 10);
  });
});
