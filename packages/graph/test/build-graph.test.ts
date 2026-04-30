import { type StateBundle, defaultRiskConfig } from "@forex-bot/contracts";
import { FakeLlm, type StructuredRequest } from "@forex-bot/llm-provider";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/build-graph.js";

const stubBundle: StateBundle = {
  symbol: "EURUSD",
  ts: 1_700_000_000_000,
  trigger: { reason: "schedule", timeframe: "H1" },
  market: {
    symbol: "EURUSD",
    M15: [{ ts: 1, open: 1.08, high: 1.081, low: 1.079, close: 1.0805, volume: 0 }],
    H1: [{ ts: 1, open: 1.08, high: 1.081, low: 1.079, close: 1.0805, volume: 0 }],
    H4: [{ ts: 1, open: 1.08, high: 1.085, low: 1.075, close: 1.083, volume: 0 }],
    D1: [{ ts: 1, open: 1.08, high: 1.09, low: 1.07, close: 1.085, volume: 0 }],
  },
  account: {
    ts: 1_700_000_000_000,
    currency: "USD",
    balance: 10_000,
    equity: 10_000,
    freeMargin: 9_500,
    usedMargin: 500,
    marginLevelPct: 2000,
  },
  openPositions: [],
  recentNews: [],
  upcomingEvents: [],
  regimePrior: { label: "trending", volBucket: "normal" },
};

function mkGateCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    now: 1_700_000_000_000,
    order: {
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.1,
      entry: 1.08,
      sl: 1.075,
      tp: 1.0875,
      expiresAt: 1_700_000_300_000,
    },
    account: {
      ts: 1_700_000_000_000,
      currency: "USD",
      balance: 10_000,
      equity: 10_000,
      freeMargin: 9_500,
      usedMargin: 500,
      marginLevelPct: 2000,
    },
    openPositions: [],
    config: defaultRiskConfig,
    currentSpreadPips: 1.0,
    medianSpreadPips: 1.0,
    atrPips: 40,
    session: "london",
    upcomingEvents: [],
    correlation: new CorrelationMatrix({}),
    killSwitch: new KillSwitch(),
    consecutiveLosses: 0,
    dailyPnlPct: 0,
    totalDdPct: 0,
    feedAgeSec: 1,
    currencyExposurePct: {},
    affectedCurrencies: (s) => [s.slice(0, 3), s.slice(3)],
    pipValuePerLot: () => 10,
    ...overrides,
  };
}

type Routes = {
  technical?: () => unknown;
  fundamental?: () => unknown;
  sentiment?: () => unknown;
  bull?: () => unknown;
  bear?: () => unknown;
  judge?: () => unknown;
  riskOfficer?: () => unknown;
};

function routeBy(routes: Routes) {
  return (req: StructuredRequest<unknown>): unknown => {
    const sys = req.system;
    if (sys.includes("Risk Officer")) return routes.riskOfficer?.();
    if (sys.includes("Judge")) return routes.judge?.();
    if (sys.includes("Bull-side debater")) return routes.bull?.();
    if (sys.includes("Bear-side debater")) return routes.bear?.();
    if (sys.includes("technical analyst")) return routes.technical?.();
    if (sys.includes("fundamental analyst")) return routes.fundamental?.();
    if (sys.includes("sentiment analyst")) return routes.sentiment?.();
    throw new Error(`unrouted system prompt: ${sys.slice(0, 60)}`);
  };
}

const longAnalyst = (source: string) => () => ({
  source,
  bias: "long",
  conviction: 0.8,
  reasoning: "x",
  evidence: [],
});

const debaterOut = (side: "bull" | "bear") => () => ({
  side,
  arguments: [`${side} arg`],
  risks: [`${side} risk`],
  counters: [`${side} counter`],
});

const verdictOut = () => ({
  direction: "long",
  confidence: 0.7,
  horizon: "H1",
  reasoning: "judge synthesizes long",
  debated: true,
});

const approveDecision = () => ({
  approve: true,
  lotSize: 0.05,
  sl: 1.075,
  tp: 1.0875,
  expiresAt: 1_700_000_300_000,
  reasons: ["risk-officer: approved"],
});

describe("buildGraph", () => {
  it("consensus path: analysts agree → consensusJudge → gates → riskOfficer approves", async () => {
    const llm = new FakeLlm({
      route: routeBy({
        technical: longAnalyst("technical"),
        fundamental: longAnalyst("fundamental"),
        sentiment: longAnalyst("sentiment"),
        riskOfficer: approveDecision,
      }),
    });
    const graph = buildGraph({ llm, consensusThreshold: 0.7 });
    const out = await graph.invoke({ bundle: stubBundle, gateContext: mkGateCtx() });
    expect(out.finalDecision?.approve).toBe(true);
    expect(out.verdict?.debated).toBe(false);
    const judgeCalls = llm.calls.filter((c) => c.system.includes("Judge"));
    const bullCalls = llm.calls.filter((c) => c.system.includes("Bull-side"));
    expect(judgeCalls).toHaveLength(0);
    expect(bullCalls).toHaveLength(0);
  });

  it("debate path: analysts disagree → bull → bear → judge → gates → riskOfficer approves", async () => {
    const llm = new FakeLlm({
      route: routeBy({
        technical: () => ({
          source: "technical",
          bias: "long",
          conviction: 0.8,
          reasoning: "x",
          evidence: [],
        }),
        fundamental: () => ({
          source: "fundamental",
          bias: "short",
          conviction: 0.8,
          reasoning: "x",
          evidence: [],
        }),
        sentiment: () => ({
          source: "sentiment",
          bias: "neutral",
          conviction: 0.5,
          reasoning: "x",
          evidence: [],
        }),
        bull: debaterOut("bull"),
        bear: debaterOut("bear"),
        judge: verdictOut,
        riskOfficer: approveDecision,
      }),
    });
    const graph = buildGraph({ llm, consensusThreshold: 0.7 });
    const out = await graph.invoke({ bundle: stubBundle, gateContext: mkGateCtx() });
    expect(out.finalDecision?.approve).toBe(true);
    expect(out.verdict?.debated).toBe(true);
    const bullCalls = llm.calls.filter((c) => c.system.includes("Bull-side"));
    const bearCalls = llm.calls.filter((c) => c.system.includes("Bear-side"));
    const judgeCalls = llm.calls.filter((c) => c.system.includes("Judge"));
    expect(bullCalls).toHaveLength(1);
    expect(bearCalls).toHaveLength(1);
    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0]?.model).toBe("claude-opus-4-7");
  });

  it("risk-veto path: gates reject before riskOfficer", async () => {
    const llm = new FakeLlm({
      route: routeBy({
        technical: longAnalyst("technical"),
        fundamental: longAnalyst("fundamental"),
        sentiment: longAnalyst("sentiment"),
      }),
    });
    const graph = buildGraph({ llm, consensusThreshold: 0.7 });
    const out = await graph.invoke({
      bundle: stubBundle,
      gateContext: mkGateCtx({ currentSpreadPips: 5, medianSpreadPips: 1 }),
    });
    expect(out.tentativeDecision?.approve).toBe(false);
    expect(out.finalDecision).toBeUndefined();
    const roCalls = llm.calls.filter((c) => c.system.includes("Risk Officer"));
    expect(roCalls).toHaveLength(0);
  });
});
