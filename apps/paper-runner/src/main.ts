import { detectTriggers, tick } from "@forex-bot/agent-runner";
import type { Broker } from "@forex-bot/broker-core";
import { MT5Broker, createMT5Client } from "@forex-bot/broker-mt5";
import { RedisHotCache } from "@forex-bot/cache";
import {
  type RiskDecision,
  type StateBundle,
  type Symbol,
  defaultRiskConfig,
} from "@forex-bot/contracts";
import type { HotCache } from "@forex-bot/data-core";
import type { Trade } from "@forex-bot/eval-core";
import { AnthropicLlm, type LlmProvider, type StructuredRequest } from "@forex-bot/llm-provider";
import { CorrelationMatrix, type GateContext, KillSwitch } from "@forex-bot/risk";
import { Logger } from "@forex-bot/telemetry";
import {
  BudgetTracker,
  type DecisionCounters,
  MetricsWriter,
  type RegimeKey,
  type SessionKey,
  assertDemoBroker,
} from "./index.js";

export interface PaperConfig {
  mt5Host: string;
  mt5Port: number;
  redisUrl: string;
  redisNamespace: string;
  anthropicApiKey: string;
  watchedSymbols: readonly Symbol[];
  pollMs: number;
  paperBudgetUsd: number;
  paperOutDir: string;
}

export function readConfig(): PaperConfig {
  if (process.env.PAPER_MODE !== "1") {
    throw new Error("PAPER_MODE=1 is required to run paper-runner");
  }
  if (!process.env.PAPER_BUDGET_USD) {
    throw new Error("PAPER_BUDGET_USD is required");
  }
  const paperBudgetUsd = Number(process.env.PAPER_BUDGET_USD);
  if (!Number.isFinite(paperBudgetUsd) || paperBudgetUsd <= 0) {
    throw new Error("PAPER_BUDGET_USD must be a positive number");
  }
  if (process.env.MT5_DEMO !== "1") {
    throw new Error("MT5_DEMO=1 is required for paper-runner");
  }
  const required = ["MT5_HOST", "MT5_PORT", "REDIS_URL", "ANTHROPIC_API_KEY", "WATCHED_SYMBOLS"];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`missing env var: ${key}`);
  }
  const symbols = (process.env.WATCHED_SYMBOLS as string)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as Symbol[];
  return {
    mt5Host: process.env.MT5_HOST as string,
    mt5Port: Number(process.env.MT5_PORT),
    redisUrl: process.env.REDIS_URL as string,
    redisNamespace: process.env.REDIS_NAMESPACE ?? "forex-bot",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY as string,
    watchedSymbols: symbols,
    pollMs: Number(process.env.POLL_MS ?? 60_000),
    paperBudgetUsd,
    paperOutDir: process.env.PAPER_OUT_DIR ?? "./paper-out",
  };
}

/**
 * Wraps any LlmProvider so that token usage is also reported to a BudgetTracker.
 * Constructed inside main() — never instantiate AnthropicLlm at module top-level.
 */
class BudgetWrappedLlm implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly budget: BudgetTracker,
  ) {}

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const userOnUsage = req.onUsage;
    return this.inner.structured({
      ...req,
      onUsage: (u) => {
        this.budget.onUsage(u);
        userOnUsage?.(u);
      },
    });
  }
}

function buildGateContextDefault(
  now: number,
  account: GateContext["account"],
  symbol: Symbol,
): GateContext {
  return {
    now,
    order: {
      symbol,
      side: "buy",
      lotSize: 0.1,
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

export function utcDayMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function emptyDecisionCounters(): DecisionCounters {
  return {
    ticks: 0,
    approved: 0,
    vetoed: 0,
    consensus: 0,
    debated: 0,
    judgeOverrideOfDebate: 0,
    riskOfficerOverride: 0,
  };
}

/**
 * Synthesize a Trade record from a tick result. Paper-runner v1 does not yet
 * track real position lifecycle; the close price is the bundle's mid quote and
 * pnl is left at zero. Replaced with a real ledger when v2 lands.
 */
export function synthesizeTrade(
  ts: number,
  bundle: StateBundle,
  decision: Extract<RiskDecision, { approve: true }>,
): Trade {
  const lastClose = bundle.market.H1.at(-1)?.close ?? (decision.sl + decision.tp) / 2;
  const mid = lastClose;
  return {
    symbol: bundle.symbol,
    openedAt: ts,
    closedAt: ts,
    side: "buy",
    entry: mid,
    sl: decision.sl,
    tp: decision.tp,
    exit: mid,
    lotSize: decision.lotSize,
    pnl: 0,
    realizedR: 0,
    exitReason: "manual",
    verdict: {
      direction: "neutral",
      confidence: 0.5,
      horizon: "H1",
      reasoning: "paper-runner placeholder verdict",
    },
    decision,
  };
}

export interface PaperRunnerDeps {
  broker: Broker;
  cache: HotCache;
  llm: LlmProvider;
  budget: BudgetTracker;
  writer: MetricsWriter;
  log: Logger;
  watchedSymbols: readonly Symbol[];
  consensusThreshold: number;
  /** Build GateContext per tick. */
  buildGateContext: (now: number, account: GateContext["account"], symbol: Symbol) => GateContext;
}

export interface RunIterationsState {
  lastTickedMs: number;
  lastRebalanceMs: number;
  lastFlushDayMs: number;
  cumulativeTrades: Trade[];
  sessions: Map<Trade, SessionKey>;
  regimes: Map<Trade, RegimeKey>;
  decisions: DecisionCounters;
}

/** Build the initial state for the poll loop, anchored at `nowMs`. */
export function initialState(nowMs: number): RunIterationsState {
  return {
    lastTickedMs: nowMs,
    lastRebalanceMs: nowMs,
    lastFlushDayMs: utcDayMs(nowMs),
    cumulativeTrades: [],
    sessions: new Map(),
    regimes: new Map(),
    decisions: emptyDecisionCounters(),
  };
}

/**
 * Runs one iteration of the paper-runner poll loop. Mutates `state` in place
 * and returns it for convenient chaining. Does NOT sleep — caller controls
 * pacing. Daily flush fires when `nowMs` crosses a UTC day boundary.
 */
export async function runIteration(
  deps: PaperRunnerDeps,
  state: RunIterationsState,
  nowMs: number,
): Promise<RunIterationsState> {
  if (deps.budget.tripped) {
    deps.log.warn("budget tripped, skipping tick", { spendUsd: deps.budget.spendUsd });
  } else {
    for (const symbol of deps.watchedSymbols) {
      try {
        const candlesH1 = await deps.broker.getCandles(symbol, "H1", 200);
        const calendar = await deps.cache.getCalendarWindow();
        const triggers = detectTriggers({
          nowMs,
          lastTickedMs: state.lastTickedMs,
          candlesByTf: { H1: candlesH1 },
          upcomingEvents: calendar,
          lastRebalanceMs: state.lastRebalanceMs,
        });
        if (triggers.length === 0) continue;

        const account = await deps.broker.getAccount();
        const trigger = triggers[0];
        if (!trigger) continue;
        const result = await tick({
          broker: deps.broker,
          cache: deps.cache,
          llm: deps.llm,
          symbol,
          ts: nowMs,
          trigger,
          consensusThreshold: deps.consensusThreshold,
          buildGateContext: () => deps.buildGateContext(nowMs, account, symbol),
        });
        state.decisions.ticks += 1;
        if (result.decision.approve) {
          state.decisions.approved += 1;
          const trade = synthesizeTrade(nowMs, result.bundle, result.decision);
          state.cumulativeTrades.push(trade);
          state.sessions.set(trade, "london");
          state.regimes.set(trade, result.bundle.regimePrior.label);
        } else {
          state.decisions.vetoed += 1;
        }
        deps.log.info("tick complete", {
          symbol,
          trigger: trigger.reason,
          approved: result.decision.approve,
        });
        if (triggers.some((t) => t.reason === "rebalance")) state.lastRebalanceMs = nowMs;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        deps.log.error("tick failed", { symbol, err: msg });
      }
    }
    state.lastTickedMs = nowMs;
  }

  // Daily flush at UTC midnight boundary.
  const todayMs = utcDayMs(nowMs);
  if (todayMs !== state.lastFlushDayMs) {
    try {
      const snapshot = deps.writer.buildSnapshot({
        dayMs: state.lastFlushDayMs,
        cumulativeTrades: state.cumulativeTrades,
        sessions: state.sessions,
        regimes: state.regimes,
        decisions: state.decisions,
        llmSpendUsd: deps.budget.spendUsd,
      });
      await deps.writer.flush(snapshot);
      deps.log.info("daily metrics flushed", {
        dayMs: state.lastFlushDayMs,
        trades: state.cumulativeTrades.length,
        spendUsd: deps.budget.spendUsd,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      deps.log.error("daily flush failed", { err: msg });
    }
    state.lastFlushDayMs = todayMs;
  }

  return state;
}

export async function main(): Promise<void> {
  const cfg = readConfig();
  const log = new Logger({ base: { service: "paper-runner" } });

  const broker = new MT5Broker(createMT5Client({ host: cfg.mt5Host, port: cfg.mt5Port }), true);
  assertDemoBroker(broker);

  const cache = new RedisHotCache({ url: cfg.redisUrl, namespace: cfg.redisNamespace });
  await cache.connect();

  const upstream = new AnthropicLlm({ apiKey: cfg.anthropicApiKey });
  const budget = new BudgetTracker({ maxUsd: cfg.paperBudgetUsd });
  const llm = new BudgetWrappedLlm(upstream, budget);

  const writer = new MetricsWriter({ outDir: cfg.paperOutDir });

  log.info("paper-runner started", {
    symbols: cfg.watchedSymbols,
    pollMs: cfg.pollMs,
    paperBudgetUsd: cfg.paperBudgetUsd,
    paperOutDir: cfg.paperOutDir,
  });

  const deps: PaperRunnerDeps = {
    broker,
    cache,
    llm,
    budget,
    writer,
    log,
    watchedSymbols: cfg.watchedSymbols,
    consensusThreshold: defaultRiskConfig.agent.consensusThreshold,
    buildGateContext: buildGateContextDefault,
  };

  const state = initialState(Date.now());

  while (true) {
    await runIteration(deps, state, Date.now());
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((e) => {
    process.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
