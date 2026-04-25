import { describe, expect, it } from "vitest";
import type { Candle } from "@forex-bot/contracts";
import { swings } from "../src/swings.js";

function mk(h: number, l: number, idx: number): Candle {
  return { ts: idx, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 0 };
}

describe("swings", () => {
  it("identifies a fractal swing high/low with lookback=2", () => {
    const cs = [
      mk(1, 0.5, 0),
      mk(1.2, 0.7, 1),
      mk(1.5, 0.9, 2),
      mk(1.3, 0.6, 3),
      mk(1.1, 0.4, 4),
      mk(1.2, 0.6, 5),
      mk(1.3, 0.7, 6),
    ];
    const out = swings(cs, 2);
    expect(out.highs).toContain(2);
    expect(out.lows).toContain(4);
  });

  it("ignores boundary candles within lookback", () => {
    const cs = [mk(2, 1, 0), mk(1, 0.5, 1), mk(1, 0.5, 2), mk(1, 0.5, 3), mk(2, 1, 4)];
    const out = swings(cs, 2);
    expect(out.highs).not.toContain(0);
    expect(out.highs).not.toContain(4);
  });
});
