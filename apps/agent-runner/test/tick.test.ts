import { FakeBroker } from "@forex-bot/broker-core";
import { defaultRiskConfig } from "@forex-bot/contracts";
import { InMemoryHotCache } from "@forex-bot/data-core";
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

function mkBuildGateContext() {
  return (): GateContext => ({
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
  });
}

function consensusLongRoute() {
  return (req: StructuredRequest<unknown>): unknown => {
    const sys = req.system;
    if (sys.includes("Risk Officer")) {
      return {
        approve: true,
        lotSize: 0.05,
        sl: 1.075,
        tp: 1.0875,
        expiresAt: 1_700_000_300_000,
        reasons: ["risk-officer: ok"],
      };
    }
    if (sys.includes("technical analyst"))
      return { source: "technical", bias: "long", conviction: 0.8, reasoning: "x", evidence: [] };
    if (sys.includes("fundamental analyst"))
      return { source: "fundamental", bias: "long", conviction: 0.8, reasoning: "x", evidence: [] };
    if (sys.includes("sentiment analyst"))
      return { source: "sentiment", bias: "long", conviction: 0.8, reasoning: "x", evidence: [] };
    throw new Error(`unrouted: ${sys.slice(0, 40)}`);
  };
}

describe("tick", () => {
  it("returns approve decision when consensus + gates + risk-officer all pass", async () => {
    const broker = seedBroker();
    const cache = new InMemoryHotCache();
    const llm = new FakeLlm({ route: consensusLongRoute() });

    const out = await tick({
      broker,
      cache,
      llm,
      symbol: "EURUSD",
      ts: 1_700_000_000_000,
      trigger: { reason: "schedule", timeframe: "H1" },
      consensusThreshold: 0.7,
      buildGateContext: mkBuildGateContext(),
    });

    expect(out.decision.approve).toBe(true);
    expect(out.bundle.symbol).toBe("EURUSD");
  });

  it("returns veto decision when gates reject (wide spread)", async () => {
    const broker = seedBroker();
    const cache = new InMemoryHotCache();
    const llm = new FakeLlm({ route: consensusLongRoute() });

    const out = await tick({
      broker,
      cache,
      llm,
      symbol: "EURUSD",
      ts: 1_700_000_000_000,
      trigger: { reason: "schedule", timeframe: "H1" },
      consensusThreshold: 0.7,
      buildGateContext: () => ({
        ...mkBuildGateContext()(),
        currentSpreadPips: 5,
        medianSpreadPips: 1,
      }),
    });

    expect(out.decision.approve).toBe(false);
  });
});
