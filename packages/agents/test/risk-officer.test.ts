import type { RiskDecision, StateBundle, Verdict } from "@forex-bot/contracts";
import { FakeLlm } from "@forex-bot/llm-provider";
import { describe, expect, it } from "vitest";
import { riskOfficer } from "../src/risk-officer.js";

const stubBundle: StateBundle = {
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

const verdict: Verdict = {
  direction: "long",
  confidence: 0.7,
  horizon: "H1",
  reasoning: "x",
};

const tentativeApprove: RiskDecision = {
  approve: true,
  lotSize: 0.2,
  sl: 1.075,
  tp: 1.09,
  expiresAt: 100,
  reasons: ["all gates pass"],
};

const tentativeVeto: RiskDecision = {
  approve: false,
  vetoReason: "spread too wide",
};

describe("riskOfficer", () => {
  it("returns the LLM's approval as-is when no concerns", async () => {
    const llm = new FakeLlm({
      route: () => ({
        approve: true,
        lotSize: 0.2,
        sl: 1.075,
        tp: 1.09,
        expiresAt: 100,
        reasons: ["confidence > 0.5"],
      }),
    });
    const out = await riskOfficer({
      tentativeDecision: tentativeApprove,
      verdict,
      bundle: stubBundle,
      llm,
    });
    expect(out.approve).toBe(true);
    expect(llm.calls[0]?.model).toBe("claude-opus-4-7");
  });

  it("can tighten lotSize", async () => {
    const llm = new FakeLlm({
      route: () => ({
        approve: true,
        lotSize: 0.1,
        sl: 1.075,
        tp: 1.09,
        expiresAt: 100,
        reasons: ["regime prior weak; halving size"],
      }),
    });
    const out = await riskOfficer({
      tentativeDecision: tentativeApprove,
      verdict,
      bundle: stubBundle,
      llm,
    });
    if (!out.approve) throw new Error("expected approval");
    expect(out.lotSize).toBe(0.1);
  });

  it("can veto", async () => {
    const llm = new FakeLlm({
      route: () => ({ approve: false, vetoReason: "high-impact USD CPI within 12h" }),
    });
    const out = await riskOfficer({
      tentativeDecision: tentativeApprove,
      verdict,
      bundle: stubBundle,
      llm,
    });
    expect(out.approve).toBe(false);
  });

  it("passes through gate vetoes without invoking the LLM", async () => {
    const llm = new FakeLlm({ route: () => ({ approve: true }) }); // would be invalid if called
    const out = await riskOfficer({
      tentativeDecision: tentativeVeto,
      verdict,
      bundle: stubBundle,
      llm,
    });
    expect(out).toEqual(tentativeVeto);
    expect(llm.calls).toHaveLength(0);
  });
});
