import type { MaybeSeries, Series } from "./types.js";

export function ema(values: Series, period: number): MaybeSeries {
  if (period < 1) throw new Error("EMA period must be >= 1");
  if (period > values.length) throw new Error("EMA period must be <= input length");
  const out: (number | undefined)[] = new Array(values.length);
  const alpha = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i] as number;
  seed /= period;
  let prev = seed;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out[i] = undefined;
    } else if (i === period - 1) {
      out[i] = seed;
    } else {
      const v = values[i] as number;
      const next = alpha * v + (1 - alpha) * prev;
      out[i] = next;
      prev = next;
    }
  }
  return out;
}
