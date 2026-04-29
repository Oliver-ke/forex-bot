import type { AnalystOutput, Bias } from "@forex-bot/contracts";

export interface AggregateOptions {
  consensusThreshold: number;
}

export interface AggregatedSignal {
  consensus: boolean;
  direction: Bias;
  /** Signed conviction per source: positive = long, negative = short, 0 = neutral. */
  signal: Record<AnalystOutput["source"], number>;
  meanConviction: number;
}

export function aggregate(
  outputs: readonly AnalystOutput[],
  opts: AggregateOptions,
): AggregatedSignal {
  const signal = {} as Record<AnalystOutput["source"], number>;
  for (const o of outputs) {
    const sign = o.bias === "long" ? 1 : o.bias === "short" ? -1 : 0;
    signal[o.source] = sign * o.conviction;
  }
  const directions = outputs.map((o) => o.bias);
  const allSame = directions.every((d) => d === directions[0]);
  const direction: Bias = allSame ? (directions[0] ?? "neutral") : "neutral";
  const meanConviction =
    outputs.reduce((s, o) => s + o.conviction, 0) / Math.max(outputs.length, 1);
  const consensus = allSame && direction !== "neutral" && meanConviction >= opts.consensusThreshold;
  return { consensus, direction, signal, meanConviction };
}
