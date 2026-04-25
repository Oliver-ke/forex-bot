import { describe, expect, it } from "vitest";
import type { Candle } from "@forex-bot/contracts";
import { atr } from "../src/atr.js";

function mk(h: number, l: number, c: number, idx = 0): Candle {
  return { ts: idx, open: (h + l) / 2, high: h, low: l, close: c, volume: 0 };
}

describe("atr (Wilder)", () => {
  it("pre-seed indices are undefined", () => {
    const cs = [mk(2, 1, 1.5), mk(2, 1, 1.5)];
    const out = atr(cs, 14);
    expect(out.every((v) => v === undefined)).toBe(true);
  });

  it("constant-range series has ATR equal to that range", () => {
    const cs = Array.from({ length: 20 }, (_, i) => mk(2, 1, 1.5, i));
    const out = atr(cs, 14);
    for (let i = 14; i < cs.length; i++) expect(out[i]).toBeCloseTo(1, 10);
  });
});
