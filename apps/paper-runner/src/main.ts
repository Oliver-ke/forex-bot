import type { Broker } from "@forex-bot/broker-core";
import { MT5Broker, createMT5Client } from "@forex-bot/broker-mt5";
import { RedisHotCache } from "@forex-bot/cache";
import { type Symbol, defaultRiskConfig } from "@forex-bot/contracts";
import { type HotCache, InMemoryJournalStore, type JournalStore } from "@forex-bot/data-core";
import type { MetricsStore } from "@forex-bot/eval-core";
import { AnthropicLlm, type LlmProvider, type StructuredRequest } from "@forex-bot/llm-provider";
import { DynamoJournalStore, DynamoMetricsStore } from "@forex-bot/memory";
import type { GateContext } from "@forex-bot/risk";
import {
  PaperExecutor,
  type RunnerDeps,
  type RunnerState,
  buildGateContext,
  initialState as initialStateShared,
  runIteration as runIterationShared,
} from "@forex-bot/runner";
import { Logger } from "@forex-bot/telemetry";
import { BudgetTracker, type DecisionCounters, MetricsWriter, assertDemoBroker } from "./index.js";

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
  /** DynamoDB trade-journal table; empty → journal to memory only (local dev). */
  journalTable: string;
  /** DynamoDB decisions table (every tick: approved + vetoed); empty → memory. */
  decisionsTable: string;
  /** DynamoDB daily metrics snapshot table; empty → /tmp only. */
  metricsTable: string;
  awsRegion: string;
  /** Skip ticks when the latest candle is older than this (market closed). */
  marketStaleSec: number;
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
    journalTable: process.env.JOURNAL_TABLE ?? "",
    decisionsTable: process.env.DECISIONS_TABLE ?? "",
    metricsTable: process.env.METRICS_TABLE ?? "",
    awsRegion: process.env.AWS_REGION ?? "eu-west-2",
    marketStaleSec: Number(process.env.MARKET_STALE_SEC ?? 10_800),
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

export interface PaperRunnerDeps {
  broker: Broker;
  cache: HotCache;
  llm: LlmProvider;
  budget: BudgetTracker;
  writer: MetricsWriter;
  journal: JournalStore;
  /** Full decision stream — every tick (approved + vetoed). */
  decisions: JournalStore;
  /** The executor that accumulates synthesized trades; exposes cumulativeTrades/sessions/regimes. */
  executor: PaperExecutor;
  /** Optional durable sink for daily snapshots (DynamoDB). /tmp writer always fires too. */
  metricsStore?: MetricsStore;
  /** Skip ticks when the latest candle is older than this many ms (market closed). */
  marketStaleMs: number;
  log: Logger;
  watchedSymbols: readonly Symbol[];
  consensusThreshold: number;
  /** Build GateContext per tick. */
  buildGateContext: (input: {
    now: number;
    symbol: Symbol;
    account: GateContext["account"];
    bundle: import("@forex-bot/contracts").StateBundle;
  }) => GateContext;
}

export interface RunIterationsState extends RunnerState {
  lastFlushDayMs: number;
}

/** Build the initial state for the poll loop, anchored at `nowMs`. */
export function initialState(nowMs: number): RunIterationsState {
  return {
    ...initialStateShared(nowMs),
    lastFlushDayMs: utcDayMs(nowMs),
  };
}

/**
 * Runs one iteration of the paper-runner poll loop. Delegates to the shared
 * harness `runIteration` then fires a daily metrics flush when `nowMs` crosses
 * a UTC day boundary. Mutates `state` in place and returns it for chaining.
 */
export async function runIteration(
  deps: PaperRunnerDeps,
  state: RunIterationsState,
  nowMs: number,
): Promise<RunIterationsState> {
  // Build RunnerDeps for the shared harness.
  const runnerDeps: RunnerDeps = {
    broker: deps.broker,
    cache: deps.cache,
    llm: deps.llm,
    executor: deps.executor,
    journal: deps.journal,
    decisions: deps.decisions,
    budget: deps.budget,
    buildGateContext: (input) => deps.buildGateContext(input),
    log: {
      info: (m, f) => deps.log.info(m, f as Record<string, unknown>),
      warn: (m, f) => deps.log.warn(m, f as Record<string, unknown>),
      error: (m, f) => deps.log.error(m, f as Record<string, unknown>),
    },
    watchedSymbols: deps.watchedSymbols,
    consensusThreshold: deps.consensusThreshold,
    marketStaleMs: deps.marketStaleMs,
  };

  // Delegate to the shared harness (mutates the RunnerState portion of state).
  await runIterationShared(runnerDeps, state, nowMs);

  // Daily flush at UTC midnight boundary.
  const todayMs = utcDayMs(nowMs);
  if (todayMs !== state.lastFlushDayMs) {
    try {
      const snapshot = deps.writer.buildSnapshot({
        dayMs: state.lastFlushDayMs,
        cumulativeTrades: deps.executor.cumulativeTrades,
        sessions: deps.executor.sessions,
        regimes: deps.executor.regimes,
        decisions: state.decisions,
        llmSpendUsd: deps.budget.spendUsd,
      });
      await deps.writer.flush(snapshot);
      if (deps.metricsStore) {
        try {
          await deps.metricsStore.put(snapshot);
        } catch (e) {
          deps.log.error("metrics sink put failed", { err: String(e) });
        }
      }
      deps.log.info("daily metrics flushed", {
        dayMs: state.lastFlushDayMs,
        trades: deps.executor.cumulativeTrades.length,
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

  const broker = new MT5Broker(
    createMT5Client({ host: cfg.mt5Host, port: cfg.mt5Port }),
    true,
    process.env.BROKER_SYMBOL_SUFFIX ?? "",
  );
  assertDemoBroker(broker);

  const cache = new RedisHotCache({ url: cfg.redisUrl, namespace: cfg.redisNamespace });
  await cache.connect();

  const upstream = new AnthropicLlm({ apiKey: cfg.anthropicApiKey });
  const budget = new BudgetTracker({ maxUsd: cfg.paperBudgetUsd });
  const llm = new BudgetWrappedLlm(upstream, budget);

  const writer = new MetricsWriter({ outDir: cfg.paperOutDir });

  // DynamoDB stores when the table envs are set (deployed); in-memory locally.
  const journal: JournalStore = cfg.journalTable
    ? new DynamoJournalStore({ tableName: cfg.journalTable, region: cfg.awsRegion })
    : new InMemoryJournalStore();
  const decisions: JournalStore = cfg.decisionsTable
    ? new DynamoJournalStore({ tableName: cfg.decisionsTable, region: cfg.awsRegion })
    : new InMemoryJournalStore();
  const metricsStore = cfg.metricsTable
    ? new DynamoMetricsStore({ tableName: cfg.metricsTable, region: cfg.awsRegion })
    : undefined;

  const executor = new PaperExecutor(broker);

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
    journal,
    decisions,
    executor,
    ...(metricsStore !== undefined ? { metricsStore } : {}),
    marketStaleMs: cfg.marketStaleSec * 1000,
    log,
    watchedSymbols: cfg.watchedSymbols,
    consensusThreshold: defaultRiskConfig.agent.consensusThreshold,
    buildGateContext,
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
