import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeBroker } from "@forex-bot/broker-core";
import {
  type CalendarEvent,
  type Candle,
  type Symbol,
  defaultRiskConfig,
} from "@forex-bot/contracts";
import type { AccountState } from "@forex-bot/contracts";
import { InMemoryHotCache, InMemoryJournalStore } from "@forex-bot/data-core";
import { FakeLlm, type StructuredRequest } from "@forex-bot/llm-provider";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";
import { LegacyPaperExecutor } from "@forex-bot/runner";
import { Logger } from "@forex-bot/telemetry";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BudgetTracker } from "../src/guards.js";
import { type PaperRunnerDeps, initialState, runIteration } from "../src/main.js";
import { MetricsWriter } from "../src/metrics-writer.js";

const HOUR_MS = 60 * 60_000;

/** A single H1 bar at `ts` with `close`; high/low spread by 5 pips by default. */
function bar(ts: number, close: number, opts: { high?: number; low?: number } = {}): Candle {
  const high = opts.high ?? close + 0.0005;
  const low = opts.low ?? close - 0.0005;
  return { ts, open: close, high, low, close, volume: 1 };
}

/** Long, smooth bar series so `assembleState` and indicators have data on every TF. */
function buildBars(startMs: number, count: number, stepMs: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    out.push(bar(startMs + i * stepMs, 1.08 + i * 0.0001));
  }
  return out;
}

/** Mirrors `consensusLongRoute` in integration.test.ts. */
function consensusLongRoute() {
  return (req: StructuredRequest<unknown>): unknown => {
    const sys = req.system;
    if (sys.includes("Risk Officer")) {
      return {
        approve: true,
        lotSize: 0.05,
        sl: 1.075,
        tp: 1.0875,
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

function buildGateContextForTest(now: number, account: AccountState, symbol: Symbol): GateContext {
  return {
    now,
    order: {
      symbol,
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

async function buildHarness(opts: { startMs: number }) {
  const symbol: Symbol = "EURUSD";

  const broker = new FakeBroker({
    accountCurrency: "USD",
    startingBalance: 10_000,
    pipScale: () => 0.0001,
    isDemo: true,
  });
  broker.setQuote(symbol, 1.0799, 1.0801);
  // Seed ≥15 fresh H1 bars; latest bar is ~1h before startMs so ATR-based gatesNode has data.
  const bars = buildBars(opts.startMs - 200 * HOUR_MS, 200, HOUR_MS);
  broker.setCandles(symbol, "M15", bars);
  broker.setCandles(symbol, "H1", bars);
  broker.setCandles(symbol, "H4", bars);
  broker.setCandles(symbol, "D1", bars);

  const cache = new InMemoryHotCache();
  const calendar: readonly CalendarEvent[] = [];
  await cache.setCalendarWindow(calendar);

  const llm = new FakeLlm({ route: consensusLongRoute() });

  const dir = await mkdtemp(join(tmpdir(), "paper-runner-golden-"));
  const budget = new BudgetTracker({ maxUsd: 100 });
  const writer = new MetricsWriter({ outDir: dir });
  const log = new Logger({ base: { service: "paper-runner-golden-test" } });

  const journal = new InMemoryJournalStore();
  const decisions = new InMemoryJournalStore();
  const executor = new LegacyPaperExecutor();

  const deps: PaperRunnerDeps = {
    broker,
    cache,
    llm,
    budget,
    writer,
    journal,
    decisions,
    executor,
    marketStaleMs: 365 * 24 * 60 * 60 * 1000,
    log,
    watchedSymbols: [symbol],
    consensusThreshold: 0.7,
    buildGateContext: buildGateContextForTest,
  };

  return { deps, broker, cache, llm, budget, writer, journal, decisions, dir };
}

let testDir: string;

beforeEach(async () => {
  testDir = "";
});

afterEach(async () => {
  if (testDir) {
    await rm(testDir, { recursive: true, force: true });
  }
});

it("golden: consensus-long tick produces a stable decision shape", async () => {
  const startMs = Date.UTC(2026, 2, 15, 12, 0, 0);
  const { deps, decisions, dir } = await buildHarness({ startMs });
  testDir = dir;
  const state = initialState(startMs - 60 * 60_000);
  await runIteration(deps, state, startMs);
  const items = (await decisions.list({ limit: 10 })).items;
  expect(items.length).toBe(1);
  const d = items[0];
  expect(d?.verdict.direction).toBe("long");
  expect(typeof d?.risk.approve).toBe("boolean");
  // Record the exact approve value + counters as the baseline.
  expect({ approve: d?.risk.approve, ticks: state.decisions.ticks }).toMatchSnapshot();

  // Strengthened regression assertions on the approved consensus-long decision.
  expect(d?.symbol).toBe("EURUSD");

  expect(d?.verdict.confidence).toBeGreaterThanOrEqual(0);
  expect(d?.verdict.confidence).toBeLessThanOrEqual(1);

  if (d?.risk.approve) {
    // TypeScript narrows to the approve:true branch so sl/tp are available.
    expect(d.risk.sl).toBeLessThan(d.risk.tp);
  }
});
