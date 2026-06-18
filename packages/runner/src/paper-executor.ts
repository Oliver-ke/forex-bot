import type { Broker } from "@forex-bot/broker-core";
import type { Trade } from "@forex-bot/eval-core";
import { simulateClose } from "@forex-bot/eval-core";
import { sessionForUtc } from "./session.js";
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

// ---------------------------------------------------------------------------
// Internal open-position record for PaperExecutor
// ---------------------------------------------------------------------------

interface OpenPosition {
  tradeId: string;
  symbol: string;
  side: "buy" | "sell";
  entry: number;
  sl: number;
  tp: number;
  lotSize: number;
  openedAt: number;
  expiresAt: number | undefined;
  verdict: Trade["verdict"];
  decision: OpenIntent["decision"];
  pipValuePerLot: number;
  regimeLabel: RegimeKey;
}

/**
 * Phase-3 paper executor.  Stores open positions and closes them with REAL
 * SL/TP outcomes via `simulateClose` across successive `reconcile(now)` calls.
 *
 * This is the live-incremental analogue of `eval-replay`'s `buildTrade`:
 * it cannot see the future at open time, so it fetches H1 candles from the
 * broker on each reconcile and asks `simulateClose` whether any bar after
 * the open time triggered a close.
 *
 * Exposes the same three getters as `LegacyPaperExecutor` so Task 3.2 can
 * swap it in for the metrics flush without changes.
 */
export class PaperExecutor implements Executor {
  private readonly _broker: Broker;
  /** All closed trades — retained for the daily-metrics flush. */
  private readonly _cumulativeTrades: Trade[] = [];
  /** Positions not yet closed. */
  private readonly _open: OpenPosition[] = [];
  private readonly _sessions = new Map<Trade, SessionKey>();
  private readonly _regimes = new Map<Trade, RegimeKey>();

  constructor(broker: Broker) {
    this._broker = broker;
  }

  // ---------------------------------------------------------------------------
  // Getters (same contract as LegacyPaperExecutor)
  // ---------------------------------------------------------------------------

  get cumulativeTrades(): readonly Trade[] {
    return this._cumulativeTrades;
  }

  get sessions(): ReadonlyMap<Trade, SessionKey> {
    return this._sessions;
  }

  get regimes(): ReadonlyMap<Trade, RegimeKey> {
    return this._regimes;
  }

  // ---------------------------------------------------------------------------
  // Executor interface
  // ---------------------------------------------------------------------------

  /**
   * Store an open paper position.  Entry is approximated from the most recent
   * bar in the bundle (M15 → H1 → H4 → D1) — same heuristic as `buildTrade`.
   */
  async open(intent: OpenIntent): Promise<boolean> {
    const { symbol, now, decision, bundle, pipValuePerLot } = intent;

    const side: "buy" | "sell" = decision.sl < decision.tp ? "buy" : "sell";

    // Approximate entry: most recent close across timeframes.
    const m = bundle.market;
    const entry =
      m.M15.at(-1)?.close ??
      m.H1.at(-1)?.close ??
      m.H4.at(-1)?.close ??
      m.D1.at(-1)?.close ??
      (side === "buy" ? decision.sl + 1 : decision.sl - 1);

    const verdict: Trade["verdict"] = {
      direction: side === "buy" ? "long" : "short",
      confidence: 0.7,
      horizon: "H1",
      reasoning: "synthesized from approved decision; full verdict not exposed by tick()",
    };

    // regimePrior.label is z.enum(["trending","ranging","event-driven","risk-off"])
    // which is identical to RegimeKey — direct cast is safe; the schema enforces it.
    const regimeLabel = bundle.regimePrior.label as RegimeKey;

    const pos: OpenPosition = {
      tradeId: `${symbol}-${now}`,
      symbol,
      side,
      entry,
      sl: decision.sl,
      tp: decision.tp,
      lotSize: decision.lotSize,
      openedAt: now,
      expiresAt: decision.expiresAt,
      verdict,
      decision,
      pipValuePerLot,
      regimeLabel,
    };

    this._open.push(pos);
    return true;
  }

  /**
   * Advance all open positions to `now`.  For each position, fetches H1
   * candles from the broker and filters to bars strictly after the open time.
   * If `simulateClose` returns a close reason other than "none", the position
   * is removed from the open set and a `ClosedTrade` is emitted.
   *
   * Returns only the trades that closed THIS call.
   */
  async reconcile(_now: number): Promise<readonly ClosedTrade[]> {
    const closed: ClosedTrade[] = [];

    // Iterate in reverse so we can splice without index issues.
    for (let i = this._open.length - 1; i >= 0; i--) {
      const pos = this._open[i];
      if (!pos) continue;

      // Fetch H1 candles and keep only bars strictly after open time.
      const allCandles = await this._broker.getCandles(
        pos.symbol as Parameters<Broker["getCandles"]>[0],
        "H1",
        500,
      );
      const bars = allCandles.filter((b) => b.ts > pos.openedAt);

      // No post-open bars yet — leave position open.
      if (bars.length === 0) continue;

      const simResult = simulateClose(
        {
          side: pos.side,
          entry: pos.entry,
          sl: pos.sl,
          tp: pos.tp,
          ...(pos.expiresAt !== undefined ? { expiresAt: pos.expiresAt } : {}),
        },
        bars,
      );

      // Still open in this window.
      if (simResult.reason === "none") continue;

      // Position closed — compute outcome using the exact buildTrade formula.
      const scale = pos.symbol.endsWith("JPY") ? 0.01 : 0.0001;
      const direction = pos.side === "buy" ? 1 : -1;
      const pips = ((simResult.exit - pos.entry) / scale) * direction;
      const pnl = pips * pos.lotSize * pos.pipValuePerLot;
      const stopDist = Math.abs(pos.entry - pos.sl);
      const realizedR = stopDist === 0 ? 0 : ((simResult.exit - pos.entry) * direction) / stopDist;
      // simResult.reason is guaranteed non-"none" here (we skipped above).
      const exitReason = simResult.reason;

      const trade: ClosedTrade = {
        symbol: pos.symbol as Trade["symbol"],
        openedAt: pos.openedAt,
        closedAt: simResult.closedAt,
        side: pos.side,
        entry: pos.entry,
        sl: pos.sl,
        tp: pos.tp,
        exit: simResult.exit,
        lotSize: pos.lotSize,
        pnl,
        realizedR,
        exitReason,
        verdict: pos.verdict,
        decision: pos.decision,
      };

      // Remove from open set.
      this._open.splice(i, 1);

      // Record in cumulative list and tag with session/regime.
      this._cumulativeTrades.push(trade);
      this._sessions.set(trade, sessionForUtc(pos.openedAt));
      this._regimes.set(trade, pos.regimeLabel);

      closed.push(trade);
    }

    // Return in open-order (we iterated reverse; reverse back).
    return closed.reverse();
  }
}
