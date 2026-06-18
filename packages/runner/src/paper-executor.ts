import type { Trade } from "@forex-bot/eval-core";
import type { ClosedTrade, Executor, OpenIntent } from "./types.js";

/**
 * Session and regime label unions — mirrors the ones in paper-runner's
 * metrics-writer. Defined locally so @forex-bot/runner has no dep on
 * @forex-bot/paper-runner.
 */
export type SessionKey = "asia" | "london" | "ny" | "overlap_ny_london" | "off";
export type RegimeKey = "trending" | "ranging" | "event-driven" | "risk-off";

/**
 * Interim paper executor (Phase 1/2).  Records a zero-pnl stub Trade on
 * every approved intent.
 *
 * `reconcile()` flushes the trades opened since the last call so the shared
 * harness can journal them (preserving the paper-runner v1 "journal on approve"
 * semantics). All trades are also retained in `cumulativeTrades` for the
 * daily-metrics flush. Real position lifecycle lands in Phase 3.
 *
 * The three readable getters give paper-runner's daily-metrics flush exactly
 * the same data it previously read off RunIterationsState.
 */
export class LegacyPaperExecutor implements Executor {
  /** All trades ever opened — retained for the daily-metrics flush. */
  private readonly _trades: Trade[] = [];
  /** Trades opened since the last reconcile() call — flushed on reconcile. */
  private _pending: Trade[] = [];
  private readonly _sessions = new Map<Trade, SessionKey>();
  private readonly _regimes = new Map<Trade, RegimeKey>();

  get cumulativeTrades(): readonly Trade[] {
    return this._trades;
  }

  get sessions(): ReadonlyMap<Trade, SessionKey> {
    return this._sessions;
  }

  get regimes(): ReadonlyMap<Trade, RegimeKey> {
    return this._regimes;
  }

  async open(intent: OpenIntent): Promise<boolean> {
    const { symbol, now, decision, bundle } = intent;
    const lastClose = bundle.market.H1.at(-1)?.close ?? (decision.sl + decision.tp) / 2;
    const mid = lastClose;
    const trade: Trade = {
      symbol,
      openedAt: now,
      closedAt: now,
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
    this._trades.push(trade);
    this._pending.push(trade);
    this._sessions.set(trade, "london");
    const regimeLabel = bundle.regimePrior.label as RegimeKey;
    this._regimes.set(trade, regimeLabel);
    return true;
  }

  /**
   * Returns all trades opened since the last call (draining the pending list)
   * so the shared harness journals them. `cumulativeTrades` is unaffected.
   */
  async reconcile(_now: number): Promise<readonly ClosedTrade[]> {
    const flushed = this._pending;
    this._pending = [];
    return flushed;
  }
}
