import type { StateBundle } from "@forex-bot/contracts";
import { FakeLlm } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { taAnalyst } from "../src/ta-analyst.js";

const stubBundle: StateBundle = {
  symbol: "EURUSD",
  ts: 1,
  trigger: { reason: "schedule", timeframe: "H1" },
  market: {
    symbol: "EURUSD",
    M15: [{ ts: 1, open: 1.08, high: 1.081, low: 1.079, close: 1.0805, volume: 0 }],
    H1: [{ ts: 1, open: 1.08, high: 1.082, low: 1.078, close: 1.0815, volume: 0 }],
    H4: [{ ts: 1, open: 1.08, high: 1.085, low: 1.075, close: 1.083, volume: 0 }],
    D1: [{ ts: 1, open: 1.08, high: 1.09, low: 1.07, close: 1.085, volume: 0 }],
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

describe("taAnalyst", () => {
  it("invokes the LLM with the TA system prompt and Sonnet 4.6", async () => {
    const llm = new FakeLlm({
      route: () => ({
        source: "technical",
        bias: "long",
        conviction: 0.7,
        reasoning: "HH/HL on H1.",
        evidence: ["H1 close above 20EMA"],
      }),
    });
    const out = await taAnalyst({ bundle: stubBundle, llm });
    expect(out.source).toBe("technical");
    expect(out.bias).toBe("long");
    expect(llm.calls[0]?.model).toBe("claude-sonnet-4-6");
    expect(llm.calls[0]?.system).toContain("technical analyst");
  });

  it("returns a neutral output when LLM produces conviction = 0", async () => {
    const llm = new FakeLlm({
      route: () => ({
        source: "technical",
        bias: "neutral",
        conviction: 0.0,
        reasoning: "no clear setup",
        evidence: [],
      }),
    });
    const out = await taAnalyst({ bundle: stubBundle, llm });
    expect(out.bias).toBe("neutral");
  });
});
