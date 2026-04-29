import type { AnalystOutput, StateBundle } from "@forex-bot/contracts";
import { FakeLlm } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { debate } from "../src/debater.js";

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
  upcomingEvents: [],
  regimePrior: { label: "trending", volBucket: "normal" },
};

const analysts: AnalystOutput[] = [
  { source: "technical", bias: "long", conviction: 0.7, reasoning: "x", evidence: [] },
  { source: "fundamental", bias: "short", conviction: 0.6, reasoning: "x", evidence: [] },
  { source: "sentiment", bias: "neutral", conviction: 0.4, reasoning: "x", evidence: [] },
];

describe("debate", () => {
  it("Bull side calls Sonnet 4.6 with the bull prompt", async () => {
    const llm = new FakeLlm({
      route: () => ({ side: "bull", arguments: ["Trend up"], risks: ["news"], counters: ["x"] }),
    });
    const out = await debate({ side: "bull", bundle: stub, analysts, llm });
    expect(out.side).toBe("bull");
    expect(llm.calls[0]?.system).toContain("Bull-side debater");
    expect(llm.calls[0]?.model).toBe("claude-sonnet-4-6");
  });

  it("Bear side uses the bear prompt", async () => {
    const llm = new FakeLlm({
      route: () => ({ side: "bear", arguments: ["Trend down"], risks: [], counters: [] }),
    });
    const out = await debate({ side: "bear", bundle: stub, analysts, llm });
    expect(out.side).toBe("bear");
    expect(llm.calls[0]?.system).toContain("Bear-side debater");
  });
});
