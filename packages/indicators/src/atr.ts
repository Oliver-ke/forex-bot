import type { Candle } from "@forex-bot/contracts";
import type { MaybeSeries } from "./types.js";

export function atr(candles: readonly Candle[], period = 14): MaybeSeries {
  if (period < 1) throw new Error("ATR period must be >= 1");
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
  if (candles.length <= period) return out;
  const tr: number[] = new Array(candles.length).fill(0);
  tr[0] = (candles[0] as Candle).high - (candles[0] as Candle).low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i] as Candle;
    const prev = candles[i - 1] as Candle;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  }
  let avg = 0;
  for (let i = 1; i <= period; i++) avg += tr[i] as number;
  avg /= period;
  out[period] = avg;
  for (let i = period + 1; i < candles.length; i++) {
    avg = (avg * (period - 1) + (tr[i] as number)) / period;
    out[i] = avg;
  }
  return out;
}
