import { FakeBroker } from "@forex-bot/broker-core";
import {
  type AccountState,
  type CalendarEvent,
  type Candle,
  type Symbol,
  defaultRiskConfig,
} from "@forex-bot/contracts";
import { InMemoryHotCache, InMemoryJournalStore } from "@forex-bot/data-core";
import { FakeLlm, type StructuredRequest } from "@forex-bot/llm-provider";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";
import { describe, expect, it, vi } from "vitest";
import { initialState, runIteration } from "../src/run-iteration.js";
import type { Executor, OpenIntent, RunnerDeps } from "../src/types.js";

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

/** Build a stub Executor: open records calls and returns true; reconcile returns []. */
function makeStubExecutor(): Executor & { openCalls: OpenIntent[] } {
  const openCalls: OpenIntent[] = [];
  return {
    openCalls,
    open: vi.fn(async (intent: OpenIntent) => {
      openCalls.push(intent);
      return true;
    }),
    reconcile: vi.fn(async (_now: number) => []),
  };
}

async function buildHarness(opts: {
  startMs: number;
  marketStaleMs?: number;
  budget?: { readonly tripped: boolean; readonly spendUsd: number };
}) {
  const symbol: Symbol = "EURUSD";

  const broker = new FakeBroker({
    accountCurrency: "USD",
    startingBalance: 10_000,
    pipScale: () => 0.0001,
    isDemo: true,
  });
  broker.setQuote(symbol, 1.0799, 1.0801);
  // ≥15 fresh H1 bars (we use 200 to satisfy all indicator lookbacks)
  const bars = buildBars(opts.startMs - 200 * HOUR_MS, 200, HOUR_MS);
  broker.setCandles(symbol, "M15", bars);
  broker.setCandles(symbol, "H1", bars);
  broker.setCandles(symbol, "H4", bars);
  broker.setCandles(symbol, "D1", bars);

  const cache = new InMemoryHotCache();
  const calendar: readonly CalendarEvent[] = [];
  await cache.setCalendarWindow(calendar);

  const llm = new FakeLlm({ route: consensusLongRoute() });

  const journal = new InMemoryJournalStore();
  const decisions = new InMemoryJournalStore();
  const executor = makeStubExecutor();

  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const deps: RunnerDeps = {
    broker,
    cache,
    llm,
    executor,
    journal,
    decisions,
    budget: opts.budget ?? { tripped: false, spendUsd: 0 },
    marketStaleMs: opts.marketStaleMs ?? 365 * 24 * 60 * 60 * 1000,
    log,
    watchedSymbols: [symbol],
    consensusThreshold: 0.7,
    buildGateContext: ({ now, symbol: sym, account, bundle: _bundle }) =>
      buildGateContextForTest(now, account, sym),
  };

  return { deps, broker, cache, llm, journal, decisions, executor, log };
}

describe("runner runIteration", () => {
  it("3 ticks → decisions.ticks === 3, decisions store has 3 records, executor.open called on approved ticks", async () => {
    const startMs = Date.UTC(2026, 2, 15, 12, 0, 0);
    const { deps, decisions, executor } = await buildHarness({ startMs });

    // Seed state so the FIRST tick's H1 schedule trigger fires.
    const state = initialState(startMs - HOUR_MS);

    const tickTimes = [startMs, startMs + HOUR_MS, startMs + 2 * HOUR_MS];
    for (const t of tickTimes) {
      await runIteration(deps, state, t);
    }

    expect(state.decisions.ticks).toBe(3);
    expect(state.decisions.approved + state.decisions.vetoed).toBe(3);

    // Decisions store should have 3 records (one per tick that produced a verdict).
    const allDecisions = await decisions.list({ limit: 100 });
    expect(allDecisions.items.length).toBe(3);

    // consensusLongRoute always approves, so all 3 ticks should have called open.
    expect(executor.openCalls.length).toBe(3);
  });

  it("skips the tick when the feed is stale — market closed", async () => {
    const startMs = Date.UTC(2026, 2, 15, 12, 0, 0);
    const { deps, decisions, executor } = await buildHarness({
      startMs,
      marketStaleMs: 60_000,
    });
    const state = initialState(startMs - HOUR_MS);

    await runIteration(deps, state, startMs);

    expect(state.decisions.ticks).toBe(0);
    expect((await decisions.list({ limit: 10 })).items.length).toBe(0);
    expect(executor.openCalls.length).toBe(0);
  });

  it("budget tripped — skips tick, does not advance lastTickedMs, does not open", async () => {
    const startMs = Date.UTC(2026, 2, 15, 12, 0, 0);
    const { deps, decisions, executor, log } = await buildHarness({
      startMs,
      budget: { tripped: true, spendUsd: 99 },
    });
    const state = initialState(startMs - HOUR_MS);
    const originalLastTickedMs = state.lastTickedMs;

    await runIteration(deps, state, startMs);

    // No ticks should have fired.
    expect(state.decisions.ticks).toBe(0);
    // executor.open must NOT have been called.
    expect(executor.openCalls.length).toBe(0);
    // lastTickedMs must NOT advance when the budget is tripped.
    expect(state.lastTickedMs).toBe(originalLastTickedMs);
    // decisions store should be empty.
    expect((await decisions.list({ limit: 10 })).items.length).toBe(0);
    // warn should have been called with the budget message.
    expect(log.warn).toHaveBeenCalledWith("budget tripped, skipping tick", { spendUsd: 99 });
  });
});
