import { netCorrelatedRiskPct } from "../correlation.js";
import type { Gate } from "./types.js";

export const correlationGate: Gate = (ctx) => {
  const net = netCorrelatedRiskPct({
    matrix: ctx.correlation,
    newSymbol: ctx.order.symbol,
    newSide: ctx.order.side,
    newRiskPct: ctx.config.perTrade.riskPct,
    openPositions: ctx.openPositions,
    positionRiskPct: () => ctx.config.perTrade.riskPct,
    threshold: 0.6,
  });
  const cap = ctx.config.correlation.maxNetCorrelatedExposurePct;
  if (net > cap) {
    return {
      pass: false,
      gate: "correlation",
      reason: `net correlated exposure ${net.toFixed(2)}% > cap ${cap}%`,
    };
  }
  return { pass: true, gate: "correlation" };
};
