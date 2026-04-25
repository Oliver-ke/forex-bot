import { describe, expect, it } from "vitest";
import { StateBundleSchema } from "../src/state.js";
import { TradeJournalSchema } from "../src/journal.js";

describe("journal + state bundle", () => {
  it("TradeJournal round-trips with minimal fields", () => {
    const j = TradeJournalSchema.parse({
      tradeId: "t-1",
      symbol: "EURUSD",
      openedAt: 1,
      verdict: { direction: "long", confidence: 0.8, horizon: "H1", reasoning: "x" },
      risk: {
        approve: true,
        lotSize: 0.1,
        sl: 1.07,
        tp: 1.09,
        expiresAt: 2,
        reasons: ["ok"],
      },
    });
    expect(j.tradeId).toBe("t-1");
  });

  it("StateBundle composes MTF market + analyst context", () => {
    const c = { ts: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 };
    const s = StateBundleSchema.parse({
      symbol: "EURUSD",
      ts: 1,
      trigger: { reason: "schedule", timeframe: "H1" },
      market: { symbol: "EURUSD", M15: [c], H1: [c], H4: [c], D1: [c] },
      account: {
        ts: 1, currency: "USD", balance: 10000, equity: 10000, freeMargin: 10000,
        usedMargin: 0, marginLevelPct: 10000,
      },
      openPositions: [],
      recentNews: [],
      upcomingEvents: [],
      regimePrior: { label: "trending", volBucket: "normal" },
    });
    expect(s.symbol).toBe("EURUSD");
  });
});
