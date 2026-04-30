import type { CalendarEvent, Candle, TickTrigger, Timeframe } from "@forex-bot/contracts";
import { atr } from "@forex-bot/indicators";
import type { Level } from "@forex-bot/indicators";

const TF_MS: Record<Timeframe, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 60 * 60_000,
  H4: 240 * 60_000,
  D1: 1440 * 60_000,
  W1: 7 * 1440 * 60_000,
};

export interface DetectTriggersInput {
  nowMs: number;
  lastTickedMs: number;
  candlesByTf: Partial<Record<Timeframe, readonly Candle[]>>;
  levels?: readonly Level[];
  upcomingEvents: readonly CalendarEvent[];
  lastRebalanceMs?: number;
  /** Defaults to 10 minutes (matches risk config newsBlackout window). */
  newsWindowMin?: number;
  /** Defaults to 30 minutes. */
  rebalanceMs?: number;
  /** Bar range > N × ATR fires the price event. Defaults to 2. */
  atrExpansionMultiplier?: number;
  /** Tolerance for "broken" S/R level, in price units. Defaults to 0. */
  levelBreakTolerance?: number;
}

export function detectTriggers(input: DetectTriggersInput): TickTrigger[] {
  const triggers: TickTrigger[] = [];

  for (const tf of ["M15", "H1", "H4", "D1"] as const) {
    if (Math.floor(input.nowMs / TF_MS[tf]) > Math.floor(input.lastTickedMs / TF_MS[tf])) {
      triggers.push({ reason: "schedule", timeframe: tf });
    }
  }

  const h1 = input.candlesByTf.H1 ?? [];
  if (h1.length >= 2 && input.levels && input.levels.length > 0) {
    const tol = input.levelBreakTolerance ?? 0;
    const last = h1[h1.length - 1];
    const prev = h1[h1.length - 2];
    if (last && prev) {
      for (const lvl of input.levels) {
        const wasBelow = prev.close < lvl.price - tol;
        const wasAbove = prev.close > lvl.price + tol;
        const nowBelow = last.close < lvl.price - tol;
        const nowAbove = last.close > lvl.price + tol;
        if ((wasBelow && nowAbove) || (wasAbove && nowBelow)) {
          triggers.push({
            reason: "price_event",
            timeframe: "H1",
            detail: `S/R break ${lvl.price.toFixed(5)}`,
          });
          break;
        }
      }
    }
  }

  const mult = input.atrExpansionMultiplier ?? 2;
  if (h1.length >= 15) {
    const atrSeries = atr(h1, 14);
    const lastAtr = atrSeries.at(-1);
    const last = h1[h1.length - 1];
    if (last && typeof lastAtr === "number" && lastAtr > 0) {
      const range = last.high - last.low;
      if (range > mult * lastAtr) {
        triggers.push({
          reason: "price_event",
          timeframe: "H1",
          detail: `ATR expansion ${(range / lastAtr).toFixed(2)}x`,
        });
      }
    }
  }

  const winMs = (input.newsWindowMin ?? 10) * 60_000;
  for (const e of input.upcomingEvents) {
    if (e.impact !== "high") continue;
    if (Math.abs(e.ts - input.nowMs) <= winMs) {
      triggers.push({
        reason: "news_event",
        detail: `${e.currency} ${e.title}`,
      });
      break;
    }
  }

  const rebalMs = input.rebalanceMs ?? 30 * 60_000;
  if (input.lastRebalanceMs !== undefined && input.nowMs - input.lastRebalanceMs >= rebalMs) {
    triggers.push({ reason: "rebalance" });
  }

  return triggers;
}
