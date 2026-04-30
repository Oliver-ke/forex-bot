import type { StateBundle } from "@forex-bot/contracts";
import { FakeLlm } from "@forex-bot/llm-provider";
import type { GateContext } from "@forex-bot/risk";
import { describe, expect, it } from "vitest";
import { type GraphState, aggregatorNode, analystsNode, regimeNode } from "../src/index.js";

const stubBundle: StateBundle = {
  symbol: "EURUSD",
  ts: 1,
  trigger: { reason: "schedule", timeframe: "H1" },
  market: {
    symbol: "EURUSD",
    M15: [{ ts: 1, open: 1.08, high: 1.081, low: 1.079, close: 1.0805, volume: 0 }],
    H1: [{ ts: 1, open: 1.08, high: 1.081, low: 1.079, close: 1.0805, volume: 0 }],
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

const stubGateContext = {} as unknown as GateContext;

describe("graph nodes", () => {
  it("regimeNode fills regimePrior from rule classifier", async () => {
    const state: GraphState = { bundle: stubBundle, gateContext: stubGateContext };
    const out = await regimeNode(state, { llm: new FakeLlm({ route: () => ({}) }) });
    expect(out.bundle?.regimePrior).toBeDefined();
  });

  it("analystsNode fans out to 3 analysts in parallel", async () => {
    const llm = new FakeLlm({
      route: (req) => {
        const source = req.system.includes("technical analyst")
          ? "technical"
          : req.system.includes("fundamental")
            ? "fundamental"
            : "sentiment";
        return { source, bias: "long", conviction: 0.8, reasoning: "x", evidence: [] };
      },
    });
    const state: GraphState = { bundle: stubBundle, gateContext: stubGateContext };
    const out = await analystsNode(state, { llm });
    expect(out.analysts).toHaveLength(3);
  });

  it("aggregatorNode declares consensus when all 3 agree above threshold", async () => {
    const state: GraphState = {
      bundle: stubBundle,
      gateContext: stubGateContext,
      analysts: [
        { source: "technical", bias: "long", conviction: 0.8, reasoning: "x", evidence: [] },
        { source: "fundamental", bias: "long", conviction: 0.75, reasoning: "x", evidence: [] },
        { source: "sentiment", bias: "long", conviction: 0.7, reasoning: "x", evidence: [] },
      ],
    };
    const out = await aggregatorNode(state, { consensusThreshold: 0.7 });
    expect(out.consensus).toBe(true);
  });
});
