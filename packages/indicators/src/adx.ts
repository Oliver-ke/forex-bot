import type { Candle } from "@forex-bot/contracts";
import type { MaybeSeries } from "./types.js";

export function adx(candles: readonly Candle[], period = 14): MaybeSeries {
  if (period < 1) throw new Error("ADX period must be >= 1");
  const n = candles.length;
  const out: (number | undefined)[] = new Array(n).fill(undefined);
  if (n < 2 * period) return out;

  const tr: number[] = new Array(n).fill(0);
  const plusDm: number[] = new Array(n).fill(0);
  const minusDm: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const c = candles[i] as Candle;
    const p = candles[i - 1] as Candle;
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }

  let atrSum = 0;
  let plusSum = 0;
  let minusSum = 0;
  for (let i = 1; i <= period; i++) {
    atrSum += tr[i] as number;
    plusSum += plusDm[i] as number;
    minusSum += minusDm[i] as number;
  }

  const dx: (number | undefined)[] = new Array(n).fill(undefined);
  const plusDi = (plusSum / atrSum) * 100;
  const minusDi = (minusSum / atrSum) * 100;
  dx[period] = (Math.abs(plusDi - minusDi) / (plusDi + minusDi)) * 100;

  let smoothedAtr = atrSum;
  let smoothedPlus = plusSum;
  let smoothedMinus = minusSum;

  for (let i = period + 1; i < n; i++) {
    smoothedAtr = smoothedAtr - smoothedAtr / period + (tr[i] as number);
    smoothedPlus = smoothedPlus - smoothedPlus / period + (plusDm[i] as number);
    smoothedMinus = smoothedMinus - smoothedMinus / period + (minusDm[i] as number);
    const pdi = (smoothedPlus / smoothedAtr) * 100;
    const mdi = (smoothedMinus / smoothedAtr) * 100;
    const denom = pdi + mdi;
    dx[i] = denom === 0 ? 0 : (Math.abs(pdi - mdi) / denom) * 100;
  }

  let adxSum = 0;
  for (let i = period; i < 2 * period; i++) adxSum += dx[i] as number;
  let current = adxSum / period;
  out[2 * period - 1] = current;
  for (let i = 2 * period; i < n; i++) {
    current = (current * (period - 1) + (dx[i] as number)) / period;
    out[i] = current;
  }
  return out;
}
