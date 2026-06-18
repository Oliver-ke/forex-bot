import { computeMetrics } from "./metrics.js";
import type { Trade } from "./types.js";

export interface AccuracyScore {
  /** Of trades with a directional verdict (long|short), the fraction whose
   *  realized move matched the call: long→exit>entry, short→exit<entry.
   *  0 when there are no directional trades. */
  directionalHitRate: number;
  /** Fraction of trades with pnl > 0 (delegated to computeMetrics). */
  winRate: number;
  /** Mean realizedR (delegated to computeMetrics). */
  expectancyR: number;
}

export function scoreAccuracy(trades: readonly Trade[]): AccuracyScore {
  const m = computeMetrics(trades);
  const directional = trades.filter(
    (t) => t.verdict.direction === "long" || t.verdict.direction === "short",
  );
  const hits = directional.filter((t) =>
    t.verdict.direction === "long" ? t.exit > t.entry : t.exit < t.entry,
  );
  const directionalHitRate = directional.length === 0 ? 0 : hits.length / directional.length;
  return { directionalHitRate, winRate: m.winRate, expectancyR: m.expectancyR };
}
