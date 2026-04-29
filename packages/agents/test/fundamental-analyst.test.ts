import type { StateBundle } from "@forex-bot/contracts";
import { FakeLlm } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { fundamentalAnalyst } from "../src/fundamental-analyst.js";

const stub: StateBundle = {
  symbol: "EURUSD",
  ts: 1,
  trigger: { reason: "schedule", timeframe: "H1" },
  market: {
    symbol: "EURUSD",
    M15: [{ ts: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 }],
    H1: [{ ts: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 }],
    H4: [{ ts: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 }],
    D1: [{ ts: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 }],
  },
  account: {
    ts: 1,
    currency: "USD",
    balance: 10_000,
    equity: 10_000,
    freeMargin: 10_000,
    usedMargin: 0,
    marginLevelPct: 0,
  },
  openPositions: [],
  recentNews: [],
  upcomingEvents: [
    { ts: 100, currency: "USD", impact: "high", title: "CPI" },
    { ts: 200, currency: "EUR", impact: "low", title: "PMI" },
  ],
  regimePrior: { label: "event-driven", volBucket: "normal" },
};

describe("fundamentalAnalyst", () => {
  it("invokes Sonnet 4.6 with the fundamental prompt and source=fundamental", async () => {
    const llm = new FakeLlm({
      route: () => ({
        source: "fundamental",
        bias: "short",
        conviction: 0.6,
        reasoning: "USD CPI tomorrow, USD rate diff favors continuation.",
        evidence: ["USD CPI in input.upcomingEvents"],
      }),
    });
    const out = await fundamentalAnalyst({ bundle: stub, llm });
    expect(out.source).toBe("fundamental");
    expect(out.bias).toBe("short");
    expect(llm.calls[0]?.model).toBe("claude-sonnet-4-6");
    expect(llm.calls[0]?.system).toContain("fundamental analyst");
    // High-impact USD CPI is in scope; user message should include it.
    expect(llm.calls[0]?.user).toContain("CPI");
  });

  it("filters low-impact events out of the user message", async () => {
    const llm = new FakeLlm({
      route: () => ({
        source: "fundamental",
        bias: "neutral",
        conviction: 0.3,
        reasoning: "no clear catalyst",
        evidence: [],
      }),
    });
    await fundamentalAnalyst({ bundle: stub, llm });
    expect(llm.calls[0]?.user).not.toContain("PMI");
  });
});
