import type { Gate } from "./types.js";

function pipScale(symbol: string): number {
  return symbol.endsWith("JPY") ? 0.01 : 0.0001;
}

export const perTradeRiskGate: Gate = (ctx) => {
  const scale = pipScale(ctx.order.symbol);
  const stopPips = Math.abs(ctx.order.entry - ctx.order.sl) / scale;
  const tpPips = Math.abs(ctx.order.tp - ctx.order.entry) / scale;
  const minStop = ctx.config.execution.minStopDistanceAtr * ctx.atrPips;
  if (stopPips < minStop) {
    return {
      pass: false,
      gate: "per-trade-risk",
      reason: `stop ${stopPips.toFixed(1)}p < min ${minStop.toFixed(1)}p`,
    };
  }
  const rr = tpPips / stopPips;
  if (rr + 1e-9 < ctx.config.perTrade.minRR) {
    return {
      pass: false,
      gate: "per-trade-risk",
      reason: `RR ${rr.toFixed(2)} < minRR ${ctx.config.perTrade.minRR}`,
    };
  }
  return { pass: true, gate: "per-trade-risk" };
};
