import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeBroker } from "@forex-bot/broker-core";
import {
  type AccountState,
  type CalendarEvent,
  type Candle,
  type Symbol,
  defaultRiskConfig,
} from "@forex-bot/contracts";
import { InMemoryHotCache } from "@forex-bot/data-core";
import { FakeLlm, type LlmUsage, type StructuredRequest } from "@forex-bot/llm-provider";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";
import { Logger } from "@forex-bot/telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BudgetTracker } from "../src/guards.js";
import {
  type PaperRunnerDeps,
  initialState,
  readConfig,
  runIteration,
  utcDayMs,
} from "../src/main.js";
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

/** Mirrors `consensusLongRoute` in eval-replay/test/replay-engine.test.ts. */
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

const ENV_KEYS = [
  "PAPER_MODE",
  "PAPER_BUDGET_USD",
  "MT5_DEMO",
  "MT5_HOST",
  "MT5_PORT",
  "REDIS_URL",
  "ANTHROPIC_API_KEY",
  "WATCHED_SYMBOLS",
  "REDIS_NAMESPACE",
  "POLL_MS",
  "PAPER_OUT_DIR",
] as const;

describe("paper-runner readConfig boot guards", () => {
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("throws when PAPER_MODE is not set", () => {
    expect(() => readConfig()).toThrow(/PAPER_MODE=1 is required/);
  });

  it("throws when PAPER_MODE is set but PAPER_BUDGET_USD is missing", () => {
    process.env.PAPER_MODE = "1";
    expect(() => readConfig()).toThrow(/PAPER_BUDGET_USD/);
  });

  it("throws when MT5_DEMO is not set", () => {
    process.env.PAPER_MODE = "1";
    process.env.PAPER_BUDGET_USD = "10";
    expect(() => readConfig()).toThrow(/MT5_DEMO=1/);
  });

  it("succeeds when all required env vars are present", () => {
    process.env.PAPER_MODE = "1";
    process.env.PAPER_BUDGET_USD = "10";
    process.env.MT5_DEMO = "1";
    process.env.MT5_HOST = "localhost";
    process.env.MT5_PORT = "5555";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.WATCHED_SYMBOLS = "EURUSD";
    const cfg = readConfig();
    expect(cfg.paperBudgetUsd).toBe(10);
    expect(cfg.watchedSymbols).toEqual(["EURUSD"]);
  });
});

describe("paper-runner runIteration integration", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paper-runner-int-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Build the deps + initial state with a FakeBroker(isDemo: true), InMemoryHotCache, FakeLlm. */
  async function buildHarness(opts: { startMs: number; budgetMaxUsd?: number }) {
    const symbol: Symbol = "EURUSD";

    const broker = new FakeBroker({
      accountCurrency: "USD",
      startingBalance: 10_000,
      pipScale: () => 0.0001,
      isDemo: true,
    });
    // Quote needed so anything that fetches a quote can run.
    broker.setQuote(symbol, 1.0799, 1.0801);
    // Bars across all TFs that state-assembler reads. Use bar count > 30 so
    // ATR(14) on H1 has enough data and triggers can detect schedule rollovers.
    const bars = buildBars(opts.startMs - 200 * HOUR_MS, 200, HOUR_MS);
    broker.setCandles(symbol, "M15", bars);
    broker.setCandles(symbol, "H1", bars);
    broker.setCandles(symbol, "H4", bars);
    broker.setCandles(symbol, "D1", bars);

    const cache = new InMemoryHotCache();
    const calendar: readonly CalendarEvent[] = [];
    await cache.setCalendarWindow(calendar);

    const llm = new FakeLlm({ route: consensusLongRoute() });

    const budget = new BudgetTracker({ maxUsd: opts.budgetMaxUsd ?? 100 });
    const writer = new MetricsWriter({ outDir: dir });
    const log = new Logger({ base: { service: "paper-runner-test" } });

    const deps: PaperRunnerDeps = {
      broker,
      cache,
      llm,
      budget,
      writer,
      log,
      watchedSymbols: [symbol],
      consensusThreshold: 0.7,
      buildGateContext: buildGateContextForTest,
    };

    return { deps, broker, cache, llm, budget, writer };
  }

  it("3 ticks fire, decisions counter increments, approved trade accumulates", async () => {
    // Anchor at 2026-03-15 12:00 UTC so we don't cross a day boundary in the loop.
    const startMs = Date.UTC(2026, 2, 15, 12, 0, 0);
    const { deps, llm, budget } = await buildHarness({ startMs });

    // Note: FakeLlm does NOT call onUsage by default, so the BudgetWrappedLlm
    // wrapper is bypassed in this test. We instead simulate spend by calling
    // `budget.onUsage(...)` directly to verify the budget tracker hook works.
    const usage: LlmUsage = {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };

    // Seed state so the FIRST tick's H1 schedule trigger fires (lastTickedMs
    // was in the previous H1 window).
    const state = initialState(startMs - HOUR_MS);

    const tickTimes = [startMs, startMs + HOUR_MS, startMs + 2 * HOUR_MS];
    for (const t of tickTimes) {
      await runIteration(deps, state, t);
      // Simulate a per-iteration LLM spend.
      budget.onUsage(usage);
    }

    expect(state.decisions.ticks).toBe(3);
    expect(state.decisions.approved).toBeGreaterThanOrEqual(1);
    expect(state.cumulativeTrades.length).toBe(state.decisions.approved);
    // 3 × ($3 input + $1.50 output) = $13.50
    expect(budget.spendUsd).toBeCloseTo(13.5, 5);
    expect(budget.tripped).toBe(false);

    // FakeLlm should have been invoked at least once per tick (analysts +
    // consensus-judge + risk-officer ≈ 5 calls minimum on the consensus path).
    expect(llm.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("daily flush fires when nowMs crosses a UTC day boundary; writes expected files", async () => {
    // Anchor near 23:00 UTC so a single +2h step crosses the next UTC day.
    const day1Ms = Date.UTC(2026, 2, 15, 23, 0, 0);
    const day2Ms = Date.UTC(2026, 2, 16, 1, 0, 0);

    const { deps } = await buildHarness({ startMs: day1Ms });

    const state = initialState(day1Ms - HOUR_MS);

    // Tick on day1 (no flush — same day).
    await runIteration(deps, state, day1Ms);
    expect(state.lastFlushDayMs).toBe(utcDayMs(day1Ms - HOUR_MS));

    // Tick on day2: should flush metrics for the prior day.
    await runIteration(deps, state, day2Ms);
    expect(state.lastFlushDayMs).toBe(utcDayMs(day2Ms));

    // Verify output files exist with expected names.
    const files = await readdir(dir);
    // metrics-YYYYMMDD.json for the prior day (2026-03-15) + paper-summary.jsonl
    expect(files.sort()).toContain("paper-summary.jsonl");
    const dailyFile = files.find((f) => f.startsWith("metrics-") && f.endsWith(".json"));
    expect(dailyFile).toBeDefined();
    // Confirm the JSON content is shaped like a DailyMetricsSnapshot.
    const dailyJson = JSON.parse(await readFile(join(dir, dailyFile as string), "utf8"));
    expect(dailyJson).toMatchObject({
      dayMs: expect.any(Number),
      generatedAt: expect.any(Number),
      metrics: expect.any(Object),
      decisions: expect.any(Object),
      llmSpendUsd: expect.any(Number),
      perSession: expect.any(Object),
      perRegime: expect.any(Object),
    });
  });

  it("when budget is tripped, ticks are skipped", async () => {
    const startMs = Date.UTC(2026, 2, 15, 12, 0, 0);
    const { deps, budget } = await buildHarness({ startMs, budgetMaxUsd: 0.01 });

    // Trip the budget BEFORE iterating.
    budget.onUsage({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(budget.tripped).toBe(true);

    const state = initialState(startMs - HOUR_MS);
    await runIteration(deps, state, startMs);

    expect(state.decisions.ticks).toBe(0);
    expect(state.cumulativeTrades.length).toBe(0);
  });
});
