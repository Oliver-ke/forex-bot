import type { Series } from "./types.js";

export interface BollingerPoint {
  upper: number;
  middle: number;
  lower: number;
}

export function bollinger(values: Series, period = 20, k = 2): (BollingerPoint | undefined)[] {
  if (period < 1) throw new Error("Bollinger period must be >= 1");
  if (period > values.length) throw new Error("Bollinger period must be <= input length");
  const out: (BollingerPoint | undefined)[] = new Array(values.length).fill(undefined);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j] as number;
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += ((values[j] as number) - mean) ** 2;
    const sd = Math.sqrt(sq / period);
    out[i] = { upper: mean + k * sd, middle: mean, lower: mean - k * sd };
  }
  return out;
}
