import { describe, expect, it } from "vitest";
import { rsi } from "../src/rsi.js";

describe("rsi (Wilder)", () => {
  it("monotonic-up series yields 100 after seed", () => {
    const out = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14);
    // seed is at index 14; all gains, zero losses → RS = avgGain/0 → RSI = 100
    expect(out[14]).toBe(100);
  });

  it("monotonic-down series yields 0 after seed", () => {
    const out = rsi([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 14);
    expect(out[14]).toBe(0);
  });

  it("pre-seed values are undefined", () => {
    const out = rsi([1, 2, 3], 14);
    expect(out.every((v) => v === undefined)).toBe(true);
  });

  it("smoothing loop produces values in (0, 100) for mixed series", () => {
    // Period 5 with 12 values forces the post-seed smoothing loop to run.
    const out = rsi([1, 2, 3, 4, 5, 4, 6, 5, 7, 6, 8, 7], 5);
    for (let i = 5; i < out.length; i++) {
      const v = out[i];
      expect(typeof v).toBe("number");
      expect(v as number).toBeGreaterThan(0);
      expect(v as number).toBeLessThan(100);
    }
  });

  it("throws on invalid period", () => {
    expect(() => rsi([1, 2, 3], 0)).toThrow();
  });
});
