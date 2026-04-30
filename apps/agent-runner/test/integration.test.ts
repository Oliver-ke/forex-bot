import { FakeBroker } from "@forex-bot/broker-core";
import { type PendingOrder, defaultRiskConfig } from "@forex-bot/contracts";
import { InMemoryHotCache } from "@forex-bot/data-core";
import { execute } from "@forex-bot/executor";
import { FakeLlm, type StructuredRequest } from "@forex-bot/llm-provider";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";
import { describe, expect, it } from "vitest";
import { tick } from "../src/tick.js";

function pipScale(symbol: string): number {
  return symbol.endsWith("JPY") ? 0.01 : 0.0001;
}

function seedBroker(): FakeBroker {
  const broker = new FakeBroker({
    accountCurrency: "USD",
    startingBalance: 10_000,
    pipScale,
  });
  broker.setQuote("EURUSD", 1.08, 1.0801);
  for (const tf of ["M15", "H1", "H4", "D1"] as const) {
    broker.setCandles(
      "EURUSD",
      tf,
      Array.from({ length: 60 }, (_, i) => ({
        ts: i,
        open: 1.08,
        high: 1.0805,
        low: 1.0795,
        close: 1.08,
        volume: 0,
      })),
    );
  }
  return broker;
}

const NOW = 1_700_000_000_000;
const PENDING_ORDER: PendingOrder = {
  symbol: "EURUSD",
  side: "buy",
  lotSize: 0.1,
  entry: 1.08,
  sl: 1.075,
  tp: 1.0875,
  expiresAt: NOW + 5 * 60_000,
};

function baseGateContext(): GateContext {
  return {
    now: NOW,
    order: PENDING_ORDER,
    account: {
      ts: NOW,
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
  };
}

const approveDecision = () => ({
  approve: true,
  lotSize: 0.05,
  sl: 1.075,
  tp: 1.0875,
  expiresAt: NOW + 5 * 60_000,
  reasons: ["risk-officer: ok"],
});

function consensusLongRoute() {
  return (req: StructuredRequest<unknown>): unknown => {
    const sys = req.system;
    if (sys.includes("Risk Officer")) return approveDecision();
    if (sys.includes("technical analyst"))
      return { source: "technical", bias: "long", conviction: 0.8, reasoning: "x", evidence: [] };
    if (sys.includes("fundamental analyst"))
      return { source: "fundamental", bias: "long", conviction: 0.8, reasoning: "x", evidence: [] };
    if (sys.includes("sentiment analyst"))
      return { source: "sentiment", bias: "long", conviction: 0.8, reasoning: "x", evidence: [] };
    throw new Error(`unrouted: ${sys.slice(0, 40)}`);
  };
}

function debateLongRoute() {
  return (req: StructuredRequest<unknown>): unknown => {
    const sys = req.system;
    if (sys.includes("Risk Officer")) return approveDecision();
    if (sys.includes("Judge"))
      return {
        direction: "long",
        confidence: 0.7,
        horizon: "H1",
        reasoning: "judge synthesizes long",
        debated: true,
      };
    if (sys.includes("Bull-side debater"))
      return { side: "bull", arguments: ["a"], risks: ["r"], counters: ["c"] };
    if (sys.includes("Bear-side debater"))
      return { side: "bear", arguments: ["a"], risks: ["r"], counters: ["c"] };
    if (sys.includes("technical analyst"))
      return { source: "technical", bias: "long", conviction: 0.8, reasoning: "x", evidence: [] };
    if (sys.includes("fundamental analyst"))
      return {
        source: "fundamental",
        bias: "short",
        conviction: 0.8,
        reasoning: "x",
        evidence: [],
      };
    if (sys.includes("sentiment analyst"))
      return {
        source: "sentiment",
        bias: "neutral",
        conviction: 0.5,
        reasoning: "x",
        evidence: [],
      };
    throw new Error(`unrouted: ${sys.slice(0, 40)}`);
  };
}

describe("agent-runner integration", () => {
  it("consensus → approve → execute opens a position", async () => {
    const broker = seedBroker();
    const cache = new InMemoryHotCache();
    const llm = new FakeLlm({ route: consensusLongRoute() });

    const result = await tick({
      broker,
      cache,
      llm,
      symbol: "EURUSD",
      ts: NOW,
      trigger: { reason: "schedule", timeframe: "H1" },
      consensusThreshold: 0.7,
      buildGateContext: baseGateContext,
    });
    expect(result.decision.approve).toBe(true);
    if (!result.decision.approve) throw new Error("expected approve");

    const exec = await execute(
      {
        now: NOW,
        correlationId: "tick-1",
        decision: result.decision,
        order: PENDING_ORDER,
        preFire: {
          currentSpreadPips: 1.0,
          medianSpreadPips: 1.0,
          maxSpreadMultiplier: 2.0,
          freeMargin: 9_500,
          estimatedRequiredMargin: 500,
          feedAgeSec: 1,
          maxFeedAgeSec: 30,
        },
      },
      broker,
    );
    expect(exec.approved).toBe(true);

    const positions = await broker.getOpenPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.symbol).toBe("EURUSD");
  });

  it("debate → approve → execute opens a position and judge fires", async () => {
    const broker = seedBroker();
    const cache = new InMemoryHotCache();
    const llm = new FakeLlm({ route: debateLongRoute() });

    const result = await tick({
      broker,
      cache,
      llm,
      symbol: "EURUSD",
      ts: NOW,
      trigger: { reason: "schedule", timeframe: "H1" },
      consensusThreshold: 0.7,
      buildGateContext: baseGateContext,
    });
    expect(result.decision.approve).toBe(true);
    if (!result.decision.approve) throw new Error("expected approve");

    const judgeCalls = llm.calls.filter((c) => c.system.includes("Judge"));
    expect(judgeCalls).toHaveLength(1);

    const exec = await execute(
      {
        now: NOW,
        correlationId: "tick-2",
        decision: result.decision,
        order: PENDING_ORDER,
        preFire: {
          currentSpreadPips: 1.0,
          medianSpreadPips: 1.0,
          maxSpreadMultiplier: 2.0,
          freeMargin: 9_500,
          estimatedRequiredMargin: 500,
          feedAgeSec: 1,
          maxFeedAgeSec: 30,
        },
      },
      broker,
    );
    expect(exec.approved).toBe(true);
    expect(await broker.getOpenPositions()).toHaveLength(1);
  });

  it("risk-veto → no execute, no position", async () => {
    const broker = seedBroker();
    const cache = new InMemoryHotCache();
    const llm = new FakeLlm({ route: consensusLongRoute() });

    const result = await tick({
      broker,
      cache,
      llm,
      symbol: "EURUSD",
      ts: NOW,
      trigger: { reason: "schedule", timeframe: "H1" },
      consensusThreshold: 0.7,
      buildGateContext: () => ({
        ...baseGateContext(),
        currentSpreadPips: 5,
        medianSpreadPips: 1,
      }),
    });
    expect(result.decision.approve).toBe(false);
    expect(await broker.getOpenPositions()).toHaveLength(0);
  });
});
