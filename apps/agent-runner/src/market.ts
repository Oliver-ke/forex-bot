import type { Candle } from "@forex-bot/contracts";

/** Default: no new candle for 3h ⇒ treat the market as closed. During open
 *  hours fresh H1 data is at most ~1h old, so 3h tolerates thin periods while
 *  reliably catching weekends/holidays/feed outages. */
export const DEFAULT_MARKET_STALE_MS = 3 * 60 * 60 * 1000;

/** Age of the most recent candle in ms; Infinity when there are no candles. */
export function feedAgeMs(candles: readonly Candle[], nowMs: number): number {
  const last = candles.at(-1);
  return last ? nowMs - last.ts : Number.POSITIVE_INFINITY;
}

/**
 * Market-closed heuristic from feed staleness. The forex feed stops producing
 * candles on weekends/holidays, so a latest candle older than `maxAgeMs` means
 * the market is effectively closed — skip the tick rather than run the agent
 * graph (and spend LLM budget) on stale data.
 */
export function isMarketClosed(
  candles: readonly Candle[],
  nowMs: number,
  maxAgeMs: number = DEFAULT_MARKET_STALE_MS,
): boolean {
  return feedAgeMs(candles, nowMs) > maxAgeMs;
}
