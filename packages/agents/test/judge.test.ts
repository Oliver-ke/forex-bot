import type { AnalystOutput, StateBundle } from "@forex-bot/contracts";
import { FakeLlm } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import type { DebaterOutput } from "../src/debater.js";
import { judge } from "../src/judge.js";

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

const bull: DebaterOutput = { side: "bull", arguments: ["a"], risks: [], counters: [] };
const bear: DebaterOutput = { side: "bear", arguments: ["b"], risks: [], counters: [] };

describe("judge", () => {
  it("invokes Opus 4.7 with the judge prompt and returns debated=true", async () => {
    const llm = new FakeLlm({
      route: () => ({
        direction: "long",
        confidence: 0.65,
        horizon: "H4",
        reasoning: "TA confluence wins.",
        debated: true,
      }),
    });
    const out = await judge({ bundle: stub, analysts, bull, bear, llm });
    expect(out.direction).toBe("long");
    expect(out.debated).toBe(true);
    expect(llm.calls[0]?.model).toBe("claude-opus-4-7");
    expect(llm.calls[0]?.system).toContain("Judge");
  });
});
