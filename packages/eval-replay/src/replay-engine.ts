import { tick as defaultTick, detectTriggers } from "@forex-bot/agent-runner";
import type { Broker } from "@forex-bot/broker-core";
import type {
  Candle,
  RiskDecision,
  StateBundle,
  Symbol,
  TickTrigger,
  Verdict,
} from "@forex-bot/contracts";
import type { HotCache } from "@forex-bot/data-core";
import {
  type EquityPoint,
  type ReplayClock,
  type ReplayReport,
  type Trade,
  buildEquityCurve,
  computeMetrics,
} from "@forex-bot/eval-core";
import type { LlmProvider } from "@forex-bot/llm-provider";
import type { GateContext } from "@forex-bot/risk";
import { type SimulatedPosition, simulateClose } from "./close-simulator.js";

/** Pip size for a symbol — matches FixtureBroker.defaultPipScale. */
function pipScale(symbol: Symbol): number {
  return symbol.endsWith("JPY") ? 0.01 : 0.0001;
}

export interface ReplayEngineDeps {
  broker: Broker;
  cache: HotCache;
  llm: LlmProvider;
  /** Builds a GateContext for each tick. */
  buildGateContext: (bundle: StateBundle, now: number) => GateContext;
  /** Bars used post-decision for SL/TP simulation. */
  futureBars: (symbol: Symbol, fromMs: number) => readonly Candle[];
  /**
   * Override for the tick driver. Default is `tick` from `@forex-bot/agent-runner`.
   * Useful for tests that want to skip the LLM cache priming and inject a
   * canned `TickResult` directly.
   */
  tickFn?: typeof defaultTick;
}

export interface ReplayEngineConfig {
  startMs: number;
  endMs: number;
  /** e.g. 60_000 (1 min) or 15*60_000. */
  stepMs: number;
  symbols: readonly Symbol[];
  /** Pass through to tick(). */
  consensusThreshold: number;
  /** Default 10_000. */
  startingEquity?: number;
  /** Snapshot fn for inclusion in the final report. */
  llmCacheStats?: () => { hits: number; misses: number };
  /**
   * Pip value per lot (USD-quoted by default). Used to convert pip P&L into
   * account currency for the `Trade.pnl` field. Defaults to 10 USD/lot.
   */
  pipValuePerLot?: number;
}

export class ReplayEngine {
  private readonly deps: ReplayEngineDeps;
  private readonly tick: typeof defaultTick;

  constructor(deps: ReplayEngineDeps) {
    this.deps = deps;
    this.tick = deps.tickFn ?? defaultTick;
  }

  async run(cfg: ReplayEngineConfig, clock: ReplayClock): Promise<ReplayReport> {
    const startingEquity = cfg.startingEquity ?? 10_000;
    const pipValuePerLot = cfg.pipValuePerLot ?? 10;
    const trades: Trade[] = [];

    let lastTickedMs = cfg.startMs;
    let lastRebalanceMs = cfg.startMs;

    for (let now = cfg.startMs; now <= cfg.endMs; now += cfg.stepMs) {
      clock.advanceTo(now);

      for (const symbol of cfg.symbols) {
        const candlesH1 = await this.deps.broker.getCandles(symbol, "H1", 200);
        const calendar = await this.deps.cache.getCalendarWindow();

        const triggers: readonly TickTrigger[] = detectTriggers({
          nowMs: now,
          lastTickedMs,
          candlesByTf: { H1: candlesH1 },
          upcomingEvents: calendar,
          lastRebalanceMs,
        });

        const trigger = triggers[0];
        if (!trigger) continue;

        const result = await this.tick({
          broker: this.deps.broker,
          cache: this.deps.cache,
          llm: this.deps.llm,
          symbol,
          ts: now,
          trigger,
          consensusThreshold: cfg.consensusThreshold,
          buildGateContext: (b) => this.deps.buildGateContext(b, now),
        });

        if (triggers.some((t) => t.reason === "rebalance")) lastRebalanceMs = now;

        if (result.decision.approve !== true) continue;

        const trade = this.buildTrade({
          symbol,
          now,
          decision: result.decision,
          bundle: result.bundle,
          pipValuePerLot,
        });
        if (trade) trades.push(trade);
      }

      lastTickedMs = now;
    }

    const equity: readonly EquityPoint[] = buildEquityCurve(startingEquity, trades, {
      stepMs: 24 * 60 * 60_000,
    });
    const metrics = computeMetrics(trades, { dailyEquity: equity });

    const report: ReplayReport = {
      generatedAt: Date.now(),
      window: { startMs: cfg.startMs, endMs: cfg.endMs },
      symbols: cfg.symbols,
      trades,
      equity,
      metrics,
      ...(cfg.llmCacheStats ? { llmCacheStats: cfg.llmCacheStats() } : {}),
      // v1 leaves journals empty; will be wired in Plan 6.
      journals: [],
    };
    return report;
  }

  /**
   * Builds a Trade from an approved decision by:
   *   - inferring side from sl/tp ordering (sl < tp → buy, else sell);
   *   - approximating the entry as the latest M15 close for the symbol; and
   *   - simulating the close against `deps.futureBars`.
   *
   * Side inference is conservative and documented in the plan: it holds for
   * standard buy (sl<entry<tp) and sell (tp<entry<sl) layouts.
   */
  private buildTrade(args: {
    symbol: Symbol;
    now: number;
    decision: Extract<RiskDecision, { approve: true }>;
    bundle: StateBundle;
    pipValuePerLot: number;
  }): Trade | undefined {
    const { symbol, now, decision, bundle, pipValuePerLot } = args;
    const side: "buy" | "sell" = decision.sl < decision.tp ? "buy" : "sell";

    // Approximate entry with the most recent M15 close in the bundle. If M15 is
    // empty, fall back to H1, then H4, then D1.
    const entry = latestClose(bundle) ?? (side === "buy" ? decision.sl + 1 : decision.sl - 1);

    const simPos: SimulatedPosition = {
      side,
      entry,
      sl: decision.sl,
      tp: decision.tp,
      expiresAt: decision.expiresAt,
    };
    const future = this.deps.futureBars(symbol, now);
    if (future.length === 0) return undefined;
    const close = simulateClose(simPos, future);

    const scale = pipScale(symbol);
    const direction = side === "buy" ? 1 : -1;
    const pips = ((close.exit - entry) / scale) * direction;
    const pnl = pips * decision.lotSize * pipValuePerLot;

    const stopDist = Math.abs(entry - decision.sl);
    // R = signed move toward TP, normalised by stop distance.
    const realizedR = stopDist === 0 ? 0 : ((close.exit - entry) * direction) / stopDist;

    // Map "none" (open at end of window) to "manual" so we satisfy the
    // TradeOutcome contract — the trade is treated as flat-closed on the last
    // simulated bar.
    const exitReason = close.reason === "none" ? "manual" : close.reason;

    const verdict: Verdict = {
      direction: side === "buy" ? "long" : "short",
      confidence: 0.7,
      horizon: "H1",
      reasoning: "synthesized from approved decision; full verdict not exposed by tick()",
    };

    return {
      symbol,
      openedAt: now,
      closedAt: close.closedAt,
      side,
      entry,
      sl: decision.sl,
      tp: decision.tp,
      exit: close.exit,
      lotSize: decision.lotSize,
      pnl,
      realizedR,
      exitReason,
      verdict,
      decision,
    };
  }
}

function latestClose(bundle: StateBundle): number | undefined {
  const m = bundle.market;
  for (const tf of ["M15", "H1", "H4", "D1"] as const) {
    const arr = m[tf];
    const last = arr[arr.length - 1];
    if (last) return last.close;
  }
  return undefined;
}
