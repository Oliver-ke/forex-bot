import { describe, expect, it } from "vitest";
import { sma } from "../src/sma.js";

describe("sma", () => {
  it("returns undefined for indices before the window is full", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([undefined, undefined, 2, 3, 4]);
  });

  it("throws on period < 1 or period > input length", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow();
    expect(() => sma([1, 2], 3)).toThrow();
  });

  it("handles flat series", () => {
    expect(sma([5, 5, 5, 5], 2)).toEqual([undefined, 5, 5, 5]);
  });
});
