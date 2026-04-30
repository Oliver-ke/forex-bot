import { FakeBroker } from "@forex-bot/broker-core";
import { StateBundleSchema } from "@forex-bot/contracts";
import { InMemoryHotCache } from "@forex-bot/data-core";
import { describe, expect, it } from "vitest";
import { assembleState } from "../src/state-assembler.js";

function pipScale(symbol: string): number {
  return symbol.endsWith("JPY") ? 0.01 : 0.0001;
}

describe("assembleState", () => {
  it("composes a schema-valid StateBundle from broker + cache", async () => {
    const broker = new FakeBroker({
      accountCurrency: "USD",
      startingBalance: 10_000,
      pipScale,
    });
    broker.setQuote("EURUSD", 1.08, 1.0801);
    for (const tf of ["M15", "H1", "H4", "D1"] as const) {
      broker.setCandles("EURUSD", tf, [
        { ts: 1, open: 1.08, high: 1.081, low: 1.079, close: 1.0805, volume: 0 },
      ]);
    }

    const cache = new InMemoryHotCache();
    await cache.pushHeadline({ ts: 100, source: "wire", title: "ECB hint", summary: "hawkish" });
    await cache.setCalendarWindow([{ ts: 200, currency: "USD", impact: "high", title: "NFP" }]);

    const bundle = await assembleState({
      broker,
      cache,
      symbol: "EURUSD",
      ts: 1_000_000,
      trigger: { reason: "schedule", timeframe: "H1" },
    });

    const parsed = StateBundleSchema.safeParse(bundle);
    expect(parsed.success).toBe(true);
    expect(bundle.market.H1).toHaveLength(1);
    expect(bundle.recentNews).toHaveLength(1);
    expect(bundle.upcomingEvents).toHaveLength(1);
    expect(bundle.regimePrior).toEqual({ label: "trending", volBucket: "normal" });
  });

  it("filters headlines older than the lookback window", async () => {
    const broker = new FakeBroker({
      accountCurrency: "USD",
      startingBalance: 10_000,
      pipScale,
    });
    for (const tf of ["M15", "H1", "H4", "D1"] as const) {
      broker.setCandles("EURUSD", tf, [
        { ts: 1, open: 1, high: 1.001, low: 0.999, close: 1, volume: 0 },
      ]);
    }
    const cache = new InMemoryHotCache();
    await cache.pushHeadline({ ts: 0, source: "old", title: "ancient" });
    await cache.pushHeadline({ ts: 999_500, source: "new", title: "fresh" });

    const bundle = await assembleState({
      broker,
      cache,
      symbol: "EURUSD",
      ts: 1_000_000,
      trigger: { reason: "schedule" },
      newsLookbackMs: 1000,
    });
    expect(bundle.recentNews.map((h) => h.title)).toEqual(["fresh"]);
  });
});
