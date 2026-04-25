import type { MaybeSeries, Series } from "./types.js";

export function sma(values: Series, period: number): MaybeSeries {
  if (period < 1) throw new Error("SMA period must be >= 1");
  if (period > values.length) throw new Error("SMA period must be <= input length");
  const out: (number | undefined)[] = new Array(values.length);
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i] as number;
    if (i >= period) windowSum -= values[i - period] as number;
    out[i] = i >= period - 1 ? windowSum / period : undefined;
  }
  return out;
}
