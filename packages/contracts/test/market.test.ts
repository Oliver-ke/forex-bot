import { describe, expect, it } from "vitest";
import { CandleSchema, TickSchema, MTFBundleSchema } from "../src/market.js";

describe("market types", () => {
  it("Candle requires OHLCV with high >= low and open/close within range", () => {
    const c = CandleSchema.parse({
      ts: 1710000000000,
      open: 1.08,
      high: 1.09,
      low: 1.07,
      close: 1.085,
      volume: 1000,
    });
    expect(c.close).toBe(1.085);
    expect(() =>
      CandleSchema.parse({ ts: 1, open: 1, high: 0.5, low: 1, close: 1, volume: 0 }),
    ).toThrow();
  });

  it("Tick requires bid <= ask", () => {
    expect(() =>
      TickSchema.parse({ ts: 1, symbol: "EURUSD", bid: 1.09, ask: 1.08 }),
    ).toThrow();
  });

  it("MTFBundle requires at least M15 and H1 arrays", () => {
    const c = { ts: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 };
    const b = MTFBundleSchema.parse({
      symbol: "EURUSD",
      M15: [c],
      H1: [c],
      H4: [c],
      D1: [c],
    });
    expect(b.M15).toHaveLength(1);
  });
});
