import type { RiskDecision } from "@forex-bot/contracts";
import { concurrentPositionsGate } from "./gates/concurrent.js";
import { correlationGate } from "./gates/correlation.js";
import { currencyExposureGate } from "./gates/currency-exposure.js";
import { killSwitchGate } from "./gates/kill-switch.js";
import { marginGate } from "./gates/margin.js";
import { newsBlackoutGate } from "./gates/news-blackout.js";
import { perTradeRiskGate } from "./gates/per-trade-risk.js";
import { sessionGate } from "./gates/session.js";
import { spreadGate } from "./gates/spread.js";
import type { Gate, GateContext } from "./gates/types.js";
import { computeLotSize } from "./sizing.js";

export const gates: readonly Gate[] = [
  killSwitchGate,
  spreadGate,
  sessionGate,
  newsBlackoutGate,
  correlationGate,
  currencyExposureGate,
  concurrentPositionsGate,
  perTradeRiskGate,
  marginGate,
];

function pipScale(symbol: string): number {
  return symbol.endsWith("JPY") ? 0.01 : 0.0001;
}

export function evaluate(ctx: GateContext): RiskDecision {
  const stopPips = Math.abs(ctx.order.entry - ctx.order.sl) / pipScale(ctx.order.symbol);
  const lot = computeLotSize({
    equity: ctx.account.equity,
    riskPct: ctx.config.perTrade.riskPct,
    stopDistancePips: stopPips,
    pipValuePerLot: ctx.pipValuePerLot(ctx.order.symbol),
    maxLotSize: ctx.config.perTrade.maxLotSize,
  });
  if (lot <= 0) {
    return { approve: false, vetoReason: "sizing: computed lot is zero" };
  }

  const sizedCtx: GateContext = { ...ctx, order: { ...ctx.order, lotSize: lot } };
  const reasons: string[] = [];
  for (const g of gates) {
    const r = g(sizedCtx);
    if (!r.pass) {
      return { approve: false, vetoReason: `${r.gate}: ${r.reason ?? "blocked"}` };
    }
    reasons.push(`${r.gate}: pass`);
  }

  return {
    approve: true,
    lotSize: lot,
    sl: ctx.order.sl,
    tp: ctx.order.tp,
    expiresAt: ctx.order.expiresAt,
    reasons,
  };
}
