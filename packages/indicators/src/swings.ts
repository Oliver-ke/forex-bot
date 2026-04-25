import type { Candle } from "@forex-bot/contracts";

export interface Swings {
  highs: readonly number[];
  lows: readonly number[];
}

export function swings(candles: readonly Candle[], lookback = 2): Swings {
  if (lookback < 1) throw new Error("lookback must be >= 1");
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i] as Candle;
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= lookback; k++) {
      const left = candles[i - k] as Candle;
      const right = candles[i + k] as Candle;
      if (!(c.high > left.high && c.high > right.high)) isHigh = false;
      if (!(c.low < left.low && c.low < right.low)) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}
