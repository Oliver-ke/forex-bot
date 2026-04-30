import type { CalendarEvent, Candle } from "@forex-bot/contracts";
import { describe, expect, it } from "vitest";
import { detectTriggers } from "../src/triggers.js";

function flatCandles(n: number, base = 1.08): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: i * 60 * 60_000,
    open: base,
    high: base + 0.0005,
    low: base - 0.0005,
    close: base,
    volume: 0,
  }));
}

describe("detectTriggers", () => {
  it("fires schedule events when timeframe boundaries are crossed", () => {
    const m15 = 15 * 60_000;
    const h1 = 60 * 60_000;
    const out = detectTriggers({
      nowMs: 2 * h1,
      lastTickedMs: 2 * h1 - m15,
      candlesByTf: {},
      upcomingEvents: [],
    });
    const tfs = out.filter((t) => t.reason === "schedule").map((t) => t.timeframe);
    expect(tfs).toContain("M15");
    expect(tfs).toContain("H1");
  });

  it("fires a price_event on S/R level break (close crossing level)", () => {
    const candles = flatCandles(2, 1.08);
    candles[0] = { ...candles[0], close: 1.0795 } as Candle;
    candles[1] = { ...candles[1], close: 1.0815, high: 1.082, low: 1.079 } as Candle;
    const out = detectTriggers({
      nowMs: 100,
      lastTickedMs: 99,
      candlesByTf: { H1: candles },
      levels: [{ price: 1.08, touches: 5 }],
      upcomingEvents: [],
    });
    expect(
      out.find((t) => t.reason === "price_event" && t.detail?.startsWith("S/R")),
    ).toBeDefined();
  });

  it("fires a price_event on ATR expansion", () => {
    const candles = flatCandles(20, 1.08);
    candles[19] = { ...candles[19], high: 1.09, low: 1.07, close: 1.085 } as Candle;
    const out = detectTriggers({
      nowMs: 100,
      lastTickedMs: 99,
      candlesByTf: { H1: candles },
      upcomingEvents: [],
    });
    expect(
      out.find((t) => t.reason === "price_event" && t.detail?.startsWith("ATR")),
    ).toBeDefined();
  });

  it("fires a news_event when a high-impact event is within the window", () => {
    const event: CalendarEvent = {
      ts: 1_000_000,
      currency: "USD",
      impact: "high",
      title: "NFP",
    };
    const out = detectTriggers({
      nowMs: 1_000_000 + 5 * 60_000,
      lastTickedMs: 1_000_000 + 5 * 60_000 - 1,
      candlesByTf: {},
      upcomingEvents: [event],
      newsWindowMin: 10,
    });
    expect(out.find((t) => t.reason === "news_event")).toBeDefined();
  });

  it("does not fire news_event for medium-impact events", () => {
    const out = detectTriggers({
      nowMs: 1_000_000,
      lastTickedMs: 1_000_000 - 1,
      candlesByTf: {},
      upcomingEvents: [{ ts: 1_000_000, currency: "USD", impact: "medium", title: "Retail Sales" }],
    });
    expect(out.find((t) => t.reason === "news_event")).toBeUndefined();
  });

  it("fires a rebalance event after the rebalance interval has elapsed", () => {
    const out = detectTriggers({
      nowMs: 30 * 60_000 + 1,
      lastTickedMs: 30 * 60_000,
      candlesByTf: {},
      upcomingEvents: [],
      lastRebalanceMs: 0,
    });
    expect(out.find((t) => t.reason === "rebalance")).toBeDefined();
  });
});
