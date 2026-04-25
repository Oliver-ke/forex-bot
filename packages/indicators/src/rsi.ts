import type { MaybeSeries, Series } from "./types.js";

export function rsi(values: Series, period = 14): MaybeSeries {
  if (period < 1) throw new Error("RSI period must be >= 1");
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = (values[i] as number) - (values[i - 1] as number);
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = computeRsi(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = (values[i] as number) - (values[i - 1] as number);
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = computeRsi(avgGain, avgLoss);
  }
  return out;
}

function computeRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
