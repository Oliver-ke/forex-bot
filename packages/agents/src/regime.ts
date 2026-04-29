import type { Candle, Regime } from "@forex-bot/contracts";
import { adx, atr } from "@forex-bot/indicators";

export interface ClassifyRegimeInput {
  candlesH1: readonly Candle[];
  /** Count of high-impact events within the lookahead window. */
  upcomingHighImpactCount: number;
}

export function classifyRegime(input: ClassifyRegimeInput): Regime {
  const adxSeries = adx(input.candlesH1, 14);
  const atrSeries = atr(input.candlesH1, 14);
  const lastAdx = adxSeries.at(-1);
  const lastAtr = atrSeries.at(-1);
  const meanClose =
    input.candlesH1.reduce((s, c) => s + c.close, 0) / Math.max(input.candlesH1.length, 1);
  const atrPct = lastAtr !== undefined && meanClose !== 0 ? lastAtr / meanClose : 0;

  if (input.upcomingHighImpactCount >= 2) {
    return { label: "event-driven", volBucket: bucketize(atrPct) };
  }
  if (typeof lastAdx === "number" && lastAdx > 25) {
    return { label: "trending", volBucket: bucketize(atrPct) };
  }
  return { label: "ranging", volBucket: bucketize(atrPct) };
}

function bucketize(atrPct: number): Regime["volBucket"] {
  if (atrPct < 0.001) return "low";
  if (atrPct < 0.005) return "normal";
  if (atrPct < 0.012) return "high";
  return "extreme";
}
