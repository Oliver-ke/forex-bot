import type { Candle, TradeOutcome } from "@forex-bot/contracts";

export interface SimulatedPosition {
  side: "buy" | "sell";
  entry: number;
  sl: number;
  tp: number;
  /** Optional ms-epoch deadline. If reached without SL/TP, returns "expiry". */
  expiresAt?: number;
}

/**
 * Reasons taken straight from the TradeOutcome contract — single source of
 * truth. The simulator additionally returns "none" when no bar triggers a
 * close (e.g. the trade is still open at the end of the provided window).
 */
export type CloseExitReason = TradeOutcome["exitReason"];

export interface SimulatedClose {
  /** Close price. */
  exit: number;
  /** Reason for the close, or "none" if no bar in the window triggered one. */
  reason: CloseExitReason | "none";
  /** Timestamp of the bar that closed the trade (or last bar if "none"). */
  closedAt: number;
  /** Index in `bars` of the closing bar. */
  barIndex: number;
}

/**
 * Deterministic, pessimistic close simulator.
 *
 * Walks `bars` in order and on each bar checks SL/TP/expiry in that priority.
 * When both SL and TP are touched within the same bar, SL wins (we cannot
 * know intra-bar ordering, so we assume the worst).
 *
 * If no bar triggers a close, returns `reason: "none"` with the last bar's
 * close price — callers can decide how to treat the still-open trade.
 */
export function simulateClose(
  position: SimulatedPosition,
  bars: readonly Candle[],
): SimulatedClose {
  if (bars.length === 0) {
    throw new Error("simulateClose: bars must not be empty");
  }

  const { side, sl, tp, expiresAt } = position;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (!bar) continue;

    if (side === "buy") {
      const slHit = bar.low <= sl;
      const tpHit = bar.high >= tp;
      if (slHit && tpHit) {
        return { exit: sl, reason: "sl", closedAt: bar.ts, barIndex: i };
      }
      if (slHit) {
        return { exit: sl, reason: "sl", closedAt: bar.ts, barIndex: i };
      }
      if (tpHit) {
        return { exit: tp, reason: "tp", closedAt: bar.ts, barIndex: i };
      }
    } else {
      const slHit = bar.high >= sl;
      const tpHit = bar.low <= tp;
      if (slHit && tpHit) {
        return { exit: sl, reason: "sl", closedAt: bar.ts, barIndex: i };
      }
      if (slHit) {
        return { exit: sl, reason: "sl", closedAt: bar.ts, barIndex: i };
      }
      if (tpHit) {
        return { exit: tp, reason: "tp", closedAt: bar.ts, barIndex: i };
      }
    }

    if (expiresAt !== undefined && bar.ts >= expiresAt) {
      return { exit: bar.close, reason: "expiry", closedAt: bar.ts, barIndex: i };
    }
  }

  const lastIndex = bars.length - 1;
  const last = bars[lastIndex];
  // Length check above guarantees this, but keep TS happy under
  // noUncheckedIndexedAccess.
  if (!last) {
    throw new Error("simulateClose: bars must not be empty");
  }
  return { exit: last.close, reason: "none", closedAt: last.ts, barIndex: lastIndex };
}
