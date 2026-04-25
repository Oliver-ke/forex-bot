import type { Candle } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { adx } from "../src/adx.js";

function mk(h: number, l: number, c: number, idx = 0): Candle {
  return { ts: idx, open: (h + l) / 2, high: h, low: l, close: c, volume: 0 };
}

describe("adx", () => {
  it("returns undefined before 2*period warmup", () => {
    const cs = Array.from({ length: 10 }, (_, i) => mk(2, 1, 1.5, i));
    const out = adx(cs, 14);
    expect(out.every((v) => v === undefined)).toBe(true);
  });

  it("throws on invalid period", () => {
    expect(() => adx([], 0)).toThrow();
  });

  it("strong monotonic uptrend produces high ADX (>50) after warmup", () => {
    const cs = Array.from({ length: 60 }, (_, i) =>
      mk(1 + i * 0.01 + 0.005, 1 + i * 0.01, 1 + i * 0.01 + 0.004, i),
    );
    const out = adx(cs, 14);
    const last = out[out.length - 1];
    expect(typeof last).toBe("number");
    expect(last as number).toBeGreaterThan(50);
  });
});
