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
});
