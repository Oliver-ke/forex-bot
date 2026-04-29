import type { StateBundle } from "@forex-bot/contracts";
import type { RagDoc } from "@forex-bot/data-core";
import { FakeLlm } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { sentimentAnalyst } from "../src/sentiment-analyst.js";

const stub: StateBundle = {
  symbol: "EURUSD",
  ts: 100,
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
  recentNews: [
    { ts: 90, source: "reuters", title: "Fed signals rate hold" },
    { ts: 95, source: "ft", title: "ECB hints at cut" },
  ],
  upcomingEvents: [],
  regimePrior: { label: "trending", volBucket: "normal" },
};

const ragHits: RagDoc[] = [
  {
    id: "fed:press_release:80",
    text: "FOMC: maintains target range, citing easing inflation.",
    embedding: [1, 0],
    modelVersion: "fake-v1",
    metadata: { bank: "FED", title: "FOMC statement" },
    ts: 80,
  },
];

describe("sentimentAnalyst", () => {
  it("invokes Sonnet 4.6 with the sentiment prompt and source=sentiment", async () => {
    const llm = new FakeLlm({
      route: () => ({
        source: "sentiment",
        bias: "short",
        conviction: 0.55,
        reasoning: "FOMC hold + ECB cut hint = USD relative dovish.",
        evidence: ["Fed signals rate hold (Reuters)"],
      }),
    });
    const out = await sentimentAnalyst({ bundle: stub, llm, ragHits });
    expect(out.source).toBe("sentiment");
    expect(out.bias).toBe("short");
    expect(llm.calls[0]?.model).toBe("claude-sonnet-4-6");
    expect(llm.calls[0]?.system).toContain("sentiment analyst");
    expect(llm.calls[0]?.user).toContain("FOMC statement");
  });

  it("works with no RAG hits", async () => {
    const llm = new FakeLlm({
      route: () => ({
        source: "sentiment",
        bias: "neutral",
        conviction: 0.2,
        reasoning: "no clear signal",
        evidence: [],
      }),
    });
    const out = await sentimentAnalyst({ bundle: stub, llm });
    expect(out.bias).toBe("neutral");
  });
});
