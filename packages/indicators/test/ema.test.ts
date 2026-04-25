import { describe, expect, it } from "vitest";
import { ema } from "../src/ema.js";

describe("ema", () => {
  it("first (period-1) values are undefined; first emitted equals SMA seed", () => {
    // period=3 on [1..5]: seed = SMA([1,2,3]) = 2.
    // alpha = 2/(3+1) = 0.5
    // ema[3] = 0.5*4 + 0.5*2 = 3
    // ema[4] = 0.5*5 + 0.5*3 = 4
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeCloseTo(2, 10);
    expect(out[3]).toBeCloseTo(3, 10);
    expect(out[4]).toBeCloseTo(4, 10);
  });

  it("throws on invalid period", () => {
    expect(() => ema([1, 2, 3], 0)).toThrow();
    expect(() => ema([1, 2], 3)).toThrow();
  });
});
