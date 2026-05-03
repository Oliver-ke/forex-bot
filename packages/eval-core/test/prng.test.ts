import { describe, expect, it } from "vitest";
import { Mulberry32 } from "../src/prng.js";

function take(rng: Mulberry32, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(rng.next());
  }
  return out;
}

describe("Mulberry32", () => {
  it("produces the same first 5 outputs for the same seed", () => {
    const a = take(new Mulberry32(42), 5);
    const b = take(new Mulberry32(42), 5);
    expect(a).toEqual(b);
  });

  it("produces different sequences for different seeds", () => {
    const a = take(new Mulberry32(1), 5);
    const b = take(new Mulberry32(2), 5);
    expect(a).not.toEqual(b);
  });

  it("returns values in [0, 1)", () => {
    const rng = new Mulberry32(123);
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
