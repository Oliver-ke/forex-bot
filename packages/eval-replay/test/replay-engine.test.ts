import type {
  AccountState,
  CalendarEvent,
  Candle,
  NewsHeadline,
  StateBundle,
  Symbol,
} from "@forex-bot/contracts";
import { defaultRiskConfig } from "@forex-bot/contracts";
import { ReplayClock } from "@forex-bot/eval-core";
import { FakeLlm, type StructuredRequest } from "@forex-bot/llm-provider";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";
import { describe, expect, it } from "vitest";
import { FixtureBroker } from "../src/fixture-broker.js";
import { FixtureHotCache } from "../src/fixture-cache.js";
import { ReplayEngine } from "../src/replay-engine.js";

const HOUR_MS = 60 * 60_000;

function bar(ts: number, close: number, opts: { high?: number; low?: number } = {}): Candle {
  const high = opts.high ?? close + 0.0005;
  const low = opts.low ?? close - 0.0005;
  return { ts, open: close, high, low, close, volume: 1 };
}

/**
 * 10 H1 bars over 10 hours. Bar 7 (index 7) dips to 1.0750 — that should hit
 * SL at 1.0750 for a buy entered around 1.080.
 */
function buildBars(startMs: number): readonly Candle[] {
  return [
    bar(startMs + 0 * HOUR_MS, 1.08),
    bar(startMs + 1 * HOUR_MS, 1.0805),
    bar(startMs + 2 * HOUR_MS, 1.081),
    bar(startMs + 3 * HOUR_MS, 1.0815),
    bar(startMs + 4 * HOUR_MS, 1.082),
    bar(startMs + 5 * HOUR_MS, 1.0815),
    bar(startMs + 6 * HOUR_MS, 1.081),
    // Bar 7 — dips to 1.0750 (sl). Use low override.
    bar(startMs + 7 * HOUR_MS, 1.078, { low: 1.075, high: 1.0815 }),
    bar(startMs + 8 * HOUR_MS, 1.0775),
    bar(startMs + 9 * HOUR_MS, 1.077),
  ];
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
        // Engine never reads expiresAt for routing; supply a generous future ts.
        expiresAt: 9_999_999_999_999,
        reasons: ["risk-officer: ok"],
      };
    }
    if (sys.includes("technical analyst"))
      return { source: "technical", bias: "long", conviction: 0.85, reasoning: "x", evidence: [] };
    if (sys.includes("fundamental analyst"))
      return {
        source: "fundamental",
        bias: "long",
        conviction: 0.85,
        reasoning: "x",
        evidence: [],
      };
    if (sys.includes("sentiment analyst"))
      return { source: "sentiment", bias: "long", conviction: 0.85, reasoning: "x", evidence: [] };
    throw new Error(`unrouted system prompt: ${sys.slice(0, 60)}`);
  };
}

function buildGateContext(_bundle: StateBundle, now: number): GateContext {
  const account: AccountState = {
    ts: now,
    currency: "USD",
    balance: 10_000,
    equity: 10_000,
    freeMargin: 9_500,
    usedMargin: 500,
    marginLevelPct: 2000,
  };
  return {
    now,
    order: {
      symbol: "EURUSD",
      side: "buy",
      lotSize: 0.05,
      entry: 1.08,
      sl: 1.075,
      tp: 1.0875,
      expiresAt: now + 5 * 60_000,
    },
    account,
    openPositions: [],
    config: defaultRiskConfig,
    currentSpreadPips: 1.0,
    medianSpreadPips: 1.0,
    atrPips: 30,
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

describe("ReplayEngine", () => {
  it("drives tick through the real graph and records an SL-closed trade", async () => {
    const symbol: Symbol = "EURUSD";
    // Anchor the replay window at 2024-01-01 00:00:00 UTC for stable ts math.
    const startMs = Date.UTC(2024, 0, 1, 0, 0, 0);
    const endMs = startMs + 9 * HOUR_MS;
    const bars = buildBars(startMs);

    const clock = new ReplayClock(startMs);

    const headlines: readonly NewsHeadline[] = [
      { ts: startMs - 3600_000, source: "fixture", title: "EUR sentiment update" },
    ];
    const calendar: readonly CalendarEvent[] = [
      {
        ts: startMs + 5 * HOUR_MS,
        currency: "USD",
        impact: "medium",
        title: "Test medium event",
      },
    ];

    // Seed all timeframes with the same bars so state-assembler has full data.
    const tfBars = new Map<string, readonly Candle[]>();
    for (const tf of ["M15", "H1", "H4", "D1"] as const) {
      tfBars.set(`${symbol}:${tf}`, bars);
    }
    const broker = new FixtureBroker({ clock, bars: tfBars });
    const cache = new FixtureHotCache({ clock, headlines, calendar });

    const llm = new FakeLlm({ route: consensusLongRoute() });

    const engine = new ReplayEngine({
      broker,
      cache,
      llm,
      buildGateContext,
      futureBars: (_sym, fromMs) => bars.filter((b) => b.ts >= fromMs),
    });

    const report = await engine.run(
      {
        startMs,
        endMs,
        // 1h step so we get one tick per H1 bar.
        stepMs: HOUR_MS,
        symbols: [symbol],
        consensusThreshold: 0.7,
        startingEquity: 10_000,
      },
      clock,
    );

    expect(report.trades.length).toBeGreaterThanOrEqual(1);
    const first = report.trades[0];
    if (!first) throw new Error("expected at least one trade");
    expect(first.exitReason).toBe("sl");
    expect(first.side).toBe("buy");
    expect(first.exit).toBeCloseTo(1.075, 5);
    expect(report.metrics.tradeCount).toBeGreaterThanOrEqual(1);
    expect(report.equity.length).toBeGreaterThanOrEqual(1);
    expect(report.window).toEqual({ startMs, endMs });
    expect(report.symbols).toEqual([symbol]);
  });
});
